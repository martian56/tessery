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
    pub integration_id: Option<Uuid>,
    pub provider: Option<String>,
    pub region: Option<String>,
    pub size: Option<String>,
    pub resource_id: Option<String>,
    pub status: String,
    pub status_detail: String,
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
        "SELECT id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail FROM servers WHERE org_id = $1 ORDER BY name",
        org
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, org: Uuid, id: Uuid) -> DbResult<Server> {
    sqlx::query_as!(
        Server,
        "SELECT id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail FROM servers WHERE org_id = $1 AND id = $2",
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
           RETURNING id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail"#,
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
           RETURNING id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail"#,
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

pub async fn record_check(ex: impl PgExecutor<'_>, id: Uuid, used: &Credentials, check: &serde_json::Value, pin: Option<&str>) -> DbResult<bool> {
    let r = sqlx::query!(
        r#"UPDATE servers SET last_check = $5, checked_at = now(),
             known_hosts = CASE WHEN known_hosts = '' AND $6::text IS NOT NULL THEN $6 ELSE known_hosts END
           WHERE id = $1 AND address = $2 AND private_key = $3 AND known_hosts = $4"#,
        id,
        used.address,
        used.private_key,
        used.known_hosts,
        check,
        pin
    )
    .execute(ex)
    .await?;
    Ok(r.rows_affected() == 1)
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

pub struct NewMachineServer<'a> {
    pub org_id: Uuid,
    pub name: &'a str,
    pub private_key: &'a [u8],
    pub public_key: &'a str,
    pub integration_id: Uuid,
    pub provider: &'a str,
    pub region: &'a str,
    pub size: &'a str,
    pub resource_id: &'a str,
    pub created_by: Uuid,
}

pub async fn create_machine(ex: impl PgExecutor<'_>, s: NewMachineServer<'_>) -> DbResult<Server> {
    Ok(sqlx::query_as!(
        Server,
        r#"INSERT INTO servers (org_id, name, address, private_key, public_key, integration_id, provider, region, size, resource_id, status, status_detail, created_by)
           VALUES ($1, $2, 'ssh://deploy@pending', $3, $4, $5, $6, $7, $8, $9, 'creating', 'Waiting for the provider to start it', $10)
           RETURNING id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail"#,
        s.org_id,
        s.name,
        s.private_key,
        s.public_key,
        s.integration_id,
        s.provider,
        s.region,
        s.size,
        s.resource_id,
        s.created_by
    )
    .fetch_one(ex)
    .await?)
}

pub async fn set_status(ex: impl PgExecutor<'_>, id: Uuid, status: &str, detail: &str) -> DbResult<()> {
    sqlx::query!("UPDATE servers SET status = $2, status_detail = $3 WHERE id = $1", id, status, detail).execute(ex).await?;
    Ok(())
}

pub async fn set_address(ex: impl PgExecutor<'_>, id: Uuid, address: &str) -> DbResult<()> {
    sqlx::query!("UPDATE servers SET address = $2, known_hosts = '' WHERE id = $1", id, address).execute(ex).await?;
    Ok(())
}

pub async fn by_id(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<(Server, Credentials)> {
    let r = sqlx::query!(
        r#"SELECT id, org_id, name, address, public_key, known_hosts, last_check, checked_at, created_at, integration_id, provider, region, size, resource_id, status, status_detail, private_key
           FROM servers WHERE id = $1"#,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()?;
    let creds = Credentials { address: r.address.clone(), private_key: r.private_key, known_hosts: r.known_hosts.clone() };
    let server = Server {
        id: r.id,
        org_id: r.org_id,
        name: r.name,
        address: r.address,
        public_key: r.public_key,
        known_hosts: r.known_hosts,
        last_check: r.last_check,
        checked_at: r.checked_at,
        created_at: r.created_at,
        integration_id: r.integration_id,
        provider: r.provider,
        region: r.region,
        size: r.size,
        resource_id: r.resource_id,
        status: r.status,
        status_detail: r.status_detail,
    };
    Ok((server, creds))
}
