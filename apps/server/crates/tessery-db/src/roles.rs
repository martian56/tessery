use crate::error::{DbError, DbResult, OptionalExt};
use sqlx::PgExecutor;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Role {
    pub id: Uuid,
    pub org_id: Option<Uuid>,
    pub key: String,
    pub name: String,
    pub description: String,
    pub permissions: Vec<String>,
}

impl Role {
    pub fn is_builtin(&self) -> bool {
        self.org_id.is_none()
    }
}

pub async fn list_for_org(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<Role>> {
    Ok(sqlx::query_as!(
        Role,
        "SELECT id, org_id, key, name, description, permissions FROM roles WHERE org_id IS NULL OR org_id = $1
         ORDER BY org_id NULLS FIRST, CASE key WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 WHEN 'deployer' THEN 3 WHEN 'viewer' THEN 4 ELSE 5 END, name",
        org_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<Role> {
    sqlx::query_as!(Role, "SELECT id, org_id, key, name, description, permissions FROM roles WHERE id = $2 AND (org_id IS NULL OR org_id = $1)", org_id, id)
        .fetch_optional(ex)
        .await?
        .or_not_found()
}

pub async fn get_by_key(ex: impl PgExecutor<'_>, org_id: Uuid, key: &str) -> DbResult<Role> {
    sqlx::query_as!(
        Role,
        "SELECT id, org_id, key, name, description, permissions FROM roles WHERE key = $2 AND (org_id IS NULL OR org_id = $1)
         ORDER BY org_id NULLS LAST LIMIT 1",
        org_id,
        key
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn create_custom(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    key: &str,
    name: &str,
    description: &str,
    permissions: &[String],
) -> DbResult<Role> {
    Ok(sqlx::query_as!(
        Role,
        "INSERT INTO roles (org_id, key, name, description, permissions) VALUES ($1, $2, $3, $4, $5)
         RETURNING id, org_id, key, name, description, permissions",
        org_id,
        key,
        name,
        description,
        permissions
    )
    .fetch_one(ex)
    .await?)
}

pub async fn update_custom(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    id: Uuid,
    name: &str,
    description: &str,
    permissions: &[String],
) -> DbResult<Role> {
    sqlx::query_as!(
        Role,
        "UPDATE roles SET name = $3, description = $4, permissions = $5, updated_at = now() WHERE org_id = $1 AND id = $2
         RETURNING id, org_id, key, name, description, permissions",
        org_id,
        id,
        name,
        description,
        permissions
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn delete_custom(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!(
        "DELETE FROM roles WHERE org_id = $1 AND id = $2",
        org_id,
        id
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}
