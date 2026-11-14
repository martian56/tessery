use crate::error::{DbError, DbResult};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Channel {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub kind: String,
    pub target: Vec<u8>,
    pub target_hint: String,
    pub events: Vec<String>,
    pub envs: Vec<String>,
    pub enabled: bool,
    pub last_sent_at: Option<OffsetDateTime>,
    pub last_error: Option<String>,
    pub created_at: OffsetDateTime,
}

pub struct NewChannel<'a> {
    pub project_id: Uuid,
    pub name: &'a str,
    pub kind: &'a str,
    pub target: &'a [u8],
    pub target_hint: &'a str,
    pub events: &'a [String],
    pub envs: &'a [String],
}

pub async fn list(ex: impl PgExecutor<'_>, project: Uuid) -> DbResult<Vec<Channel>> {
    Ok(sqlx::query_as!(Channel, "SELECT * FROM notification_channels WHERE project_id = $1 ORDER BY created_at", project).fetch_all(ex).await?)
}

pub async fn get(ex: impl PgExecutor<'_>, project: Uuid, id: Uuid) -> DbResult<Channel> {
    sqlx::query_as!(Channel, "SELECT * FROM notification_channels WHERE project_id = $1 AND id = $2", project, id).fetch_optional(ex).await?.ok_or(DbError::NotFound)
}

pub async fn create(ex: impl PgExecutor<'_>, c: NewChannel<'_>) -> DbResult<Channel> {
    Ok(sqlx::query_as!(
        Channel,
        "INSERT INTO notification_channels (id, project_id, name, kind, target, target_hint, events, envs) VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *",
        Uuid::now_v7(),
        c.project_id,
        c.name,
        c.kind,
        c.target,
        c.target_hint,
        c.events,
        c.envs
    )
    .fetch_one(ex)
    .await?)
}

pub async fn update(ex: impl PgExecutor<'_>, project: Uuid, id: Uuid, name: &str, events: &[String], envs: &[String], enabled: bool) -> DbResult<Channel> {
    sqlx::query_as!(
        Channel,
        "UPDATE notification_channels SET name = $3, events = $4, envs = $5, enabled = $6 WHERE project_id = $1 AND id = $2 RETURNING *",
        project,
        id,
        name,
        events,
        envs,
        enabled
    )
    .fetch_optional(ex)
    .await?
    .ok_or(DbError::NotFound)
}

pub async fn delete(ex: impl PgExecutor<'_>, project: Uuid, id: Uuid) -> DbResult<()> {
    let n = sqlx::query!("DELETE FROM notification_channels WHERE project_id = $1 AND id = $2", project, id).execute(ex).await?.rows_affected();
    if n == 0 { Err(DbError::NotFound) } else { Ok(()) }
}

pub async fn subscribed(ex: impl PgExecutor<'_>, project: Uuid, event: &str, env: &str) -> DbResult<Vec<Channel>> {
    Ok(sqlx::query_as!(
        Channel,
        "SELECT * FROM notification_channels WHERE project_id = $1 AND enabled AND $2 = ANY(events) AND (cardinality(envs) = 0 OR $3 = ANY(envs))",
        project,
        event,
        env
    )
    .fetch_all(ex)
    .await?)
}

pub async fn record(ex: impl PgExecutor<'_>, id: Uuid, error: Option<&str>) -> DbResult<()> {
    sqlx::query!("UPDATE notification_channels SET last_sent_at = now(), last_error = $2 WHERE id = $1", id, error).execute(ex).await?;
    Ok(())
}
