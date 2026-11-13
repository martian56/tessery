use crate::error::{DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Server {
    pub id: Uuid,
    pub org_id: Uuid,
    pub name: String,
    pub address: String,
    pub public_key: String,
    pub known_hosts: String,
    pub last_check: Option<serde_json::Value>,
    pub checked_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub struct Credentials {
    pub address: String,
    pub private_key: Vec<u8>,
    pub known_hosts: String,
}

pub struct NewServer<'a> {
    pub org_id: Uuid,
    pub name: &'a str,
    pub address: &'a str,
    pub private_key: &'a [u8],
    pub public_key: &'a str,
    pub known_hosts: &'a str,
    pub created_by: Uuid,
}

pub async fn list(ex: impl PgExecutor<'_>, org: Uuid) -> DbResult<Vec<Server>> {
    Ok(sqlx::query_as!(
        Server,
        "SELECT id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at FROM servers WHERE org_id = $1 ORDER BY name",
        org
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<Server> {
    sqlx::query_as!(
        Server,
        "SELECT id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at FROM servers WHERE org_id = $1 AND id = $2",
        org,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn credentials(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<Credentials> {
    sqlx::query_as!(Credentials, "SELECT address, private_key, known_hosts FROM servers WHERE org_id = $1 AND id = $2", org, id)
        .fetch_optional(ex)
        .await?
        .or_not_found()
}

pub async fn create(ex: impl PgExecutor<'_>, s: NewServer<'_>) -> DbResult<Server> {
    Ok(sqlx::query_as!(
        Server,
        r#"INSERT INTO servers (org_id, name, address, private_key, public_key, known_hosts, created_by)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at"#,
        s.org_id,
        s.name,
        s.address,
        s.private_key,
        s.public_key,
        s.known_hosts,
        s.created_by
    )
    .fetch_one(ex)
    .await?)
}

pub struct ServerUpdate<'a> {
    pub name: Option<&'a str>,
    pub address: Option<&'a str>,
    pub private_key: Option<&'a [u8]>,
    pub public_key: Option<&'a str>,
    pub known_hosts: Option<&'a str>,
}

pub async fn update(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid, u: ServerUpdate<'_>) -> DbResult<Server> {
    sqlx::query_as!(
        Server,
        r#"UPDATE servers SET
             name = COALESCE($3, name),
             address = COALESCE($4, address),
             private_key = COALESCE($5, private_key),
             public_key = COALESCE($6, public_key),
             known_hosts = COALESCE($7, known_hosts),
             last_check = CASE WHEN $4::text IS NULL AND $5::bytea IS NULL THEN last_check END,
             checked_at = CASE WHEN $4::text IS NULL AND $5::bytea IS NULL THEN checked_at END
           WHERE org_id = $1 AND id = $2
           RETURNING id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at"#,
        org,
        id,
        u.name,
        u.address,
        u.private_key,
        u.public_key,
        u.known_hosts
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn record_check(ex: impl PgExecutor<'_>, id: Uuid, check: &serde_json::Value) -> DbResult<()> {
    sqlx::query!("UPDATE servers SET last_check = $2, checked_at = now() WHERE id = $1", id, check).execute(ex).await?;
    Ok(())
}

pub async fn delete(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!("DELETE FROM servers WHERE org_id = $1 AND id = $2", org, id).execute(ex).await?;
    if r.rows_affected() == 0 {
        return Err(crate::DbError::NotFound);
    }
    Ok(())
}

pub async fn org_of_project(ex: impl PgExecutor<'_>, project: Uuid) -> DbResult<Uuid> {
    sqlx::query_scalar!("SELECT org_id FROM projects WHERE id = $1", project).fetch_optional(ex).await?.or_not_found()
}

pub struct ProjectDoc {
    pub id: Uuid,
    pub name: String,
    pub doc: serde_json::Value,
}

pub async fn project_docs(ex: impl PgExecutor<'_>, org: Uuid) -> DbResult<Vec<ProjectDoc>> {
    Ok(sqlx::query_as!(ProjectDoc, "SELECT id, name, doc FROM projects WHERE org_id = $1", org).fetch_all(ex).await?)
}
