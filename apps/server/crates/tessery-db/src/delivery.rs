use crate::error::{DbResult, OptionalExt};
use crate::types::ReleaseStatus;
use sqlx::{PgExecutor, Postgres, Transaction};
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Checkpoint {
    pub id: Uuid,
    pub project_id: Uuid,
    pub seq: i32,
    pub name: String,
    pub message: String,
    pub version: i32,
    pub commit_sha: String,
    pub file_count: i32,
    pub created_by: Option<Uuid>,
    pub author_name: Option<String>,
    pub created_at: OffsetDateTime,
}

pub struct NewCheckpoint<'a> {
    pub project_id: Uuid,
    pub name: &'a str,
    pub message: &'a str,
    pub version: i32,
    pub commit_sha: &'a str,
    pub file_count: i32,
    pub created_by: Uuid,
}

#[derive(Debug, Clone)]
pub struct Release {
    pub id: Uuid,
    pub project_id: Uuid,
    pub env_key: String,
    pub checkpoint_id: Uuid,
    pub checkpoint_seq: i32,
    pub checkpoint_name: String,
    pub commit_sha: String,
    pub from_env: Option<String>,
    pub status: ReleaseStatus,
    pub note: String,
    pub requested_by: Option<Uuid>,
    pub requester_name: Option<String>,
    pub requested_at: OffsetDateTime,
    pub decided_by: Option<Uuid>,
    pub decider_name: Option<String>,
    pub decided_at: Option<OffsetDateTime>,
    pub decision_note: String,
    pub error: Option<String>,
    pub started_at: Option<OffsetDateTime>,
    pub finished_at: Option<OffsetDateTime>,
    pub endpoints: serde_json::Value,
}

pub struct NewRelease<'a> {
    pub project_id: Uuid,
    pub env_key: &'a str,
    pub checkpoint_id: Uuid,
    pub from_env: Option<&'a str>,
    pub status: ReleaseStatus,
    pub note: &'a str,
    pub requested_by: Uuid,
    /// The commit to deploy when it is not the checkpoint's own, because the environment's settings changed since.
    pub commit_sha: Option<&'a str>,
}

#[derive(Debug, Clone)]
pub struct Head {
    pub env_key: String,
    pub checkpoint_id: Uuid,
    pub release_id: Uuid,
    pub updated_at: OffsetDateTime,
    pub endpoints: serde_json::Value,
}

#[derive(Debug, Clone)]
pub struct Remote {
    pub project_id: Uuid,
    pub url: String,
    pub username: String,
    pub token_cipher: Option<Vec<u8>>,
    pub auto_push: bool,
    pub last_push_at: Option<OffsetDateTime>,
    pub last_push_ok: Option<bool>,
    pub last_push_error: Option<String>,
    pub updated_at: OffsetDateTime,
    pub github_repo: Option<String>,
    pub github_installation: Option<i64>,
    pub last_import_at: Option<OffsetDateTime>,
    pub last_import_error: Option<String>,
}

pub async fn lock_project(tx: &mut Transaction<'_, Postgres>, project_id: Uuid) -> DbResult<()> {
    sqlx::query!("SELECT id FROM projects WHERE id = $1 FOR UPDATE", project_id)
        .fetch_optional(&mut **tx)
        .await?
        .or_not_found()
        .map(drop)
}

