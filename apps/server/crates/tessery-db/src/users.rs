use crate::error::{DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct User {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub password_hash: Option<String>,
    pub is_instance_admin: bool,
    pub disabled_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub last_login_at: Option<OffsetDateTime>,
    pub two_factor_enabled_at: Option<OffsetDateTime>,
}

pub async fn create(
    ex: impl PgExecutor<'_>,
    email: &str,
    name: &str,
    password_hash: Option<&str>,
    instance_admin: bool,
) -> DbResult<User> {
    Ok(sqlx::query_as!(
        User,
        "INSERT INTO users (email, name, password_hash, is_instance_admin) VALUES ($1, $2, $3, $4)
         RETURNING id, email, name, password_hash, is_instance_admin, disabled_at, created_at, last_login_at, two_factor_enabled_at",
        email,
        name,
        password_hash,
        instance_admin
    )
    .fetch_one(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<User> {
    sqlx::query_as!(User, "SELECT id, email, name, password_hash, is_instance_admin, disabled_at, created_at, last_login_at, two_factor_enabled_at FROM users WHERE id = $1", id)
        .fetch_optional(ex)
        .await?
        .or_not_found()
}

pub async fn find_by_email(ex: impl PgExecutor<'_>, email: &str) -> DbResult<Option<User>> {
    Ok(sqlx::query_as!(User, "SELECT id, email, name, password_hash, is_instance_admin, disabled_at, created_at, last_login_at, two_factor_enabled_at FROM users WHERE email = $1", email)
        .fetch_optional(ex)
        .await?)
}

pub async fn list_all(ex: impl PgExecutor<'_>) -> DbResult<Vec<User>> {
    Ok(sqlx::query_as!(User, "SELECT id, email, name, password_hash, is_instance_admin, disabled_at, created_at, last_login_at, two_factor_enabled_at FROM users ORDER BY created_at")
        .fetch_all(ex)
        .await?)
}

pub async fn count(ex: impl PgExecutor<'_>) -> DbResult<i64> {
    Ok(sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM users"#)
        .fetch_one(ex)
        .await?)
}

pub async fn count_instance_admins(ex: impl PgExecutor<'_>) -> DbResult<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM users WHERE is_instance_admin AND disabled_at IS NULL"#
    )
    .fetch_one(ex)
    .await?)
}

pub async fn update_profile(ex: impl PgExecutor<'_>, id: Uuid, name: &str) -> DbResult<()> {
    let r = sqlx::query!("UPDATE users SET name = $2 WHERE id = $1", id, name)
        .execute(ex)
        .await?;
    if r.rows_affected() == 0 {
        Err(crate::DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn set_password(ex: impl PgExecutor<'_>, id: Uuid, password_hash: &str) -> DbResult<()> {
    sqlx::query!(
        "UPDATE users SET password_hash = $2 WHERE id = $1",
        id,
        password_hash
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn set_instance_admin(ex: impl PgExecutor<'_>, id: Uuid, value: bool) -> DbResult<()> {
    let r = sqlx::query!(
        "UPDATE users SET is_instance_admin = $2 WHERE id = $1",
        id,
        value
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(crate::DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn set_disabled(ex: impl PgExecutor<'_>, id: Uuid, disabled: bool) -> DbResult<()> {
    let r = sqlx::query!(
        "UPDATE users SET disabled_at = CASE WHEN $2 THEN now() ELSE NULL END WHERE id = $1",
        id,
        disabled
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(crate::DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn touch_login(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<()> {
    sqlx::query!("UPDATE users SET last_login_at = now() WHERE id = $1", id)
        .execute(ex)
        .await?;
    Ok(())
}
