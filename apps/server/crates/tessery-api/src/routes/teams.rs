use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::routes::dto::{OK, Ok, clean_name, slug_or_from};
use crate::state::AppState;
use tessery_core::{OrgId, Permission as P, Target, TeamId};
use tessery_db::types::SubjectKind;
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
pub struct TeamDto {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub member_count: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<tessery_db::teams::Team> for TeamDto {
    fn from(t: tessery_db::teams::Team) -> Self {
        Self {
            id: t.id,
            slug: t.slug,
            name: t.name,
            description: t.description,
            member_count: t.member_count,
            created_at: t.created_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamMemberDto {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub added_at: OffsetDateTime,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TeamDetail {
    #[serde(flatten)]
    pub team: TeamDto,
    pub members: Vec<TeamMemberDto>,
}

fn team_target(org: Uuid, team: Uuid) -> Target {
    Target::Team {
        org: OrgId(org),
        team: TeamId(team),
    }
}

#[utoipa::path(get, path = "/api/orgs/{org}/teams", tag = "teams", params(("org" = Uuid, Path)), responses((status = 200, body = [TeamDto])))]
pub async fn list(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
) -> ApiResult<Json<Vec<TeamDto>>> {
    rbac::require(&state, &p, &org_target(org), P::TeamRead).await?;
    Ok(Json(
        tessery_db::teams::list(&state.db, org)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
pub struct TeamInput {
    pub name: String,
    pub slug: Option<String>,
    #[serde(default)]
    pub description: String,
}

#[utoipa::path(post, path = "/api/orgs/{org}/teams", tag = "teams", params(("org" = Uuid, Path)), request_body = TeamInput, responses((status = 201, body = TeamDto)))]
pub async fn create(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<TeamInput>,
) -> ApiResult<(StatusCode, Json<TeamDto>)> {
    let d = rbac::require(&state, &p, &org_target(org), P::TeamManage).await?;
    let name = clean_name("name", &req.name, 120)?;
    let slug = slug_or_from("slug", req.slug.as_deref(), &name)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    let t = tessery_db::teams::create(&mut *tx, org, &slug, &name, req.description.trim()).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "team.create", "team", t.id)
            .decision(d)
            .details(json!({ "slug": slug })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok((StatusCode::CREATED, Json(t.into())))
}

#[utoipa::path(get, path = "/api/orgs/{org}/teams/{team}", tag = "teams", params(("org" = Uuid, Path), ("team" = Uuid, Path)), responses((status = 200, body = TeamDetail)))]
pub async fn get(
    State(state): State<AppState>,
    p: Principal,
    Path((org, team)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<TeamDetail>> {
    rbac::require(&state, &p, &team_target(org, team), P::TeamRead).await?;
    let t = tessery_db::teams::get(&state.db, org, team).await?;
    let members = tessery_db::teams::list_members(&state.db, org, team).await?;
    Ok(Json(TeamDetail {
        team: t.into(),
        members: members
            .into_iter()
            .map(|m| TeamMemberDto {
                user_id: m.user_id,
                email: m.email,
                name: m.name,
                added_at: m.added_at,
            })
            .collect(),
    }))
}

#[utoipa::path(patch, path = "/api/orgs/{org}/teams/{team}", tag = "teams", params(("org" = Uuid, Path), ("team" = Uuid, Path)), request_body = TeamInput, responses((status = 200, body = TeamDto)))]
pub async fn update(
    State(state): State<AppState>,
    p: Principal,
    Path((org, team)): Path<(Uuid, Uuid)>,
    Json(req): Json<TeamInput>,
) -> ApiResult<Json<TeamDto>> {
    let d = rbac::require(&state, &p, &team_target(org, team), P::TeamManage).await?;
    let name = clean_name("name", &req.name, 120)?;
    let slug = slug_or_from("slug", req.slug.as_deref(), &name)?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::teams::update(&mut *tx, org, team, &slug, &name, req.description.trim()).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "team.update", "team", team).decision(d),
    )
    .await?;
    let t = tessery_db::teams::get(&mut *tx, org, team).await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(t.into()))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/teams/{team}", tag = "teams", params(("org" = Uuid, Path), ("team" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(
    State(state): State<AppState>,
    p: Principal,
    Path((org, team)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::TeamManage).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::bindings::delete_for_subject(&mut *tx, org, SubjectKind::Team, team).await?;
    tessery_db::teams::delete(&mut *tx, org, team).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "team.delete", "team", team).decision(d),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AddTeamMember {
    pub user_id: Uuid,
}

#[utoipa::path(post, path = "/api/orgs/{org}/teams/{team}/members", tag = "teams", params(("org" = Uuid, Path), ("team" = Uuid, Path)), request_body = AddTeamMember, responses((status = 200, body = Ok)))]
pub async fn add_member(
    State(state): State<AppState>,
    p: Principal,
    Path((org, team)): Path<(Uuid, Uuid)>,
    Json(req): Json<AddTeamMember>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &team_target(org, team), P::TeamManage).await?;
    tessery_db::teams::get(&state.db, org, team).await?;
    if !tessery_db::orgs::is_member(&state.db, org, req.user_id).await? {
        return Err(ApiError::invalid(
            "userId",
            "is not a member of this organization",
        ));
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::teams::add_member(&mut *tx, org, team, req.user_id).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "team.member_add", "team", team)
            .decision(d)
            .details(json!({ "userId": req.user_id })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/teams/{team}/members/{user}", tag = "teams", params(("org" = Uuid, Path), ("team" = Uuid, Path), ("user" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn remove_member(
    State(state): State<AppState>,
    p: Principal,
    Path((org, team, user)): Path<(Uuid, Uuid, Uuid)>,
) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &team_target(org, team), P::TeamManage).await?;
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    tessery_db::teams::remove_member(&mut *tx, org, team, user).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(org), "team.member_remove", "team", team)
            .decision(d)
            .details(json!({ "userId": user })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}
