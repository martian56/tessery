use crate::error::{DbError, DbResult, OptionalExt};
use serde_json::Value;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct ProjectSummary {
    pub id: Uuid,
    pub org_id: Uuid,
    pub team_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub version: i32,
    pub node_count: i32,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct Project {
    pub id: Uuid,
    pub org_id: Uuid,
    pub team_id: Option<Uuid>,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub icon: String,
    pub version: i32,
    pub doc: Value,
    pub created_at: OffsetDateTime,
    pub updated_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct VersionInfo {
    pub version: i32,
    pub message: String,
    pub created_at: OffsetDateTime,
    pub created_by: Option<Uuid>,
    pub author_name: Option<String>,
}

pub struct NewProject<'a> {
    pub org_id: Uuid,
    pub team_id: Option<Uuid>,
    pub slug: &'a str,
    pub name: &'a str,
    pub description: &'a str,
    pub icon: &'a str,
    pub doc: &'a Value,
    pub created_by: Uuid,
}

pub async fn list(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<ProjectSummary>> {
    Ok(sqlx::query_as!(
        ProjectSummary,
        r#"SELECT id, org_id, team_id, slug, name, description, icon, version, node_count AS "node_count!", created_at, updated_at
           FROM projects WHERE org_id = $1 ORDER BY updated_at DESC"#,
        org_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Project> {
    sqlx::query_as!(Project, "SELECT id, org_id, team_id, slug, name, description, icon, version, doc, created_at, updated_at FROM projects WHERE id = $1", id)
        .fetch_optional(ex)
        .await?
        .or_not_found()
}

pub async fn locate(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<(Uuid, Option<Uuid>)> {
    let r = sqlx::query!("SELECT org_id, team_id FROM projects WHERE id = $1", id)
        .fetch_optional(ex)
        .await?
        .or_not_found()?;
    Ok((r.org_id, r.team_id))
}

pub async fn create(tx: &mut sqlx::PgConnection, p: NewProject<'_>) -> DbResult<Project> {
    let row = sqlx::query_as!(
        Project,
        "INSERT INTO projects (org_id, team_id, slug, name, description, icon, doc, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
         RETURNING id, org_id, team_id, slug, name, description, icon, version, doc, created_at, updated_at",
        p.org_id,
        p.team_id,
        p.slug,
        p.name,
        p.description,
        p.icon,
        p.doc,
        p.created_by
    )
    .fetch_one(&mut *tx)
    .await?;
    sqlx::query!("INSERT INTO project_versions (project_id, version, doc, message, created_by) VALUES ($1, 1, $2, 'Created', $3)", row.id, p.doc, p.created_by)
        .execute(&mut *tx)
        .await?;
    Ok(row)
}

pub struct SaveDoc<'a> {
    pub id: Uuid,
    pub expected_version: i32,
    pub doc: &'a Value,
    pub name: &'a str,
    pub description: &'a str,
    pub icon: &'a str,
    pub message: &'a str,
    pub user: Uuid,
}

pub async fn save_doc(tx: &mut sqlx::PgConnection, s: SaveDoc<'_>) -> DbResult<Project> {
    let SaveDoc {
        id,
        expected_version,
        doc,
        name,
        description,
        icon,
        message,
        user,
    } = s;
    let row = sqlx::query_as!(
        Project,
        "UPDATE projects SET doc = $3, name = $4, description = $5, icon = $6, version = version + 1, updated_at = now(), updated_by = $7
         WHERE id = $1 AND version = $2
         RETURNING id, org_id, team_id, slug, name, description, icon, version, doc, created_at, updated_at",
        id,
        expected_version,
        doc,
        name,
        description,
        icon,
        user
    )
    .fetch_optional(&mut *tx)
    .await?;
    let Some(row) = row else {
        let exists = sqlx::query_scalar!(
            r#"SELECT EXISTS (SELECT 1 FROM projects WHERE id = $1) AS "e!""#,
            id
        )
        .fetch_one(&mut *tx)
        .await?;
        return Err(if exists {
            DbError::StaleVersion
        } else {
            DbError::NotFound
        });
    };
    sqlx::query!("INSERT INTO project_versions (project_id, version, doc, message, created_by) VALUES ($1, $2, $3, $4, $5)", id, row.version, doc, message, user)
        .execute(&mut *tx)
        .await?;
    Ok(row)
}

pub async fn set_team(ex: impl PgExecutor<'_>, id: Uuid, team_id: Option<Uuid>) -> DbResult<()> {
    let r = sqlx::query!(
        "UPDATE projects SET team_id = $2 WHERE id = $1",
        id,
        team_id
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn delete(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!("DELETE FROM projects WHERE id = $1", id)
        .execute(ex)
        .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn list_versions(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Vec<VersionInfo>> {
    Ok(sqlx::query_as!(
        VersionInfo,
        r#"SELECT v.version, v.message, v.created_at, v.created_by, u.name AS "author_name?"
           FROM project_versions v LEFT JOIN users u ON u.id = v.created_by
           WHERE v.project_id = $1 ORDER BY v.version DESC LIMIT 200"#,
        id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get_version(ex: impl PgExecutor<'_>, id: Uuid, version: i32) -> DbResult<Value> {
    sqlx::query_scalar!(
        "SELECT doc FROM project_versions WHERE project_id = $1 AND version = $2",
        id,
        version
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}