pub async fn insert_checkpoint(tx: &mut Transaction<'_, Postgres>, c: NewCheckpoint<'_>) -> DbResult<Uuid> {
    Ok(sqlx::query_scalar!(
        r#"INSERT INTO checkpoints (project_id, seq, name, message, version, commit_sha, file_count, created_by)
           VALUES ($1, (SELECT coalesce(max(seq), 0) + 1 FROM checkpoints WHERE project_id = $1), $2, $3, $4, $5, $6, $7)
           RETURNING id"#,
        c.project_id, c.name, c.message, c.version, c.commit_sha, c.file_count, c.created_by
    )
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn list_checkpoints(ex: impl PgExecutor<'_>, project_id: Uuid) -> DbResult<Vec<Checkpoint>> {
    Ok(sqlx::query_as!(
        Checkpoint,
        r#"SELECT c.id, c.project_id, c.seq, c.name, c.message, c.version, c.commit_sha, c.file_count, c.created_by,
                  u.name AS "author_name?", c.created_at
           FROM checkpoints c LEFT JOIN users u ON u.id = c.created_by
           WHERE c.project_id = $1 ORDER BY c.seq DESC"#,
        project_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get_checkpoint(ex: impl PgExecutor<'_>, project_id: Uuid, id: Uuid) -> DbResult<Checkpoint> {
    sqlx::query_as!(
        Checkpoint,
        r#"SELECT c.id, c.project_id, c.seq, c.name, c.message, c.version, c.commit_sha, c.file_count, c.created_by,
                  u.name AS "author_name?", c.created_at
           FROM checkpoints c LEFT JOIN users u ON u.id = c.created_by
           WHERE c.project_id = $1 AND c.id = $2"#,
        project_id,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn insert_release(tx: &mut Transaction<'_, Postgres>, r: NewRelease<'_>) -> DbResult<Uuid> {
    Ok(sqlx::query_scalar!(
        r#"INSERT INTO releases (project_id, env_key, checkpoint_id, from_env, status, note, requested_by, commit_sha)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING id"#,
        r.project_id, r.env_key, r.checkpoint_id, r.from_env, r.status as ReleaseStatus, r.note, r.requested_by, r.commit_sha
    )
    .fetch_one(&mut **tx)
    .await?)
}

pub async fn get_release(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Release> {
    sqlx::query_as!(
        Release,
        r#"SELECT r.id, r.project_id, r.env_key, r.checkpoint_id, c.seq AS checkpoint_seq, c.name AS checkpoint_name,
                  coalesce(r.commit_sha, c.commit_sha) AS "commit_sha!", r.from_env, r.status AS "status: ReleaseStatus", r.note, r.requested_by,
                  rq.name AS "requester_name?", r.requested_at, r.decided_by, dc.name AS "decider_name?",
                  r.decided_at, r.decision_note, r.error, r.started_at, r.finished_at, r.endpoints
           FROM releases r JOIN checkpoints c ON c.id = r.checkpoint_id
           LEFT JOIN users rq ON rq.id = r.requested_by LEFT JOIN users dc ON dc.id = r.decided_by
           WHERE r.id = $1"#,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn list_releases(ex: impl PgExecutor<'_>, project_id: Uuid, limit: i64) -> DbResult<Vec<Release>> {
    Ok(sqlx::query_as!(
        Release,
        r#"SELECT r.id, r.project_id, r.env_key, r.checkpoint_id, c.seq AS checkpoint_seq, c.name AS checkpoint_name,
                  coalesce(r.commit_sha, c.commit_sha) AS "commit_sha!", r.from_env, r.status AS "status: ReleaseStatus", r.note, r.requested_by,
                  rq.name AS "requester_name?", r.requested_at, r.decided_by, dc.name AS "decider_name?",
                  r.decided_at, r.decision_note, r.error, r.started_at, r.finished_at, r.endpoints
           FROM releases r JOIN checkpoints c ON c.id = r.checkpoint_id
           LEFT JOIN users rq ON rq.id = r.requested_by LEFT JOIN users dc ON dc.id = r.decided_by
           WHERE r.project_id = $1 ORDER BY r.requested_at DESC LIMIT $2"#,
        project_id,
        limit
    )
    .fetch_all(ex)
    .await?)
}

pub async fn decide_release(
    tx: &mut Transaction<'_, Postgres>,
    id: Uuid,
    status: ReleaseStatus,
    decided_by: Option<Uuid>,
    note: &str,
    error: Option<&str>,
) -> DbResult<()> {
    sqlx::query!(
        r#"UPDATE releases SET status = $2, decided_by = coalesce($3, decided_by), decided_at = now(),
                  decision_note = $4, error = $5
           WHERE id = $1"#,
        id,
        status as ReleaseStatus,
        decided_by,
        note,
        error
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

pub async fn heads(ex: impl PgExecutor<'_>, project_id: Uuid) -> DbResult<Vec<Head>> {
    Ok(sqlx::query_as!(
        Head,
        r#"SELECT h.env_key, h.checkpoint_id, h.release_id, h.updated_at, r.endpoints
           FROM environment_heads h JOIN releases r ON r.id = h.release_id WHERE h.project_id = $1"#,
        project_id
    )
        .fetch_all(ex)
        .await?)
}

pub async fn set_head(tx: &mut Transaction<'_, Postgres>, project_id: Uuid, env_key: &str, checkpoint_id: Uuid, release_id: Uuid) -> DbResult<()> {
    sqlx::query!(
        r#"INSERT INTO environment_heads (project_id, env_key, checkpoint_id, release_id) VALUES ($1, $2, $3, $4)
           ON CONFLICT (project_id, env_key) DO UPDATE SET checkpoint_id = $3, release_id = $4, updated_at = now()"#,
        project_id,
        env_key,
        checkpoint_id,
        release_id
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Running {
    pub project_id: Uuid,
    pub env_key: String,
    pub checkpoint_seq: i32,
}

pub async fn running_in_org(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<Running>> {
    Ok(sqlx::query_as!(
        Running,
        r#"SELECT h.project_id, h.env_key, c.seq AS checkpoint_seq
           FROM environment_heads h JOIN checkpoints c ON c.id = h.checkpoint_id JOIN projects p ON p.id = h.project_id
           WHERE p.org_id = $1"#,
        org_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn clear_head(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str) -> DbResult<bool> {
    Ok(sqlx::query!("DELETE FROM environment_heads WHERE project_id = $1 AND env_key = $2", project_id, env_key)
        .execute(ex)
        .await?
        .rows_affected()
        == 1)
}

pub async fn was_released(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str, checkpoint_id: Uuid) -> DbResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM releases WHERE project_id = $1 AND env_key = $2 AND checkpoint_id = $3 AND status = 'released') AS "e!""#,
        project_id,
        env_key,
        checkpoint_id
    )
    .fetch_one(ex)
    .await?)
}

pub async fn ref_targets(ex: impl PgExecutor<'_> + Copy, project_id: Uuid) -> DbResult<(Vec<(String, String)>, Vec<(String, String)>)> {
    let branches = sqlx::query!(
        r#"SELECT h.env_key, coalesce(r.commit_sha, c.commit_sha) AS "commit_sha!" FROM environment_heads h JOIN checkpoints c ON c.id = h.checkpoint_id
           LEFT JOIN releases r ON r.id = h.release_id WHERE h.project_id = $1"#,
        project_id
    )
    .fetch_all(ex)
    .await?
    .into_iter()
    .map(|r| (format!("env/{}", r.env_key), r.commit_sha))
    .collect();
    let tags = sqlx::query!("SELECT seq, commit_sha FROM checkpoints WHERE project_id = $1", project_id)
        .fetch_all(ex)
        .await?
        .into_iter()
        .map(|r| (format!("checkpoint/{}", r.seq), r.commit_sha))
        .collect();
    Ok((branches, tags))
}

pub async fn get_remote(ex: impl PgExecutor<'_>, project_id: Uuid) -> DbResult<Option<Remote>> {
    Ok(sqlx::query_as!(
        Remote,
        r#"SELECT project_id, url, username, token_cipher, auto_push, last_push_at, last_push_ok, last_push_error, updated_at,
                  github_repo, github_installation, last_import_at, last_import_error
           FROM project_remotes WHERE project_id = $1"#,
        project_id
    )
    .fetch_optional(ex)
    .await?)
}

pub struct RemoteUpdate<'a> {
    pub project_id: Uuid,
    pub url: &'a str,
    pub username: &'a str,
    pub token_cipher: Option<Option<Vec<u8>>>,
    pub auto_push: bool,
    pub updated_by: Uuid,
}

pub async fn upsert_remote(ex: impl PgExecutor<'_>, r: RemoteUpdate<'_>) -> DbResult<()> {
    let keep = r.token_cipher.is_none();
    let token = r.token_cipher.flatten();
    sqlx::query!(
        r#"INSERT INTO project_remotes (project_id, url, username, token_cipher, auto_push, updated_by)
           VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id) DO UPDATE SET url = $2, username = $3, github_repo = NULL, github_installation = NULL,
               token_cipher = CASE WHEN $7 THEN project_remotes.token_cipher ELSE $4 END,
               auto_push = $5, updated_by = $6, updated_at = now(),
               last_push_at = NULL, last_push_ok = NULL, last_push_error = NULL"#,
        r.project_id,
        r.url,
        r.username,
        token,
        r.auto_push,
        r.updated_by,
        keep
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn delete_remote(ex: impl PgExecutor<'_>, project_id: Uuid) -> DbResult<bool> {
    Ok(sqlx::query!("DELETE FROM project_remotes WHERE project_id = $1", project_id).execute(ex).await?.rows_affected() > 0)
}

pub async fn record_push(ex: impl PgExecutor<'_>, project_id: Uuid, error: Option<&str>) -> DbResult<()> {
    sqlx::query!(
        "UPDATE project_remotes SET last_push_at = now(), last_push_ok = $2, last_push_error = $3 WHERE project_id = $1",
        project_id,
        error.is_none(),
        error
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn start_deploy(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<bool> {
    Ok(sqlx::query!("UPDATE releases SET status = 'deploying', started_at = now() WHERE id = $1 AND status = 'queued'", id)
        .execute(ex)
        .await?
        .rows_affected()
        == 1)
}

pub async fn finish_deploy(tx: &mut Transaction<'_, Postgres>, r: &Release, error: Option<&str>, endpoints: &serde_json::Value) -> DbResult<()> {
    let status = if error.is_none() { ReleaseStatus::Released } else { ReleaseStatus::Failed };
    sqlx::query!(
        "UPDATE releases SET status = $2, finished_at = now(), error = $3, endpoints = $4 WHERE id = $1",
        r.id,
        status as ReleaseStatus,
        error,
        endpoints
    )
    .execute(&mut **tx)
    .await?;
    if error.is_none() {
        set_head(tx, r.project_id, &r.env_key, r.checkpoint_id, r.id).await?;
    }
    Ok(())
}

pub async fn fail_interrupted(ex: impl PgExecutor<'_>) -> DbResult<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"UPDATE releases SET status = 'failed', finished_at = now(), error = 'the worker stopped while this deploy was running'
           WHERE status = 'deploying' RETURNING id"#
    )
    .fetch_all(ex)
    .await?)
}

pub async fn append_logs(ex: impl PgExecutor<'_>, release: Uuid, lines: &[String]) -> DbResult<()> {
    if lines.is_empty() {
        return Ok(());
    }
    sqlx::query!("INSERT INTO release_logs (release_id, line) SELECT $1, unnest($2::text[])", release, lines)
        .execute(ex)
        .await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct LogLine {
    pub seq: i64,
    pub at: OffsetDateTime,
    pub line: String,
}

pub async fn logs(ex: impl PgExecutor<'_>, release: Uuid, after: i64, limit: i64) -> DbResult<Vec<LogLine>> {
    Ok(sqlx::query_as!(
        LogLine,
        "SELECT seq, at, line FROM release_logs WHERE release_id = $1 AND seq > $2 ORDER BY seq LIMIT $3",
        release,
        after,
        limit
    )
    .fetch_all(ex)
    .await?)
}

#[derive(Debug, Clone)]
pub struct Secret {
    pub name: String,
    pub cipher: Vec<u8>,
    pub generated: bool,
    pub updated_at: OffsetDateTime,
    pub updated_by_name: Option<String>,
}

pub async fn secrets(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str) -> DbResult<Vec<Secret>> {
    Ok(sqlx::query_as!(
        Secret,
        r#"SELECT s.name, s.cipher, s.generated, s.updated_at, u.name AS "updated_by_name?"
           FROM environment_secrets s LEFT JOIN users u ON u.id = s.updated_by
           WHERE s.project_id = $1 AND s.env_key = $2 ORDER BY s.name"#,
        project_id,
        env_key
    )
    .fetch_all(ex)
    .await?)
}

pub async fn put_secret(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str, name: &str, cipher: &[u8], generated: bool, by: Option<Uuid>) -> DbResult<()> {
    sqlx::query!(
        r#"INSERT INTO environment_secrets (project_id, env_key, name, cipher, generated, updated_by) VALUES ($1, $2, $3, $4, $5, $6)
           ON CONFLICT (project_id, env_key, name) DO UPDATE SET cipher = $4, generated = $5, updated_by = $6, updated_at = now()"#,
        project_id,
        env_key,
        name,
        cipher,
        generated,
        by
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn insert_generated_secret(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str, name: &str, cipher: &[u8]) -> DbResult<()> {
    sqlx::query!(
        r#"INSERT INTO environment_secrets (project_id, env_key, name, cipher, generated) VALUES ($1, $2, $3, $4, true)
           ON CONFLICT (project_id, env_key, name) DO NOTHING"#,
        project_id,
        env_key,
        name,
        cipher
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn delete_secret(ex: impl PgExecutor<'_>, project_id: Uuid, env_key: &str, name: &str) -> DbResult<bool> {
    Ok(sqlx::query!("DELETE FROM environment_secrets WHERE project_id = $1 AND env_key = $2 AND name = $3", project_id, env_key, name)
        .execute(ex)
        .await?
        .rows_affected()
        == 1)
}
