use crate::error::DbResult;
use sqlx::PgExecutor;
use uuid::Uuid;

pub struct AppRow {
    pub app: Option<serde_json::Value>,
    pub key: Option<Vec<u8>>,
    pub webhook_secret: Option<Vec<u8>>,
}

pub async fn app(ex: impl PgExecutor<'_>) -> DbResult<AppRow> {
    Ok(sqlx::query_as!(AppRow, "SELECT github_app AS app, github_app_key AS key, github_webhook_secret AS webhook_secret FROM instance_settings")
        .fetch_one(ex)
        .await?)
}

pub async fn set_app(ex: impl PgExecutor<'_>, app: Option<&serde_json::Value>, key: Option<&[u8]>, webhook_secret: Option<&[u8]>) -> DbResult<()> {
    sqlx::query!("UPDATE instance_settings SET github_app = $1, github_app_key = $2, github_webhook_secret = $3", app, key, webhook_secret).execute(ex).await?;
    Ok(())
}

pub struct Link<'a> {
    pub project_id: Uuid,
    pub repo: &'a str,
    pub installation: i64,
    pub linked_by: Uuid,
    pub auto_push: bool,
}

pub async fn link(ex: impl PgExecutor<'_>, l: Link<'_>) -> DbResult<()> {
    let url = format!("https://github.com/{}.git", l.repo);
    sqlx::query!(
        r#"INSERT INTO project_remotes (project_id, url, username, token_cipher, auto_push, updated_by, github_repo, github_installation, linked_by)
           VALUES ($1, $2, '', NULL, $3, $4, $5, $6, $4)
           ON CONFLICT (project_id) DO UPDATE SET url = $2, username = '', token_cipher = NULL, auto_push = $3, updated_by = $4,
               github_repo = $5, github_installation = $6, linked_by = $4, updated_at = now(),
               last_push_at = NULL, last_push_ok = NULL, last_push_error = NULL, last_import_at = NULL, last_import_error = NULL"#,
        l.project_id,
        url,
        l.auto_push,
        l.linked_by,
        l.repo,
        l.installation
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub struct Linked {
    pub project_id: Uuid,
    pub repo: String,
    pub installation: i64,
    pub linked_by: Option<Uuid>,
}

pub async fn linked(ex: impl PgExecutor<'_>, project: Uuid) -> DbResult<Option<Linked>> {
    Ok(sqlx::query_as!(
        Linked,
        r#"SELECT project_id, github_repo AS "repo!", github_installation AS "installation!", linked_by FROM project_remotes WHERE project_id = $1 AND github_repo IS NOT NULL"#,
        project
    )
    .fetch_optional(ex)
    .await?)
}

pub async fn projects_for_repo(ex: impl PgExecutor<'_>, repo: &str) -> DbResult<Vec<Linked>> {
    Ok(sqlx::query_as!(
        Linked,
        r#"SELECT project_id, github_repo AS "repo!", github_installation AS "installation!", linked_by FROM project_remotes WHERE lower(github_repo) = lower($1)"#,
        repo
    )
    .fetch_all(ex)
    .await?)
}

pub async fn record_import(ex: impl PgExecutor<'_>, project: Uuid, error: Option<&str>) -> DbResult<()> {
    sqlx::query!("UPDATE project_remotes SET last_import_at = now(), last_import_error = $2 WHERE project_id = $1", project, error).execute(ex).await?;
    Ok(())
}
