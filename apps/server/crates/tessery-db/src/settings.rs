use crate::error::DbResult;
use sqlx::PgExecutor;
use time::OffsetDateTime;

#[derive(Debug, Clone)]
pub struct InstanceSettings {
    pub setup_completed_at: Option<OffsetDateTime>,
    pub allow_org_creation: bool,
}

pub async fn get(ex: impl PgExecutor<'_>) -> DbResult<InstanceSettings> {
    Ok(sqlx::query_as!(
        InstanceSettings,
        "SELECT setup_completed_at, allow_org_creation FROM instance_settings"
    )
    .fetch_one(ex)
    .await?)
}

pub async fn complete_setup(ex: impl PgExecutor<'_>) -> DbResult<bool> {
    let r = sqlx::query!(
        "UPDATE instance_settings SET setup_completed_at = now() WHERE setup_completed_at IS NULL"
    )
    .execute(ex)
    .await?;
    Ok(r.rows_affected() == 1)
}

pub async fn set_allow_org_creation(ex: impl PgExecutor<'_>, value: bool) -> DbResult<()> {
    sqlx::query!(
        "UPDATE instance_settings SET allow_org_creation = $1",
        value
    )
    .execute(ex)
    .await?;
    Ok(())
}
