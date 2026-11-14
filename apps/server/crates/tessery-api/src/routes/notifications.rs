use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tessery_core::Permission as P;
use tessery_db::notifications as db;
use tessery_notify::{Delivery, EVENTS, Event, KINDS};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChannelDto {
    pub id: Uuid,
    pub name: String,
    /// `email`, `slack`, `discord`, `telegram` or `webhook`.
    pub kind: String,
    /// A safe preview of where messages go. The full target is never returned.
    pub target_hint: String,
    pub events: Vec<String>,
    /// Empty means every environment.
    pub envs: Vec<String>,
    pub enabled: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_sent_at: Option<OffsetDateTime>,
    pub last_error: Option<String>,
}

impl From<db::Channel> for ChannelDto {
    fn from(c: db::Channel) -> Self {
        Self { id: c.id, name: c.name, kind: c.kind, target_hint: c.target_hint, events: c.events, envs: c.envs, enabled: c.enabled, last_sent_at: c.last_sent_at, last_error: c.last_error }
    }
}

#[derive(Serialize, ToSchema)]
pub struct EventDto {
    pub key: String,
    pub label: String,
}

#[utoipa::path(get, path = "/api/notifications/events", tag = "notifications", responses((status = 200, body = [EventDto])))]
pub async fn events(_p: Principal) -> Json<Vec<EventDto>> {
    Json(EVENTS.iter().map(|(k, l)| EventDto { key: (*k).into(), label: (*l).into() }).collect())
}

#[utoipa::path(get, path = "/api/projects/{project}/notifications", tag = "notifications", params(("project" = Uuid, Path)), responses((status = 200, body = [ChannelDto])))]
pub async fn list(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<ChannelDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(db::list(&state.db, project).await?.into_iter().map(Into::into).collect()))
}

fn check_events(events: &[String]) -> ApiResult<()> {
    if events.is_empty() {
        return Err(ApiError::invalid("events", "choose at least one event"));
    }
    match events.iter().find(|e| !EVENTS.iter().any(|(k, _)| k == e)) {
        Some(e) => Err(ApiError::invalid("events", format!("unknown event {e}"))),
        None => Ok(()),
    }
}

#[derive(Deserialize, ToSchema)]
pub struct NewChannelInput {
    pub name: String,
    pub kind: String,
    /// Addresses separated by commas, a webhook URL, or `bot-token@chat-id` for Telegram.
    pub target: String,
    pub events: Vec<String>,
    #[serde(default)]
    pub envs: Vec<String>,
}

#[utoipa::path(post, path = "/api/projects/{project}/notifications", tag = "notifications", params(("project" = Uuid, Path)), request_body = NewChannelInput, responses((status = 201, body = ChannelDto)))]
pub async fn create(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>, Json(req): Json<NewChannelInput>) -> ApiResult<(StatusCode, Json<ChannelDto>)> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let name = req.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(ApiError::invalid("name", "use 1 to 80 characters"));
    }
    if !KINDS.contains(&req.kind.as_str()) {
        return Err(ApiError::invalid("kind", "use email, slack, discord, telegram or webhook"));
    }
    tessery_notify::check_target(&req.kind, &req.target).map_err(|e| ApiError::invalid("target", e))?;
    check_events(&req.events)?;
    let key = state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY to store notification targets".into()))?;
    let cipher = key.encrypt(req.target.trim().as_bytes());
    let c = db::create(
        &state.db,
        db::NewChannel { project_id: project, name, kind: &req.kind, target: &cipher, target_hint: &tessery_notify::preview(&req.kind, &req.target), events: &req.events, envs: &req.envs },
    )
    .await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "notification.create", "project", project).decision(d).details(json!({ "channel": c.id, "kind": c.kind, "name": c.name }))).await?;
    Ok((StatusCode::CREATED, Json(c.into())))
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateChannelInput {
    pub name: String,
    pub events: Vec<String>,
    #[serde(default)]
    pub envs: Vec<String>,
    pub enabled: bool,
}

#[utoipa::path(put, path = "/api/projects/{project}/notifications/{channel}", tag = "notifications", params(("project" = Uuid, Path), ("channel" = Uuid, Path)), request_body = UpdateChannelInput, responses((status = 200, body = ChannelDto)))]
pub async fn update(State(state): State<AppState>, p: Principal, Path((project, channel)): Path<(Uuid, Uuid)>, Json(req): Json<UpdateChannelInput>) -> ApiResult<Json<ChannelDto>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let name = req.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(ApiError::invalid("name", "use 1 to 80 characters"));
    }
    check_events(&req.events)?;
    let c = db::update(&state.db, project, channel, name, &req.events, &req.envs, req.enabled).await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "notification.update", "project", project).decision(d).details(json!({ "channel": c.id, "enabled": c.enabled }))).await?;
    Ok(Json(c.into()))
}

#[utoipa::path(delete, path = "/api/projects/{project}/notifications/{channel}", tag = "notifications", params(("project" = Uuid, Path), ("channel" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, p: Principal, Path((project, channel)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    db::delete(&state.db, project, channel).await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "notification.delete", "project", project).decision(d).details(json!({ "channel": channel }))).await?;
    Ok(Json(OK))
}

/// Sends a sample message to the channel now and reports what the other side answered.
#[utoipa::path(post, path = "/api/projects/{project}/notifications/{channel}/test", tag = "notifications", params(("project" = Uuid, Path), ("channel" = Uuid, Path)), responses((status = 200, body = Ok), (status = 409)))]
pub async fn test(State(state): State<AppState>, p: Principal, Path((project, channel)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let c = db::get(&state.db, project, channel).await?;
    let key = state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("TESSERY_SECRET_KEY is not set".into()))?;
    let to = String::from_utf8(key.decrypt(&c.target).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    let e = Event { kind: "test".into(), project: saved.name, env: String::new(), title: format!("Test message for {}", c.name), detail: format!("{} sent this from Tessery to check the channel.", p.user.name), link: None };
    let smtp = if c.kind == "email" { crate::mail::settings(&state).await? } else { None };
    let delivery = Delivery {
        kind: &c.kind,
        target: &to,
        smtp: smtp.as_ref().map(|(s, pw)| (s, pw.as_deref())).ok_or("email is not set up on this instance"),
        allow_private: state.config.notify_allow_private,
    };
    let outcome = tessery_notify::deliver(&delivery, &e).await;
    db::record(&state.db, c.id, outcome.as_ref().err().map(String::as_str)).await?;
    outcome.map_err(ApiError::Conflict)?;
    Ok(Json(OK))
}
