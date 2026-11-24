use crate::error::DbResult;
use serde::Serialize;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Serialize)]
pub struct SystemUpdate {
    pub id: Uuid,
    pub from_version: String,
    pub to_version: String,
    pub kind: String,
    pub automatic: bool,
    pub started_by: Option<Uuid>,
    pub started_by_email: Option<String>,
    pub started_at: OffsetDateTime,
}

pub async fn record(ex: impl PgExecutor<'_>, from: &str, to: &str, kind: &str, started_by: Option<Uuid>) -> DbResult<()> {
    sqlx::query!(
        "INSERT INTO system_updates (from_version, to_version, kind, automatic, started_by) VALUES ($1, $2, $3, $4, $5)",
        from,
        to,
        kind,
        started_by.is_none(),
        started_by
    )
    .execute(ex)
    .await?;
    Ok(())
}

/// The most recent updates and rollbacks, newest first.
pub async fn list(ex: impl PgExecutor<'_>, limit: i64) -> DbResult<Vec<SystemUpdate>> {
    Ok(sqlx::query_as!(
        SystemUpdate,
        r#"SELECT u.id, u.from_version, u.to_version, u.kind, u.automatic, u.started_by, us.email AS "started_by_email?", u.started_at
           FROM system_updates u LEFT JOIN users us ON us.id = u.started_by
           ORDER BY u.started_at DESC LIMIT $1"#,
        limit
    )
    .fetch_all(ex)
    .await?)
}
