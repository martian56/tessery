use crate::error::{DbResult, OptionalExt};
use crate::types::{AuditResult, ExportStatus};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone, Default)]
pub struct NewEvent {
    pub org_id: Option<Uuid>,
    pub actor_id: Option<Uuid>,
    pub actor_email: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub result: Option<AuditResult>,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub details: Value,
}

#[derive(Debug, Clone, Serialize)]
pub struct Event {
    pub id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub org_id: Option<Uuid>,
    pub actor_id: Option<Uuid>,
    pub actor_email: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub result: AuditResult,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    pub details: Value,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize)]
pub struct Filter {
    pub actor: Option<String>,
    pub action: Option<String>,
    pub result: Option<AuditResult>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub since: Option<OffsetDateTime>,
    #[serde(default, with = "time::serde::rfc3339::option")]
    pub until: Option<OffsetDateTime>,
}

pub async fn insert(ex: impl PgExecutor<'_>, e: NewEvent) -> DbResult<()> {
    sqlx::query!(
        "INSERT INTO audit_events (org_id, actor_id, actor_email, action, resource_type, resource_id, result, ip, user_agent, details)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)",
        e.org_id,
        e.actor_id,
        e.actor_email,
        e.action,
        e.resource_type,
        e.resource_id,
        e.result.unwrap_or(AuditResult::Allowed) as AuditResult,
        e.ip,
        e.user_agent,
        e.details
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn list(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    f: &Filter,
    before: Option<i64>,
    limit: i64,
) -> DbResult<Vec<Event>> {
    Ok(sqlx::query_as!(
        Event,
        r#"SELECT id, at, org_id, actor_id, actor_email, action, resource_type, resource_id, result AS "result: AuditResult",
                  ip, user_agent, details
           FROM audit_events
           WHERE org_id = $1
             AND ($2::bigint IS NULL OR id < $2)
             AND ($3::text IS NULL OR actor_email ILIKE '%' || $3 || '%')
             AND ($4::text IS NULL OR action LIKE $4 || '%')
             AND ($5::audit_result IS NULL OR result = $5)
             AND ($6::timestamptz IS NULL OR at >= $6)
             AND ($7::timestamptz IS NULL OR at < $7)
           ORDER BY id DESC LIMIT $8"#,
        org_id,
        before,
        f.actor,
        f.action,
        f.result as Option<AuditResult>,
        f.since,
        f.until,
        limit
    )
    .fetch_all(ex)
    .await?)
}

#[derive(Debug, Clone)]
pub struct Export {
    pub id: Uuid,
    pub org_id: Uuid,
    pub format: String,
    pub filters: Value,
    pub status: ExportStatus,
    pub row_count: Option<i32>,
    pub error: Option<String>,
    pub created_at: OffsetDateTime,
    pub finished_at: Option<OffsetDateTime>,
}

pub async fn create_export(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    user: Uuid,
    format: &str,
    filters: &Value,
) -> DbResult<Export> {
    Ok(sqlx::query_as!(
        Export,
        r#"INSERT INTO audit_exports (org_id, requested_by, format, filters) VALUES ($1, $2, $3, $4)
           RETURNING id, org_id, format, filters, status AS "status: ExportStatus", row_count, error, created_at, finished_at"#,
        org_id,
        user,
        format,
        filters
    )
    .fetch_one(ex)
    .await?)
}

pub async fn get_export(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<Export> {
    sqlx::query_as!(
        Export,
        r#"SELECT id, org_id, format, filters, status AS "status: ExportStatus", row_count, error, created_at, finished_at
           FROM audit_exports WHERE org_id = $1 AND id = $2"#,
        org_id,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn export_content(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    id: Uuid,
) -> DbResult<Option<String>> {
    sqlx::query_scalar!(
        "SELECT content FROM audit_exports WHERE org_id = $1 AND id = $2 AND status = 'done'",
        org_id,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn claim_export(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Option<Export>> {
    Ok(sqlx::query_as!(
        Export,
        r#"UPDATE audit_exports SET status = 'running' WHERE id = $1 AND status = 'queued'
           RETURNING id, org_id, format, filters, status AS "status: ExportStatus", row_count, error, created_at, finished_at"#,
        id
    )
    .fetch_optional(ex)
    .await?)
}

pub async fn finish_export(
    ex: impl PgExecutor<'_>,
    id: Uuid,
    rows: i32,
    content: &str,
) -> DbResult<()> {
    sqlx::query!("UPDATE audit_exports SET status = 'done', row_count = $2, content = $3, finished_at = now() WHERE id = $1", id, rows, content)
        .execute(ex)
        .await?;
    Ok(())
}

pub async fn fail_export(ex: impl PgExecutor<'_>, id: Uuid, error: &str) -> DbResult<()> {
    sqlx::query!(
        "UPDATE audit_exports SET status = 'failed', error = $2, finished_at = now() WHERE id = $1",
        id,
        error
    )
    .execute(ex)
    .await?;
    Ok(())
}
