use crate::error::{DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Backup {
    pub id: Uuid,
    pub project_id: Uuid,
    pub env_key: String,
    pub node: String,
    pub kind: String,
    pub status: String,
    pub bucket: String,
    pub object_key: String,
    pub size_bytes: i64,
    pub error: String,
    pub created_at: OffsetDateTime,
    pub finished_at: Option<OffsetDateTime>,
}

pub async fn create(ex: impl PgExecutor<'_>, project: Uuid, env: &str, node: &str, kind: &str, by: Option<Uuid>) -> DbResult<Backup> {
    Ok(sqlx::query_as!(
        Backup,
        r#"INSERT INTO backups (project_id, env_key, node, kind, created_by) VALUES ($1, $2, $3, $4, $5)
           RETURNING id, project_id, env_key, node, kind, status, bucket, object_key, size_bytes, error, created_at, finished_at"#,
        project,
        env,
        node,
        kind,
        by
    )
    .fetch_one(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Backup> {
    sqlx::query_as!(
        Backup,
        "SELECT id, project_id, env_key, node, kind, status, bucket, object_key, size_bytes, error, created_at, finished_at FROM backups WHERE id = $1",
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn list(ex: impl PgExecutor<'_>, project: Uuid, env: &str, limit: i64) -> DbResult<Vec<Backup>> {
    Ok(sqlx::query_as!(
        Backup,
        r#"SELECT id, project_id, env_key, node, kind, status, bucket, object_key, size_bytes, error, created_at, finished_at
           FROM backups WHERE project_id = $1 AND env_key = $2 ORDER BY created_at DESC LIMIT $3"#,
        project,
        env,
        limit
    )
    .fetch_all(ex)
    .await?)
}

pub async fn last_started(ex: impl PgExecutor<'_>, project: Uuid, env: &str) -> DbResult<Option<OffsetDateTime>> {
    Ok(sqlx::query_scalar!("SELECT max(created_at) FROM backups WHERE project_id = $1 AND env_key = $2 AND kind <> 'release' AND status <> 'failed'", project, env)
        .fetch_one(ex)
        .await?)
}

pub async fn set_status(ex: impl PgExecutor<'_>, id: Uuid, status: &str, error: &str) -> DbResult<()> {
    sqlx::query!(
        "UPDATE backups SET status = $2, error = $3, finished_at = CASE WHEN $2 IN ('done', 'failed', 'restored') THEN now() ELSE finished_at END WHERE id = $1",
        id,
        status,
        error
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn finish(ex: impl PgExecutor<'_>, id: Uuid, bucket: &str, key: &str, size: i64) -> DbResult<()> {
    sqlx::query!("UPDATE backups SET status = 'done', bucket = $2, object_key = $3, size_bytes = $4, finished_at = now() WHERE id = $1", id, bucket, key, size)
        .execute(ex)
        .await?;
    Ok(())
}

pub async fn done_for_node(ex: impl PgExecutor<'_>, project: Uuid, env: &str, node: &str) -> DbResult<Vec<Backup>> {
    Ok(sqlx::query_as!(
        Backup,
        r#"SELECT id, project_id, env_key, node, kind, status, bucket, object_key, size_bytes, error, created_at, finished_at
           FROM backups WHERE project_id = $1 AND env_key = $2 AND node = $3 AND status IN ('done', 'restored') ORDER BY created_at DESC"#,
        project,
        env,
        node
    )
    .fetch_all(ex)
    .await?)
}

pub async fn forget(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<()> {
    sqlx::query!("DELETE FROM backups WHERE id = $1", id).execute(ex).await?;
    Ok(())
}

pub struct Scheduled {
    pub id: Uuid,
    pub doc: serde_json::Value,
}

pub async fn projects_with_backups(ex: impl PgExecutor<'_>) -> DbResult<Vec<Scheduled>> {
    Ok(sqlx::query_as!(
        Scheduled,
        r#"SELECT id, doc FROM projects WHERE jsonb_path_exists(doc, '$.environments[*].backups.integration')"#
    )
    .fetch_all(ex)
    .await?)
}
