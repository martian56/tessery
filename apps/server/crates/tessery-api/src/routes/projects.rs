use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::routes::dto::{OK, Ok, clean_name, slug_or_from};
use crate::state::AppState;
use tessery_core::{OrgId, Permission as P, Target, TeamId};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

const MAX_DOC_BYTES: usize = 5 * 1024 * 1024;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummaryDto {
    pub id: Uuid,
    pub org_id: Uuid,
    pub team_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub nodes: i32,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// Environments that run a checkpoint, in no particular order.
    pub running: Vec<RunningDto>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RunningDto {
    pub env: String,
    pub checkpoint: i32,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDto {
    pub id: Uuid,
    pub org_id: Uuid,
    pub team_id: Option<Uuid>,
    pub slug: String,
    pub version: i32,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    /// The design document (nodes, edges, APIs, databases, pages, environments, observability).
    #[schema(value_type = Object)]
    pub doc: Value,
}

impl From<tessery_db::projects::Project> for ProjectDto {
    fn from(p: tessery_db::projects::Project) -> Self {
        let mut doc = p.doc;
        if let Value::Object(map) = &mut doc {
            map.insert("id".into(), json!(p.id));
            map.insert("name".into(), json!(p.name));
            map.insert(
                "updatedAt".into(),
                json!(p.updated_at.unix_timestamp() * 1000),
            );
        }
        Self {
            id: p.id,
            org_id: p.org_id,
            team_id: p.team_id,
            slug: p.slug,
            version: p.version,
            updated_at: p.updated_at,
            doc,
        }
    }
}

struct DocMeta {
    name: String,
    description: String,
    icon: String,
}

fn validate_doc(doc: &Value) -> ApiResult<DocMeta> {
    let Value::Object(map) = doc else {
        return Err(ApiError::invalid("doc", "must be an object"));
    };
    if serde_json::to_vec(doc)
        .map(|b| b.len())
        .unwrap_or(usize::MAX)
        > MAX_DOC_BYTES
    {
        return Err(ApiError::invalid("doc", "is larger than 5 MB"));
    }
    for key in ["nodes", "edges"] {
        if !map.get(key).is_some_and(Value::is_array) {
            return Err(ApiError::invalid(
                "doc",
                format!("`{key}` must be an array"),
            ));
        }
    }
    for key in ["groups", "pages", "environments"] {
        if map.get(key).is_some_and(|v| !v.is_array() && !v.is_null()) {
            return Err(ApiError::invalid("doc", format!("`{key}` must be an array")));
        }
    }
    for key in ["apis", "databases", "observability"] {
        if map.get(key).is_some_and(|v| !v.is_object() && !v.is_null()) {
            return Err(ApiError::invalid("doc", format!("`{key}` must be an object")));
        }
    }
    let text = |k: &str| {
        map.get(k)
            .and_then(Value::as_str)
            .unwrap_or("")
            .trim()
            .to_owned()
    };
    Ok(DocMeta {
        name: clean_name("doc.name", &text("name"), 120)?,
        description: text("description").chars().take(2000).collect(),
        icon: text("icon").chars().take(8).collect(),
    })
}

#[utoipa::path(get, path = "/api/orgs/{org}/projects", tag = "projects", params(("org" = Uuid, Path)), responses((status = 200, body = [ProjectSummaryDto])))]
pub async fn list(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Vec<ProjectSummaryDto>>> {
    rbac::require(&state, &p, &org_target(org), P::OrgRead).await?;
    let bindings = tessery_db::bindings::for_user(&state.db, org, p.user.id).await?;
    let grants: Vec<_> = bindings.iter().filter_map(rbac::grant_from).collect();
    let now = OffsetDateTime::now_utc();
    let rows = tessery_db::projects::list(&state.db, org).await?;
    let mut running: std::collections::HashMap<Uuid, Vec<RunningDto>> = std::collections::HashMap::new();
    for r in tessery_db::delivery::running_in_org(&state.db, org).await? {
        running.entry(r.project_id).or_default().push(RunningDto { env: r.env_key, checkpoint: r.checkpoint_seq });
    }
    Ok(Json(
        rows.into_iter()
            .filter(|r| {
                p.is_instance_admin()
                    || tessery_core::effective_permissions(
                        &grants,
                        &Target::Project {
                            org: OrgId(org),
                            team: r.team_id.map(TeamId),
                            project: tessery_core::ProjectId(r.id),
                        },
                        now,
                    )
                    .contains(P::ProjectRead)
            })
            .map(|r| ProjectSummaryDto {
                id: r.id,
                org_id: r.org_id,
                team_id: r.team_id,
                slug: r.slug,
                name: r.name,
                description: r.description,
                icon: r.icon,
                nodes: r.node_count,
                version: r.version,
                updated_at: r.updated_at,
                running: running.remove(&r.id).unwrap_or_default(),
            })
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateProject {
    pub slug: Option<String>,
    /// Owning team. Team-level grants then apply to the project.
    pub team_id: Option<Uuid>,
    #[schema(value_type = Object)]
    pub doc: Value,
}

#[utoipa::path(post, path = "/api/orgs/{org}/projects", tag = "projects", params(("org" = Uuid, Path)), request_body = CreateProject, responses((status = 201, body = ProjectDto)))]
pub async fn create(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<CreateProject>,
) -> ApiResult<(StatusCode, Json<ProjectDto>)> {
    let target = match req.team_id {
        Some(team) => {
            tessery_db::teams::get(&state.db, org, team)
                .await
                .map_err(|_| ApiError::invalid("teamId", "team not found in this organization"))?;
            Target::Team {
                org: OrgId(org),
                team: TeamId(team),
            }
        }
        None => org_target(org),
    };
    let d = rbac::require(&state, &p, &target, P::ProjectCreate).await?;
    let meta = validate_doc(&req.doc)?;
    let slug = slug_or_from("slug", req.slug.as_deref(), &meta.name)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let row = tessery_db::projects::create(
        &mut tx,
        tessery_db::projects::NewProject {
            org_id: org,
            team_id: req.team_id,
            slug: &slug,
            name: &meta.name,
            description: &meta.description,
            icon: &meta.icon,
            doc: &req.doc,
            created_by: p.user.id,
        },
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "project.create", "project", row.id)
            .decision(d)
            .details(json!({ "slug": slug, "name": meta.name })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok((StatusCode::CREATED, Json(row.into())))
}

#[utoipa::path(get, path = "/api/projects/{project}", tag = "projects", params(("project" = Uuid, Path)), responses((status = 200, body = ProjectDto)))]
pub async fn get(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<ProjectDto>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(
        tessery_db::projects::get(&state.db, project).await?.into(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SaveProject {
    /// The version this edit is based on. A newer version on the server causes a 409 `stale_version`.
    pub version: i32,
    #[schema(value_type = Object)]
    pub doc: Value,
    #[serde(default)]
    pub message: String,
}

#[utoipa::path(put, path = "/api/projects/{project}", tag = "projects", params(("project" = Uuid, Path)), request_body = SaveProject, responses((status = 200, body = ProjectDto), (status = 409)))]
pub async fn save(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
    Json(req): Json<SaveProject>,
) -> ApiResult<Json<ProjectDto>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let meta = validate_doc(&req.doc)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let row = tessery_db::projects::save_doc(
        &mut tx,
        tessery_db::projects::SaveDoc {
            id: project,
            expected_version: req.version,
            doc: &req.doc,
            name: &meta.name,
            description: &meta.description,
            icon: &meta.icon,
            message: req.message.trim(),
            user: p.user.id,
        },
    )
    .await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(target.org().0), "project.save", "project", project)
            .decision(d)
            .details(json!({ "version": row.version })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(row.into()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MoveProject {
    pub team_id: Option<Uuid>,
}

/// Changes which team owns the project. Moving into a team requires `project:create` on that team.
#[utoipa::path(patch, path = "/api/projects/{project}/team", tag = "projects", params(("project" = Uuid, Path)), request_body = MoveProject, responses((status = 200, body = Ok)))]
pub async fn move_to_team(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
    Json(req): Json<MoveProject>,
) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let org = target.org().0;
    let d = rbac::require(&state, &p, &target, P::ProjectDelete).await?;
    if let Some(team) = req.team_id {
        tessery_db::teams::get(&state.db, org, team)
            .await
            .map_err(|_| ApiError::invalid("teamId", "team not found in this organization"))?;
        rbac::require(
            &state,
            &p,
            &Target::Team {
                org: OrgId(org),
                team: TeamId(team),
            },
            P::ProjectCreate,
        )
        .await?;
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::projects::set_team(&mut *tx, project, req.team_id).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "project.move", "project", project)
            .decision(d)
            .details(json!({ "teamId": req.team_id })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[utoipa::path(delete, path = "/api/projects/{project}", tag = "projects", params(("project" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectDelete).await?;
    let mut teardowns = Vec::new();
    for head in tessery_db::delivery::heads(&state.db, project).await? {
        if let Some(job) = crate::routes::delivery::teardown_job(&state, project, &head.env_key, true).await? {
            teardowns.push(job);
        }
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::projects::delete(&mut *tx, project).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(target.org().0), "project.delete", "project", project).decision(d),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    for job in teardowns {
        if let Err(e) = state.mq.publish(job).await {
            tracing::error!(error = %e, %project, "could not queue the teardown of a deleted project's environment");
        }
    }
    if let Err(e) = state.repos.remove(project).await {
        tracing::warn!(error = %e, %project, "could not remove the project repository");
    }
    Ok(Json(OK))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VersionDto {
    pub version: i32,
    pub message: String,
    pub author: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

#[utoipa::path(get, path = "/api/projects/{project}/versions", tag = "projects", params(("project" = Uuid, Path)), responses((status = 200, body = [VersionDto])))]
pub async fn versions(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<Vec<VersionDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(
        tessery_db::projects::list_versions(&state.db, project)
            .await?
            .into_iter()
            .map(|v| VersionDto {
                version: v.version,
                message: v.message,
                author: v.author_name,
                created_at: v.created_at,
            })
            .collect(),
    ))
}

#[derive(Serialize, ToSchema)]
pub struct VersionDoc {
    pub version: i32,
    #[schema(value_type = Object)]
    pub doc: Value,
}

#[utoipa::path(get, path = "/api/projects/{project}/versions/{version}", tag = "projects", params(("project" = Uuid, Path), ("version" = i32, Path)), responses((status = 200, body = VersionDoc)))]
pub async fn version(
    State(state): State<AppState>,
    p: Principal,
    Path((project, version)): Path<(Uuid, i32)>,
) -> ApiResult<Json<VersionDoc>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(VersionDoc {
        version,
        doc: tessery_db::projects::get_version(&state.db, project, version).await?,
    }))
}

#[derive(Serialize, ToSchema)]
pub struct GeneratedDto {
    /// Generated file contents by relative path, for the saved design.
    pub files: std::collections::BTreeMap<String, String>,
}

/// Everything Tessery generates from the saved design: services, web apps, infrastructure, CI.
#[utoipa::path(get, path = "/api/projects/{project}/generated", tag = "projects", params(("project" = Uuid, Path)), responses((status = 200, body = GeneratedDto)))]
pub async fn generated(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
) -> ApiResult<Json<GeneratedDto>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    let doc = ProjectDto::from(saved).doc;
    let previous = crate::routes::delivery::previous_migrations(&state, project).await;
    let files = state.engine.generate(&doc, previous.as_ref()).await.map_err(crate::routes::delivery::engine_err)?;
    Ok(Json(GeneratedDto { files }))
}
