use crate::error::{DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Token {
    pub id: Uuid,
    pub user_id: Uuid,
    pub name: String,
    pub prefix: String,
    pub permissions: Option<Vec<String>>,
    pub project_id: Option<Uuid>,
    pub expires_at: Option<OffsetDateTime>,
    pub last_used_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub struct NewToken<'a> {
    pub user_id: Uuid,
    pub name: &'a str,
    pub prefix: &'a str,
    pub hash: &'a [u8],
    pub permissions: Option<&'a [String]>,
    pub project_id: Option<Uuid>,
    pub expires_at: Option<OffsetDateTime>,
}

pub async fn create(ex: impl PgExecutor<'_>, t: NewToken<'_>) -> DbResult<Token> {
    Ok(sqlx::query_as!(
        Token,
        r#"INSERT INTO api_tokens (user_id, name, prefix, hash, permissions, project_id, expires_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, user_id, name, prefix, permissions, project_id, expires_at, last_used_at, created_at"#,
        t.user_id,
        t.name,
        t.prefix,
        t.hash,
        t.permissions,
        t.project_id,
        t.expires_at
    )
    .fetch_one(ex)
    .await?)
}

pub async fn list(ex: impl PgExecutor<'_>, user_id: Uuid) -> DbResult<Vec<Token>> {
    Ok(sqlx::query_as!(
        Token,
        r#"SELECT id, user_id, name, prefix, permissions, project_id, expires_at, last_used_at, created_at
           FROM api_tokens WHERE user_id = $1 AND revoked_at IS NULL ORDER BY created_at DESC"#,
        user_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn authenticate(ex: impl PgExecutor<'_>, hash: &[u8]) -> DbResult<Token> {
    sqlx::query_as!(
        Token,
        r#"UPDATE api_tokens SET last_used_at = CASE WHEN last_used_at IS NULL OR last_used_at < now() - interval '1 minute' THEN now() ELSE last_used_at END
           WHERE hash = $1 AND revoked_at IS NULL AND (expires_at IS NULL OR expires_at > now())
           RETURNING id, user_id, name, prefix, permissions, project_id, expires_at, last_used_at, created_at"#,
        hash
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn revoke(ex: impl PgExecutor<'_>, user_id: Uuid, id: Uuid) -> DbResult<bool> {
    Ok(sqlx::query!("UPDATE api_tokens SET revoked_at = now() WHERE id = $1 AND user_id = $2 AND revoked_at IS NULL", id, user_id)
        .execute(ex)
        .await?
        .rows_affected()
        == 1)
}
