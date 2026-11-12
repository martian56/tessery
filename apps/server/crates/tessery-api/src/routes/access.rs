use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target, role_permissions};
use crate::routes::dto::{OK, Ok, clean_name, slug_or_from};
use crate::state::AppState;
use tessery_core::{OrgId, Permission as P, PermissionSet, Target, TeamId};
use tessery_db::bindings::NewBinding;
use tessery_db::types::{ScopeKind, SubjectKind};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
pub struct PermissionInfo {
    pub key: &'static str,
    pub group: &'static str,
    pub description: &'static str,
}

#[utoipa::path(get, path = "/api/permissions", tag = "access", responses((status = 200, body = [PermissionInfo])))]
pub async fn catalog(_p: Principal) -> Json<Vec<PermissionInfo>> {
    Json(
        P::ALL
            .iter()
            .map(|p| PermissionInfo {
                key: p.as_str(),
                group: p.group(),
                description: p.description(),
            })
            .collect(),
    )
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RoleDto {
    pub id: Uuid,
    pub key: String,
    pub name: String,
    pub description: String,
    pub builtin: bool,
    pub permissions: Vec<String>,
}

impl From<tessery_db::roles::Role> for RoleDto {
    fn from(r: tessery_db::roles::Role) -> Self {
        let builtin = r.is_builtin();
        Self {
            permissions: role_permissions(builtin, &r.key, &r.permissions).to_strings(),
            id: r.id,
            key: r.key,
            name: r.name,
            description: r.description,
            builtin,
        }
    }
}

#[utoipa::path(get, path = "/api/orgs/{org}/roles", tag = "access", params(("org" = Uuid, Path)), responses((status = 200, body = [RoleDto])))]
pub async fn list_roles(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Vec<RoleDto>>> {
    rbac::require(&state, &p, &org_target(org), P::RoleRead).await?;
    Ok(Json(
        tessery_db::roles::list_for_org(&state.db, org)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
pub struct RoleInput {
    pub key: Option<String>,
    pub name: String,
    #[serde(default)]
    pub description: String,
    pub permissions: Vec<String>,
}

fn parse_permissions(keys: &[String]) -> ApiResult<PermissionSet> {
    let mut set = PermissionSet::empty();
    for k in keys {
        set.insert(
            k.parse().map_err(|_| {
                ApiError::invalid("permissions", format!("unknown permission `{k}`"))
            })?,
        );
    }
    if set.is_empty() {
        return Err(ApiError::invalid(
            "permissions",
            "select at least one permission",
        ));
    }
    Ok(set)
}

#[utoipa::path(post, path = "/api/orgs/{org}/roles", tag = "access", params(("org" = Uuid, Path)), request_body = RoleInput, responses((status = 201, body = RoleDto)))]
pub async fn create_role(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<RoleInput>,
) -> ApiResult<(StatusCode, Json<RoleDto>)> {
    let target = org_target(org);
    let d = rbac::require(&state, &p, &target, P::RoleManage).await?;
    let name = clean_name("name", &req.name, 80)?;
    let key = slug_or_from("key", req.key.as_deref(), &name)?;
    if tessery_core::BuiltinRole::by_key(&key).is_some() {
        return Err(ApiError::invalid("key", "is reserved for a built-in role"));
    }
    let perms = parse_permissions(&req.permissions)?;
    rbac::ensure_can_grant(&state, &p, &target, &perms).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let r = tessery_db::roles::create_custom(
        &mut *tx,
        org,
        &key,
        &name,
        req.description.trim(),
        &perms.to_strings(),
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "role.create", "role", r.id)
            .decision(d)
            .details(json!({ "key": key, "permissions": perms.to_strings() })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok((StatusCode::CREATED, Json(r.into())))
}

#[utoipa::path(patch, path = "/api/orgs/{org}/roles/{role}", tag = "access", params(("org" = Uuid, Path), ("role" = Uuid, Path)), request_body = RoleInput, responses((status = 200, body = RoleDto)))]
pub async fn update_role(
    State(state): State<AppState>,
    p: Principal,
    Path((org, role)): Path<(Uuid, Uuid)>,
    Json(req): Json<RoleInput>,
) -> ApiResult<Json<RoleDto>> {
    let target = org_target(org);
    let d = rbac::require(&state, &p, &target, P::RoleManage).await?;
    if tessery_db::roles::get(&state.db, org, role)
        .await?
        .is_builtin()
    {
        return Err(ApiError::ForbiddenMsg(
            "built-in roles cannot be changed".into(),
        ));
    }
    let name = clean_name("name", &req.name, 80)?;
    let perms = parse_permissions(&req.permissions)?;
    rbac::ensure_can_grant(&state, &p, &target, &perms).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let r = tessery_db::roles::update_custom(
        &mut *tx,
        org,
        role,
        &name,
        req.description.trim(),
        &perms.to_strings(),
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "role.update", "role", role)
            .decision(d)
            .details(json!({ "permissions": perms.to_strings() })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(r.into()))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/roles/{role}", tag = "access", params(("org" = Uuid, Path), ("role" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete_role(
    State(state): State<AppState>,
    p: Principal,
    Path((org, role)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::RoleManage).await?;
    if tessery_db::roles::get(&state.db, org, role)
        .await?
        .is_builtin()
    {
        return Err(ApiError::ForbiddenMsg(
            "built-in roles cannot be deleted".into(),
        ));
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::roles::delete_custom(&mut *tx, org, role).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "role.delete", "role", role).decision(d),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubjectRef {
    pub kind: SubjectKind,
    pub id: Uuid,
}

#[derive(Serialize, Deserialize, ToSchema, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ScopeRef {
    #[serde(rename = "type")]
    pub kind: ScopeKind,
    pub id: Option<Uuid>,
    pub env: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BindingDto {
    pub id: Uuid,
    pub role_id: Uuid,
    pub role_key: String,
    pub role_name: String,
    pub subject: SubjectRef,
    pub subject_name: Option<String>,
    pub scope: ScopeRef,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<tessery_db::bindings::Binding> for BindingDto {
    fn from(b: tessery_db::bindings::Binding) -> Self {
        Self {
            id: b.id,
            role_id: b.role_id,
            role_key: b.role_key,
            role_name: b.role_name,
            subject: SubjectRef {
                kind: b.subject_kind,
                id: b.subject_id,
            },
            subject_name: b.subject_name,
            scope: ScopeRef {
                kind: b.scope_kind,
                id: b.scope_id,
                env: b.env_key,
            },
            expires_at: b.expires_at,
            created_at: b.created_at,
        }
    }
}

#[utoipa::path(get, path = "/api/orgs/{org}/bindings", tag = "access", params(("org" = Uuid, Path)), responses((status = 200, body = [BindingDto])))]
pub async fn list_bindings(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Vec<BindingDto>>> {
    rbac::require(&state, &p, &org_target(org), P::RoleRead).await?;
    Ok(Json(
        tessery_db::bindings::list(&state.db, org)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateBinding {
    pub role_id: Uuid,
    pub subject: SubjectRef,
    pub scope: ScopeRef,
    /// Grants time-limited access. Must be in the future.
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
}

async fn scope_target(state: &AppState, org: Uuid, scope: &ScopeRef) -> ApiResult<Target> {
    let o = OrgId(org);
    match (scope.kind, scope.id, &scope.env) {
        (ScopeKind::Org, None, None) => Ok(Target::Org(o)),
        (ScopeKind::Team, Some(team), None) => {
            tessery_db::teams::get(&state.db, org, team)
                .await
                .map_err(|_| ApiError::invalid("scope", "team not found in this organization"))?;
            Ok(Target::Team {
                org: o,
                team: TeamId(team),
            })
        }
        (ScopeKind::Project | ScopeKind::Environment, Some(project), env) => {
            let t = rbac::project_target(state, project).await.map_err(|_| {
                ApiError::invalid("scope", "project not found in this organization")
            })?;
            if t.org() != o {
                return Err(ApiError::invalid(
                    "scope",
                    "project not found in this organization",
                ));
            }
            match (scope.kind, t, env) {
                (ScopeKind::Environment, Target::Project { org, team, project }, Some(env))
                    if !env.trim().is_empty() && env.len() <= 64 =>
                {
                    Ok(Target::Environment {
                        org,
                        team,
                        project,
                        env: env.trim().to_owned(),
                    })
                }
                (ScopeKind::Project, t, None) => Ok(t),
                _ => Err(ApiError::invalid(
                    "scope",
                    "environment scopes need an environment name; project scopes must not have one",
                )),
            }
        }
        _ => Err(ApiError::invalid("scope", "invalid scope")),
    }
}

#[utoipa::path(post, path = "/api/orgs/{org}/bindings", tag = "access", params(("org" = Uuid, Path)), request_body = CreateBinding, responses((status = 201, body = BindingDto)))]
pub async fn create_binding(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<CreateBinding>,
) -> ApiResult<(StatusCode, Json<BindingDto>)> {
    let target = scope_target(&state, org, &req.scope).await?;
    let d = rbac::require(&state, &p, &target, P::RoleManage).await?;
    if req
        .expires_at
        .is_some_and(|e| e <= OffsetDateTime::now_utc())
    {
        return Err(ApiError::invalid("expiresAt", "must be in the future"));
    }
    let role = tessery_db::roles::get(&state.db, org, req.role_id)
        .await
        .map_err(|_| ApiError::invalid("roleId", "unknown role"))?;
    rbac::ensure_can_grant(
        &state,
        &p,
        &target,
        &role_permissions(role.is_builtin(), &role.key, &role.permissions),
    )
    .await?;
    match req.subject.kind {
        SubjectKind::User if !tessery_db::orgs::is_member(&state.db, org, req.subject.id).await? => {
            return Err(ApiError::invalid(
                "subject",
                "user is not a member of this organization",
            ));
        }
        SubjectKind::Team => {
            tessery_db::teams::get(&state.db, org, req.subject.id)
                .await
                .map_err(|_| ApiError::invalid("subject", "team not found in this organization"))?;
        }
        _ => {}
    }
    let (scope_id, env) = match &target {
        Target::Org(_) => (None, None),
        Target::Team { team, .. } => (Some(team.0), None),
        Target::Project { project, .. } => (Some(project.0), None),
        Target::Environment { project, env, .. } => (Some(project.0), Some(env.as_str())),
    };
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let id = tessery_db::bindings::create(
        &mut *tx,
        NewBinding {
            org_id: org,
            role_id: role.id,
            subject_kind: req.subject.kind,
            subject_id: req.subject.id,
            scope_kind: req.scope.kind,
            scope_id,
            env_key: env,
            expires_at: req.expires_at,
            created_by: p.user.id,
        },
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "access.grant", "binding", id).decision(d).details(json!({ "role": role.key, "subject": req.subject, "scope": req.scope, "expiresAt": req.expires_at.and_then(|e| e.format(&time::format_description::well_known::Rfc3339).ok()) })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    let b = tessery_db::bindings::list(&state.db, org)
        .await?
        .into_iter()
        .find(|b| b.id == id)
        .ok_or(ApiError::NotFound)?;
    Ok((StatusCode::CREATED, Json(b.into())))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/bindings/{binding}", tag = "access", params(("org" = Uuid, Path), ("binding" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete_binding(
    State(state): State<AppState>,
    p: Principal,
    Path((org, binding)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Ok>> {
    let b = tessery_db::bindings::list(&state.db, org)
        .await?
        .into_iter()
        .find(|b| b.id == binding)
        .ok_or(ApiError::NotFound)?;
    let target = scope_target(
        &state,
        org,
        &ScopeRef {
            kind: b.scope_kind,
            id: b.scope_id,
            env: b.env_key.clone(),
        },
    )
    .await?;
    let d = rbac::require(&state, &p, &target, P::RoleManage).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::bindings::delete(&mut *tx, org, binding).await?;
    if tessery_db::bindings::count_org_owners(&mut *tx, org).await? == 0 {
        return Err(ApiError::Conflict(
            "an organization must keep at least one owner".into(),
        ));
    }
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "access.revoke", "binding", binding)
            .decision(d)
            .details(json!({ "role": b.role_key, "subjectId": b.subject_id })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}
