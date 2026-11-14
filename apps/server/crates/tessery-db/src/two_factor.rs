use crate::error::DbResult;
use sqlx::{PgExecutor, Postgres, Transaction};
use uuid::Uuid;

pub struct State {
    pub secret: Option<Vec<u8>>,
    pub enabled: bool,
    pub last_step: i64,
}

pub async fn state(ex: impl PgExecutor<'_>, user: Uuid) -> DbResult<State> {
    let r = sqlx::query!("SELECT totp_secret, two_factor_enabled_at IS NOT NULL AS \"enabled!\", totp_last_step FROM users WHERE id = $1", user).fetch_one(ex).await?;
    Ok(State { secret: r.totp_secret, enabled: r.enabled, last_step: r.totp_last_step })
}

pub async fn set_pending(ex: impl PgExecutor<'_>, user: Uuid, secret: &[u8]) -> DbResult<()> {
    sqlx::query!("UPDATE users SET totp_secret = $2 WHERE id = $1 AND two_factor_enabled_at IS NULL", user, secret).execute(ex).await?;
    Ok(())
}

pub async fn enable(tx: &mut Transaction<'_, Postgres>, user: Uuid, step: i64, codes: &[Vec<u8>]) -> DbResult<()> {
    sqlx::query!("UPDATE users SET two_factor_enabled_at = now(), totp_last_step = $2 WHERE id = $1", user, step).execute(&mut **tx).await?;
    replace_codes(tx, user, codes).await
}

pub async fn replace_codes(tx: &mut Transaction<'_, Postgres>, user: Uuid, codes: &[Vec<u8>]) -> DbResult<()> {
    sqlx::query!("DELETE FROM recovery_codes WHERE user_id = $1", user).execute(&mut **tx).await?;
    sqlx::query!("INSERT INTO recovery_codes (user_id, hash) SELECT $1, * FROM UNNEST($2::bytea[])", user, codes).execute(&mut **tx).await?;
    Ok(())
}

pub async fn disable(tx: &mut Transaction<'_, Postgres>, user: Uuid) -> DbResult<()> {
    sqlx::query!("UPDATE users SET totp_secret = NULL, two_factor_enabled_at = NULL, totp_last_step = 0 WHERE id = $1", user).execute(&mut **tx).await?;
    sqlx::query!("DELETE FROM recovery_codes WHERE user_id = $1", user).execute(&mut **tx).await?;
    Ok(())
}

/// Records a used time step. Returns false when this step or a later one was already used, which stops a code being replayed.
pub async fn use_step(ex: impl PgExecutor<'_>, user: Uuid, step: i64) -> DbResult<bool> {
    Ok(sqlx::query!("UPDATE users SET totp_last_step = $2 WHERE id = $1 AND totp_last_step < $2", user, step).execute(ex).await?.rows_affected() == 1)
}

pub async fn use_recovery_code(ex: impl PgExecutor<'_>, user: Uuid, hash: &[u8]) -> DbResult<bool> {
    Ok(sqlx::query!("UPDATE recovery_codes SET used_at = now() WHERE user_id = $1 AND hash = $2 AND used_at IS NULL", user, hash).execute(ex).await?.rows_affected() == 1)
}

pub async fn codes_left(ex: impl PgExecutor<'_>, user: Uuid) -> DbResult<i64> {
    Ok(sqlx::query_scalar!("SELECT count(*) AS \"n!\" FROM recovery_codes WHERE user_id = $1 AND used_at IS NULL", user).fetch_one(ex).await?)
}

pub async fn org_requires(ex: impl PgExecutor<'_>, org: Uuid) -> DbResult<bool> {
    Ok(sqlx::query_scalar!("SELECT require_two_factor FROM organizations WHERE id = $1", org).fetch_optional(ex).await?.unwrap_or(false))
}

pub async fn set_org_requires(ex: impl PgExecutor<'_>, org: Uuid, on: bool) -> DbResult<()> {
    sqlx::query!("UPDATE organizations SET require_two_factor = $2 WHERE id = $1", org, on).execute(ex).await?;
    Ok(())
}

pub async fn members_without(ex: impl PgExecutor<'_>, org: Uuid) -> DbResult<Vec<String>> {
    Ok(sqlx::query_scalar!(
        "SELECT u.email FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 AND u.two_factor_enabled_at IS NULL AND u.disabled_at IS NULL ORDER BY u.email",
        org
    )
    .fetch_all(ex)
    .await?)
}

pub async fn is_member(ex: impl PgExecutor<'_>, org: Uuid, user: Uuid) -> DbResult<bool> {
    Ok(sqlx::query_scalar!("SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2) AS \"e!\"", org, user).fetch_one(ex).await?)
}
