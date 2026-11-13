use crate::audit::{self, Entry};
use crate::auth::{Principal, password};
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, decision_details, org_target, role_permissions};
use crate::routes::dto::{OK, Ok, OrgDto, clean_name, normalize_email, slug_or_from};
use crate::state::AppState;
use tessery_core::Permission as P;
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
#[serde(rename_all = "camelCase")]
pub struct OrgListItem {
    #[serde(flatten)]
    pub org: OrgDto,
    pub member: bool,
}

/// Organizations the caller belongs to. Instance administrators see every organization.
#[utoipa::path(get, path = "/api/orgs", tag = "orgs", responses((status = 200, body = [OrgListItem])))]
pub async fn list(
    State(state): State<AppState>,
    p: Principal,
) -> ApiResult<Json<Vec<OrgListItem>>> {
    let mine = tessery_db::orgs::list_for_user(&state.db, p.user.id).await?;
    let ids: std::collections::HashSet<Uuid> = mine.iter().map(|o| o.id).collect();
    let all = if p.is_instance_admin() {
        tessery_db::orgs::list_all(&state.db).await?
    } else {
        mine
    };
    Ok(Json(
        all.into_iter()
            .map(|o| OrgListItem {
                member: ids.contains(&o.id),
                org: o.into(),
            })
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
pub struct CreateOrg {
    pub name: String,
    pub slug: Option<String>,
}

#[utoipa::path(post, path = "/api/orgs", tag = "orgs", request_body = CreateOrg, responses((status = 201, body = OrgDto)))]
pub async fn create(
    State(state): State<AppState>,
    p: Principal,
    Json(req): Json<CreateOrg>,
) -> ApiResult<(StatusCode, Json<OrgDto>)> {
    let settings = tessery_db::settings::get(&state.db).await?;
    if !settings.allow_org_creation && !p.is_instance_admin() {
        return Err(ApiError::ForbiddenMsg(
            "only instance administrators can create organizations".into(),
        ));
    }
    let name = clean_name("name", &req.name, 120)?;
    let slug = slug_or_from("slug", req.slug.as_deref(), &name)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let org = tessery_db::orgs::create(&mut *tx, &slug, &name, p.user.id).await?;
    tessery_db::orgs::add_member(&mut *tx, org.id, p.user.id).await?;
    let owner = tessery_db::roles::get_by_key(&mut *tx, org.id, "owner").await?;
    tessery_db::bindings::create(
        &mut *tx,
        NewBinding {
            org_id: org.id,
            role_id: owner.id,
            subject_kind: SubjectKind::User,
            subject_id: p.user.id,
            scope_kind: ScopeKind::Org,
            scope_id: None,
            env_key: None,
            expires_at: None,
            created_by: p.user.id,
        },
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org.id), "org.create", "org", org.id).details(json!({ "slug": org.slug })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok((StatusCode::CREATED, Json(org.into())))
}

#[utoipa::path(get, path = "/api/orgs/{org}", tag = "orgs", params(("org" = Uuid, Path)), responses((status = 200, body = OrgDto)))]
pub async fn get(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<OrgDto>> {
    rbac::require(&state, &p, &org_target(org), P::OrgRead).await?;
    Ok(Json(tessery_db::orgs::get(&state.db, org).await?.into()))
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateOrg {
    pub name: String,
    pub slug: String,
}

#[utoipa::path(patch, path = "/api/orgs/{org}", tag = "orgs", params(("org" = Uuid, Path)), request_body = UpdateOrg, responses((status = 200, body = OrgDto)))]
pub async fn update(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<UpdateOrg>,
) -> ApiResult<Json<OrgDto>> {
    let d = rbac::require(&state, &p, &org_target(org), P::OrgManage).await?;
    let name = clean_name("name", &req.name, 120)?;
    let slug = slug_or_from("slug", Some(&req.slug), &name)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let o = tessery_db::orgs::update(&mut *tx, org, &slug, &name).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "org.update", "org", org)
            .decision(d)
            .details(json!({ "name": name, "slug": slug })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(o.into()))
}

#[utoipa::path(delete, path = "/api/orgs/{org}", tag = "orgs", params(("org" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::OrgDelete).await?;
    let o = tessery_db::orgs::get(&state.db, org).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::orgs::delete(&mut *tx, org).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(None, "org.delete", "org", org)
            .decision(d)
            .details(json!({ "slug": o.slug, "name": o.name })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MemberDto {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub instance_admin: bool,
    pub disabled: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub joined_at: OffsetDateTime,
    /// Keys of roles granted directly to this member at organization scope.
    pub org_roles: Vec<String>,
}

#[utoipa::path(get, path = "/api/orgs/{org}/members", tag = "members", params(("org" = Uuid, Path)), responses((status = 200, body = [MemberDto])))]
pub async fn list_members(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Vec<MemberDto>>> {
    rbac::require(&state, &p, &org_target(org), P::MemberRead).await?;
    let members = tessery_db::orgs::list_members(&state.db, org).await?;
    let bindings = tessery_db::bindings::list(&state.db, org).await?;
    Ok(Json(
        members
            .into_iter()
            .map(|m| MemberDto {
                org_roles: bindings
                    .iter()
                    .filter(|b| {
                        b.subject_kind == SubjectKind::User
                            && b.subject_id == m.user_id
                            && b.scope_kind == ScopeKind::Org
                    })
                    .map(|b| b.role_key.clone())
                    .collect(),
                user_id: m.user_id,
                email: m.email,
                name: m.name,
                instance_admin: m.is_instance_admin,
                disabled: m.disabled,
                joined_at: m.joined_at,
            })
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddMember {
    pub email: String,
    /// Required when the email does not belong to an existing account.
    pub name: Option<String>,
    /// Initial password for a new account. Leave it out to email an invitation instead, when email is set up.
    pub password: Option<String>,
    /// Role granted at organization scope. Defaults to `viewer`.
    pub role: Option<String>,
}

#[utoipa::path(post, path = "/api/orgs/{org}/members", tag = "members", params(("org" = Uuid, Path)), request_body = AddMember, responses((status = 201, body = MemberDto)))]
pub async fn add_member(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    headers: axum::http::HeaderMap,
    Json(req): Json<AddMember>,
) -> ApiResult<(StatusCode, Json<MemberDto>)> {
    let target = org_target(org);
    let d = rbac::require(&state, &p, &target, P::MemberInvite).await?;
    let email = normalize_email(&req.email)?;
    let role = tessery_db::roles::get_by_key(&state.db, org, req.role.as_deref().unwrap_or("viewer"))
        .await
        .map_err(|_| ApiError::invalid("role", "unknown role"))?;
    rbac::ensure_can_grant(
        &state,
        &p,
        &target,
        &role_permissions(role.is_builtin(), &role.key, &role.permissions),
    )
    .await?;

    let existing = tessery_db::users::find_by_email(&state.db, &email).await?;
    let mut invite = false;
    let new_hash = match (&existing, &req.password) {
        (Some(_), _) => None,
        (None, Some(pw)) if !pw.is_empty() => {
            password::validate(pw)?;
            Some(password::hash(pw.clone()).await?)
        }
        (None, _) => {
            if crate::mail::settings(&state).await?.is_none() {
                return Err(ApiError::invalid(
                    "password",
                    "is required to create a new account, or set up email to send an invitation",
                ));
            }
            invite = true;
            None
        }
    };
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let user = match existing {
        Some(u) => {
            if tessery_db::orgs::is_member(&mut *tx, org, u.id).await? {
                return Err(ApiError::Conflict("this user is already a member".into()));
            }
            u
        }
        None => {
            let name = clean_name("name", req.name.as_deref().unwrap_or(""), 120)?;
            tessery_db::users::create(&mut *tx, &email, &name, new_hash.as_deref(), false).await?
        }
    };
    tessery_db::orgs::add_member(&mut *tx, org, user.id).await?;
    tessery_db::bindings::create(
        &mut *tx,
        NewBinding {
            org_id: org,
            role_id: role.id,
            subject_kind: SubjectKind::User,
            subject_id: user.id,
            scope_kind: ScopeKind::Org,
            scope_id: None,
            env_key: None,
            expires_at: None,
            created_by: p.user.id,
        },
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "member.add", "user", user.id)
            .decision(d)
            .details(
                json!({ "email": user.email, "role": role.key, "newAccount": new_hash.is_some() }),
            ),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    if invite {
        let org_name = tessery_db::orgs::get(&state.db, org).await?.name;
        crate::routes::email::send_invite(&state, &headers, user.id, &user.email, &org_name, &p.user.name).await?;
    }
    Ok((
        StatusCode::CREATED,
        Json(MemberDto {
            user_id: user.id,
            email: user.email,
            name: user.name,
            instance_admin: user.is_instance_admin,
            disabled: false,
            joined_at: OffsetDateTime::now_utc(),
            org_roles: vec![role.key],
        }),
    ))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/members/{user}", tag = "members", params(("org" = Uuid, Path), ("user" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn remove_member(
    State(state): State<AppState>,
    p: Principal,
    Path((org, user)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::MemberRemove).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::bindings::delete_for_subject(&mut *tx, org, SubjectKind::User, user).await?;
    tessery_db::orgs::remove_member(&mut *tx, org, user).await?;
    if tessery_db::bindings::count_org_owners(&mut *tx, org).await? == 0 {
        return Err(ApiError::Conflict(
            "an organization must keep at least one owner".into(),
        ));
    }
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "member.remove", "user", user)
            .decision(d)
            .details(decision_details(d)),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}
