use crate::error::{DbError, DbResult};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Asset {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: String,
    pub content_type: String,
    pub size_bytes: i64,
    pub sha256: Vec<u8>,
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_by: Option<Uuid>,
    pub created_at: OffsetDateTime,
}

impl Asset {
    /// Where the bytes live in object storage.
    pub fn object_key(&self) -> String {
        format!("projects/{}/assets/{}", self.project_id, self.id)
    }
}

pub struct NewAsset<'a> {
    pub id: Uuid,
    pub project_id: Uuid,
    pub name: &'a str,
    pub content_type: &'a str,
    pub size_bytes: i64,
    pub sha256: &'a [u8],
    pub width: Option<i32>,
    pub height: Option<i32>,
    pub created_by: Uuid,
}

pub async fn insert(ex: impl PgExecutor<'_>, a: NewAsset<'_>) -> DbResult<Asset> {
    Ok(sqlx::query_as!(
        Asset,
        "INSERT INTO assets (id, project_id, name, content_type, size_bytes, sha256, width, height, created_by) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *",
        a.id,
        a.project_id,
        a.name,
        a.content_type,
        a.size_bytes,
        a.sha256,
        a.width,
        a.height,
        a.created_by
    )
    .fetch_one(ex)
    .await?)
}

pub async fn list(ex: impl PgExecutor<'_>, project: Uuid) -> DbResult<Vec<Asset>> {
    Ok(sqlx::query_as!(Asset, "SELECT * FROM assets WHERE project_id = $1 ORDER BY created_at DESC", project).fetch_all(ex).await?)
}

pub async fn get(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Asset> {
    sqlx::query_as!(Asset, "SELECT * FROM assets WHERE id = $1", id).fetch_optional(ex).await?.ok_or(DbError::NotFound)
}

pub async fn many(ex: impl PgExecutor<'_>, project: Uuid, ids: &[Uuid]) -> DbResult<Vec<Asset>> {
    Ok(sqlx::query_as!(Asset, "SELECT * FROM assets WHERE project_id = $1 AND id = ANY($2)", project, ids).fetch_all(ex).await?)
}

pub async fn delete(ex: impl PgExecutor<'_>, project: Uuid, id: Uuid) -> DbResult<Asset> {
    sqlx::query_as!(Asset, "DELETE FROM assets WHERE project_id = $1 AND id = $2 RETURNING *", project, id).fetch_optional(ex).await?.ok_or(DbError::NotFound)
}
