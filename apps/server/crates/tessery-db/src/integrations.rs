use crate::error::{DbResult, OptionalExt};
use serde_json::Value;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Integration {
    pub id: Uuid,
    pub org_id: Uuid,
    pub provider: String,
    pub name: String,
    pub summary: Value,
    pub last_check: Option<Value>,
    pub checked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub struct NewIntegration<'a> {
    pub org_id: Uuid,
    pub provider: &'a str,
    pub name: &'a str,
    pub secret: &'a [u8],
    pub summary: &'a Value,
    pub check: &'a Value,
    pub created_by: Uuid,
}

pub async fn list(ex: impl PgExecutor<'_>, org: Uuid) -> DbResult<Vec<Integration>> {
    Ok(sqlx::query_as!(
        Integration,
        "SELECT id, org_id, provider, name, summary, last_check, checked_at, created_at FROM integrations WHERE org_id = $1 ORDER BY provider, name",
        org
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<Integration> {
    sqlx::query_as!(
        Integration,
        "SELECT id, org_id, provider, name, summary, last_check, checked_at, created_at FROM integrations WHERE org_id = $1 AND id = $2",
        org,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn secret(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<(String, Vec<u8>)> {
    let r = sqlx::query!("SELECT provider, secret FROM integrations WHERE org_id = $1 AND id = $2", org, id).fetch_optional(ex).await?.or_not_found()?;
    Ok((r.provider, r.secret))
}

pub async fn create(ex: impl PgExecutor<'_>, n: NewIntegration<'_>) -> DbResult<Integration> {
    Ok(sqlx::query_as!(
        Integration,
        r#"INSERT INTO integrations (org_id, provider, name, secret, summary, last_check, checked_at, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, now(), $7)
           RETURNING id, org_id, provider, name, summary, last_check, checked_at, created_at"#,
        n.org_id,
        n.provider,
        n.name,
        n.secret,
        n.summary,
        n.check,
        n.created_by
    )
    .fetch_one(ex)
    .await?)
}

pub async fn update(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid, name: Option<&str>, secret: Option<(&[u8], &Value)>) -> DbResult<Integration> {
    let (cipher, summary) = secret.map_or((None, None), |(c, s)| (Some(c), Some(s)));
    sqlx::query_as!(
        Integration,
        r#"UPDATE integrations SET name = COALESCE($3, name), secret = COALESCE($4, secret), summary = COALESCE($5, summary)
           WHERE org_id = $1 AND id = $2
           RETURNING id, org_id, provider, name, summary, last_check, checked_at, created_at"#,
        org,
        id,
        name,
        cipher,
        summary
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn record_check(ex: impl PgExecutor<'_>, id: Uuid, check: &Value) -> DbResult<()> {
    sqlx::query!("UPDATE integrations SET last_check = $2, checked_at = now() WHERE id = $1", id, check).execute(ex).await?;
    Ok(())
}

pub async fn delete(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!("DELETE FROM integrations WHERE org_id = $1 AND id = $2", org, id).execute(ex).await?;
    if r.rows_affected() == 0 {
        return Err(crate::DbError::NotFound);
    }
    Ok(())
}
