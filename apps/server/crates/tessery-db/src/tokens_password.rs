use crate::error::DbResult;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

pub async fn create(ex: impl PgExecutor<'_>, hash: &[u8], user: Uuid, purpose: &str, expires_at: OffsetDateTime) -> DbResult<()> {
    sqlx::query!("INSERT INTO password_tokens (hash, user_id, purpose, expires_at) VALUES ($1, $2, $3, $4)", hash, user, purpose, expires_at)
        .execute(ex)
        .await?;
    Ok(())
}

pub async fn consume(ex: impl PgExecutor<'_>, hash: &[u8]) -> DbResult<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        "UPDATE password_tokens SET used_at = now() WHERE hash = $1 AND used_at IS NULL AND expires_at > now() RETURNING user_id",
        hash
    )
    .fetch_optional(ex)
    .await?)
}

pub async fn peek(ex: impl PgExecutor<'_>, hash: &[u8]) -> DbResult<Option<(Uuid, String)>> {
    Ok(sqlx::query!("SELECT user_id, purpose FROM password_tokens WHERE hash = $1 AND used_at IS NULL AND expires_at > now()", hash)
        .fetch_optional(ex)
        .await?
        .map(|r| (r.user_id, r.purpose)))
}
