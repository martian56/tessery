use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::delivery::env_target;
use crate::state::AppState;
use tessery_core::Permission as P;
use tessery_db::backups as db;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

pub const BACKUP_TECHS: &[&str] = &["postgres", "timescaledb", "pgvector", "mysql", "mariadb", "mongodb"];

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct BackupDto {
    pub id: Uuid,
    pub node: String,
    /// `scheduled`, `manual` or `release`.
    pub kind: String,
    /// `queued`, `running`, `done`, `failed`, `restoring` or `restored`.
    pub status: String,
    pub bucket: String,
    pub object_key: String,
    pub size_bytes: i64,
    pub error: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub finished_at: Option<OffsetDateTime>,
}

impl From<db::Backup> for BackupDto {
    fn from(b: db::Backup) -> Self {
        Self { id: b.id, node: b.node, kind: b.kind, status: b.status, bucket: b.bucket, object_key: b.object_key, size_bytes: b.size_bytes, error: b.error, created_at: b.created_at, finished_at: b.finished_at }
    }
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/backups", tag = "backups", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 200, body = [BackupDto])))]
pub async fn list(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<Json<Vec<BackupDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &env_target(&target, &env), P::DeploymentRead).await?;
    Ok(Json(db::list(&state.db, project, &env, 100).await?.into_iter().map(Into::into).collect()))
}

/// Backs up every supported data store the environment runs, now.
#[utoipa::path(post, path = "/api/projects/{project}/environments/{env}/backups", tag = "backups", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 202, body = [BackupDto]), (status = 409)))]
pub async fn create(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<(StatusCode, Json<Vec<BackupDto>>)> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &env_target(&target, &env), P::DeploymentRun).await?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    let environment = saved.doc["environments"].as_array().into_iter().flatten().find(|e| e["id"] == env.as_str()).ok_or_else(|| ApiError::invalid("env", "no such environment in the design"))?;
    if environment.pointer("/backups/integration").and_then(Value::as_str).is_none() {
        return Err(ApiError::Conflict(format!("choose where {} backups go first", environment["name"].as_str().unwrap_or(&env))));
    }
    if !tessery_db::delivery::heads(&state.db, project).await?.iter().any(|h| h.env_key == env) {
        return Err(ApiError::Conflict(format!("nothing runs in {env} yet")));
    }
    let nodes: Vec<String> = saved.doc["nodes"]
        .as_array()
        .into_iter()
        .flatten()
        .filter(|n| n["techId"].as_str().is_some_and(|t| BACKUP_TECHS.contains(&t)))
        .filter_map(|n| n["name"].as_str().map(str::to_owned))
        .collect();
    if nodes.is_empty() {
        return Err(ApiError::Conflict("this design has no database Tessery can back up yet (PostgreSQL, MySQL, MariaDB and MongoDB are supported)".into()));
    }
    let mut out = Vec::new();
    for node in nodes {
        let b = db::create(&state.db, project, &env, &node, "manual", Some(p.user.id)).await?;
        state.mq.publish(tessery_mq::Job::Backup { backup_id: b.id }).await.map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
        out.push(b.into());
    }
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "backup.create", "project", project).decision(d).details(json!({ "env": env }))).await?;
    Ok((StatusCode::ACCEPTED, Json(out)))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RestoreInput {
    /// The environment id, typed by the person restoring, as confirmation.
    pub confirm: String,
}

/// Replaces the data store's contents with this backup.
#[utoipa::path(post, path = "/api/backups/{backup}/restore", tag = "backups", params(("backup" = Uuid, Path)), request_body = RestoreInput, responses((status = 202, body = BackupDto)))]
pub async fn restore(State(state): State<AppState>, p: Principal, Path(id): Path<Uuid>, Json(req): Json<RestoreInput>) -> ApiResult<(StatusCode, Json<BackupDto>)> {
    let b = db::get(&state.db, id).await?;
    let target = rbac::project_target(&state, b.project_id).await?;
    let d = rbac::require(&state, &p, &env_target(&target, &b.env_key), P::DataWrite).await?;
    if req.confirm.trim() != b.env_key {
        return Err(ApiError::invalid("confirm", format!("type {} to confirm", b.env_key)));
    }
    if b.status != "done" && b.status != "restored" {
        return Err(ApiError::Conflict(format!("this backup is {}, so it cannot be restored", b.status)));
    }
    state.mq.publish(tessery_mq::Job::RestoreBackup { backup_id: id }).await.map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    db::set_status(&state.db, id, "restoring", "").await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "backup.restore", "project", b.project_id).decision(d).details(json!({ "env": b.env_key, "node": b.node, "backup": id }))).await?;
    Ok((StatusCode::ACCEPTED, Json(db::get(&state.db, id).await?.into())))
}
