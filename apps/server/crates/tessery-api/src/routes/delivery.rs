use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use tessery_core::{Decision, Permission as P, Target};
use tessery_db::DbError;
use tessery_db::delivery::{self as db, NewCheckpoint, NewRelease, RemoteUpdate};
use tessery_db::types::ReleaseStatus;
use tessery_mq::Job;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::{BTreeMap, HashMap};
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

const DESIGN_FILE: &str = "tessery.json";
const MAX_FILES: usize = 5_000;
const MAX_TOTAL_BYTES: usize = 32 * 1024 * 1024;

fn git_err(e: tessery_git::GitError) -> ApiError {
    match e {
        tessery_git::GitError::InvalidPath(p) => ApiError::invalid("files", format!("invalid path `{p}`")),
        tessery_git::GitError::Missing => ApiError::NotFound,
        tessery_git::GitError::Conflict(files) => ApiError::Conflict(format!(
            "the regenerated code conflicts with changes pushed to main in {}. Merge the tessery/generated branch into main locally, resolve, push, then checkpoint again",
            files.join(", ")
        )),
        e => ApiError::Internal(anyhow::anyhow!(e)),
    }
}

pub(crate) fn engine_err(e: tessery_engine::EngineError) -> ApiError {
    match e {
        tessery_engine::EngineError::Rejected(msg) => ApiError::BadRequest(msg),
        e => ApiError::Internal(anyhow::anyhow!(e)),
    }
}

fn tx_err(e: sqlx::Error) -> ApiError {
    DbError::from(e).into()
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CheckpointDto {
    pub id: Uuid,
    pub seq: i32,
    pub name: String,
    pub message: String,
    /// Design version the checkpoint was taken from.
    pub version: i32,
    pub commit: String,
    pub files: i32,
    pub author: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<db::Checkpoint> for CheckpointDto {
    fn from(c: db::Checkpoint) -> Self {
        Self {
            id: c.id,
            seq: c.seq,
            name: c.name,
            message: c.message,
            version: c.version,
            commit: c.commit_sha,
            files: c.file_count,
            author: c.author_name,
            created_at: c.created_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseDto {
    pub id: Uuid,
    pub env: String,
    pub checkpoint_id: Uuid,
    pub checkpoint_seq: i32,
    pub checkpoint_name: String,
    pub commit: String,
    /// Environment the checkpoint was promoted from; `None` for the first stage.
    pub from_env: Option<String>,
    pub status: ReleaseStatus,
    pub note: String,
    pub requested_by: Option<Uuid>,
    pub requester: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub requested_at: OffsetDateTime,
    pub decider: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub decided_at: Option<OffsetDateTime>,
    pub decision_note: String,
    pub error: Option<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub started_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub finished_at: Option<OffsetDateTime>,
    /// Public addresses the deploy reported, e.g. `[{ "name": "web", "url": "http://localhost:25883" }]`.
    #[schema(value_type = Vec<Object>)]
    pub endpoints: Value,
}

impl From<db::Release> for ReleaseDto {
    fn from(r: db::Release) -> Self {
        Self {
            id: r.id,
            env: r.env_key,
            checkpoint_id: r.checkpoint_id,
            checkpoint_seq: r.checkpoint_seq,
            checkpoint_name: r.checkpoint_name,
            commit: r.commit_sha,
            from_env: r.from_env,
            status: r.status,
            note: r.note,
            requested_by: r.requested_by,
            requester: r.requester_name,
            requested_at: r.requested_at,
            decider: r.decider_name,
            decided_at: r.decided_at,
            decision_note: r.decision_note,
            error: r.error,
            started_at: r.started_at,
            finished_at: r.finished_at,
            endpoints: r.endpoints,
        }
    }
}

struct Stage {
    key: String,
    name: String,
    approval: bool,
    target: String,
}

fn stages(doc: &Value) -> Vec<Stage> {
    doc.get("environments")
        .and_then(Value::as_array)
        .map(|envs| {
            envs.iter()
                .filter_map(|e| {
                    let key = e.get("id")?.as_str()?.to_owned();
                    Some(Stage {
                        name: e.get("name").and_then(Value::as_str).unwrap_or(&key).to_owned(),
                        approval: e.get("approval").and_then(Value::as_bool).unwrap_or(false),
                        target: e.pointer("/target/kind").and_then(Value::as_str).unwrap_or("git").to_owned(),
                        key,
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

fn env_target(project_target: &Target, env: &str) -> Target {
    match project_target {
        Target::Project { org, team, project } => Target::Environment { org: *org, team: *team, project: *project, env: env.to_owned() },
        t => t.clone(),
    }
}

async fn enqueue_push(state: &AppState, project: Uuid) {
    match db::get_remote(&state.db, project).await {
        Result::Ok(Some(r)) if r.auto_push => {
            if let Err(e) = state.mq.publish(Job::PushRemote { project_id: project }).await {
                tracing::warn!(error = %e, %project, "could not queue a remote push");
            }
        }
        Result::Ok(_) => {}
        Err(e) => tracing::warn!(error = %e, %project, "could not read the project remote"),
    }
}

pub async fn sync_refs(db_pool: &tessery_db::PgPool, repos: &tessery_git::Repos, project: Uuid) -> anyhow::Result<()> {
    let (branches, tags) = db::ref_targets(db_pool, project).await?;
    repos.open(project).await?.sync_refs(&branches, &tags).await?;
    Ok(())
}

async fn after_change(state: &AppState, project: Uuid) {
    if let Err(e) = sync_refs(&state.db, &state.repos, project).await {
        tracing::error!(error = %e, %project, "git refs are behind the database; the next push will retry");
    }
    enqueue_push(state, project).await;
}

async fn missing_secrets(state: &AppState, project: Uuid, commit: &str, env: &str) -> ApiResult<Vec<String>> {
    let Ok(repo) = state.repos.open(project).await else { return Ok(Vec::new()) };
    let Ok(raw) = repo.read_file(commit, &format!("deploy/{env}/plan.json")).await else { return Ok(Vec::new()) };
    let Ok(plan) = serde_json::from_slice::<Value>(&raw) else { return Ok(Vec::new()) };
    let required = tessery_core::runner::required_secrets(&plan);
    let stored: Vec<String> = db::secrets(&state.db, project, env).await?.into_iter().map(|s| s.name).collect();
    Ok(tessery_core::runner::missing_secrets(&required, &stored).into_iter().map(str::to_owned).collect())
}

async fn open_repo(state: &AppState, project: Uuid) -> ApiResult<Option<tessery_git::Repo>> {
    match state.repos.open(project).await {
        Ok(r) => Ok(Some(r)),
        Err(tessery_git::GitError::Missing) => Ok(None),
        Err(e) => Err(git_err(e)),
    }
}

async fn read_json(state: &AppState, project: Uuid, commit: &str, path: &str) -> ApiResult<Option<Value>> {
    let Some(repo) = open_repo(state, project).await? else { return Ok(None) };
    let Some(raw) = repo.read_file_if_exists(commit, path).await.map_err(git_err)? else { return Ok(None) };
    serde_json::from_slice(&raw).map(Some).map_err(|e| ApiError::Internal(anyhow::anyhow!("{path} in {commit} is not valid JSON: {e}")))
}

pub async fn previous_migrations(state: &AppState, project: Uuid) -> ApiResult<Option<Value>> {
    let Some(repo) = open_repo(state, project).await? else { return Ok(None) };
    let Some(commit) = repo.resolve(&format!("refs/heads/{}", tessery_git::GENERATED)).await.map_err(git_err)? else { return Ok(None) };
    read_json(state, project, &commit, tessery_core::migrations::MIGRATIONS_FILE).await
}

async fn release_migrations(state: &AppState, project: Uuid, env: &str, commit: &str) -> ApiResult<Vec<tessery_core::migrations::PendingMigration>> {
    let released = db::list_releases(&state.db, project, 500)
        .await?
        .into_iter()
        .filter(|r| r.env_key == env && r.status == ReleaseStatus::Released)
        .max_by_key(|r| r.requested_at);
    let Some(last) = released else { return Ok(Vec::new()) };
    let Some(next) = read_json(state, project, commit, tessery_core::migrations::MIGRATIONS_FILE).await? else { return Ok(Vec::new()) };
    let running = db::get_checkpoint(&state.db, project, last.checkpoint_id).await?.commit_sha;
    let current = read_json(state, project, &running, tessery_core::migrations::MIGRATIONS_FILE).await?;
    Ok(tessery_core::migrations::pending_migrations(current.as_ref(), &next))
}

async fn needs_runner(state: &AppState, project: Uuid, commit: &str, env: &str) -> bool {
    let Ok(repo) = state.repos.open(project).await else { return false };
    let Ok(raw) = repo.read_file(commit, &format!("deploy/{env}/plan.json")).await else { return false };
    serde_json::from_slice::<Value>(&raw)
        .ok()
        .and_then(|p| p.pointer("/target/kind").and_then(Value::as_str).map(|k| k != "git"))
        .unwrap_or(false)
}

async fn enqueue_deploy(state: &AppState, release: Uuid) -> ApiResult<()> {
    state.mq.publish(Job::Deploy { release_id: release }).await.map(drop).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))
}

pub(crate) async fn teardown_job(state: &AppState, project: Uuid, env: &str, destroy: bool) -> ApiResult<Option<Job>> {
    let Some(head) = db::heads(&state.db, project).await?.into_iter().find(|h| h.env_key == env) else { return Ok(None) };
    let checkpoint = db::get_checkpoint(&state.db, project, head.checkpoint_id).await?;
    let Ok(repo) = state.repos.open(project).await else { return Ok(None) };
    let Ok(raw) = repo.read_file(&checkpoint.commit_sha, &format!("deploy/{env}/plan.json")).await else { return Ok(None) };
    let plan: Value = serde_json::from_slice(&raw).map_err(|e| ApiError::Internal(e.into()))?;
    if plan.pointer("/target/kind").and_then(Value::as_str).unwrap_or("git") == "git" {
        return Ok(None);
    }
    let connection = db::secrets(&state.db, project, env).await?.into_iter().filter(|s| tessery_core::runner::is_connection_secret(&s.name)).map(|s| (s.name, s.cipher)).collect();
    let server = match plan.pointer("/target/server").and_then(Value::as_str).and_then(|s| s.parse::<Uuid>().ok()) {
        Some(id) => Some(crate::routes::servers::connection_for(state, project, id).await?),
        None => None,
    };
    Ok(Some(Job::Teardown { project_id: project, env: env.to_owned(), plan, kubeconfig: None, connection, server, destroy }))
}

/// Stops everything an environment runs. Data volumes are kept; the next release starts it again.
#[utoipa::path(post, path = "/api/projects/{project}/environments/{env}/stop", tag = "delivery", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 202, body = Ok)))]
pub async fn stop_env(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<(StatusCode, Json<Ok>)> {
    let project_target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &env_target(&project_target, &env), P::DeploymentRun).await?;
    let job = teardown_job(&state, project, &env, false).await?.ok_or_else(|| ApiError::Conflict(format!("nothing that Tessery deployed is running in {env}")))?;
    state.mq.publish(job).await.map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    db::clear_head(&state.db, project, &env).await?;
    audit::record(&state.db, &p, Entry::new(Some(project_target.org().0), "env.stop", "project", project).decision(d).details(json!({ "env": env }))).await?;
    Ok((StatusCode::ACCEPTED, Json(OK)))
}

fn valid_env_key(key: &str) -> bool {
    !key.is_empty() && key.len() <= 60 && !key.starts_with('.') && key.chars().all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '.')) && !key.contains("..")
}

#[utoipa::path(get, path = "/api/projects/{project}/checkpoints", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = [CheckpointDto])))]
pub async fn list_checkpoints(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<CheckpointDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let rows = db::list_checkpoints(&state.db, project).await?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateCheckpoint {
    pub name: String,
    #[serde(default)]
    pub message: String,
    /// The saved design version this checkpoint captures. Must be the current version.
    pub version: i32,
}

#[utoipa::path(post, path = "/api/projects/{project}/checkpoints", tag = "delivery", params(("project" = Uuid, Path)), request_body = CreateCheckpoint, responses((status = 201, body = CheckpointDto), (status = 409)))]
pub async fn create_checkpoint(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
    Json(req): Json<CreateCheckpoint>,
) -> ApiResult<(StatusCode, Json<CheckpointDto>)> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let name = req.name.trim();
    if name.is_empty() || name.chars().count() > 120 {
        return Err(ApiError::invalid("name", "must be 1 to 120 characters"));
    }

    let mut tx = state.db.begin().await.map_err(tx_err)?;
    db::lock_project(&mut tx, project).await?;
    let saved = tessery_db::projects::get(&mut *tx, project).await?;
    if saved.version != req.version {
        return Err(ApiError::StaleVersion);
    }
    let doc = crate::routes::projects::ProjectDto::from(saved.clone()).doc;
    let previous = previous_migrations(&state, project).await?;
    let generated = state.engine.generate(&doc, previous.as_ref()).await.map_err(engine_err)?;
    if generated.len() > MAX_FILES || generated.values().map(String::len).sum::<usize>() > MAX_TOTAL_BYTES {
        return Err(ApiError::Conflict("the generated project is too large to checkpoint".into()));
    }
    let mut files: BTreeMap<String, Vec<u8>> = generated.into_iter().map(|(path, content)| (path, content.into_bytes())).collect();
    let mut design = serde_json::to_vec_pretty(&doc).map_err(|e| ApiError::Internal(e.into()))?;
    design.push(b'\n');
    files.insert(DESIGN_FILE.to_owned(), design);

    let repo = state.repos.ensure(project).await.map_err(git_err)?;
    let author = tessery_git::Author { name: p.user.name.clone(), email: p.user.email.clone() };
    let subject = if req.message.trim().is_empty() { name.to_owned() } else { format!("{name}\n\n{}", req.message.trim()) };
    let commit = repo.checkpoint(&files, &subject, &author).await.map_err(git_err)?;

    let id = db::insert_checkpoint(
        &mut tx,
        NewCheckpoint {
            project_id: project,
            name,
            message: req.message.trim(),
            version: saved.version,
            commit_sha: &commit,
            file_count: files.len() as i32,
            created_by: p.user.id,
        },
    )
    .await?;
    let row = db::get_checkpoint(&mut *tx, project, id).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(target.org().0), "checkpoint.create", "project", project)
            .decision(d)
            .details(json!({ "checkpoint": row.seq, "name": name, "commit": commit, "version": saved.version })),
    )
    .await?;
    tx.commit().await.map_err(tx_err)?;
    after_change(&state, project).await;
    Ok((StatusCode::CREATED, Json(row.into())))
}

#[derive(Serialize, ToSchema)]
pub struct CheckpointDoc {
    #[schema(value_type = Object)]
    pub doc: Value,
}

/// The design stored in the checkpoint, for restoring it in the editor.
#[utoipa::path(get, path = "/api/projects/{project}/checkpoints/{checkpoint}/doc", tag = "delivery", params(("project" = Uuid, Path), ("checkpoint" = Uuid, Path)), responses((status = 200, body = CheckpointDoc)))]
pub async fn checkpoint_doc(State(state): State<AppState>, p: Principal, Path((project, checkpoint)): Path<(Uuid, Uuid)>) -> ApiResult<Json<CheckpointDoc>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let c = db::get_checkpoint(&state.db, project, checkpoint).await?;
    let repo = state.repos.open(project).await.map_err(git_err)?;
    let bytes = repo.read_file(&c.commit_sha, DESIGN_FILE).await.map_err(git_err)?;
    let doc = serde_json::from_slice(&bytes).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(CheckpointDoc { doc }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct DiffQuery {
    /// Checkpoint to compare against. Defaults to the previous checkpoint.
    pub base: Option<Uuid>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct FileChangeDto {
    pub path: String,
    pub added: Option<u32>,
    pub removed: Option<u32>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct DiffDto {
    pub base_seq: Option<i32>,
    pub files: Vec<FileChangeDto>,
}

#[utoipa::path(get, path = "/api/projects/{project}/checkpoints/{checkpoint}/diff", tag = "delivery", params(("project" = Uuid, Path), ("checkpoint" = Uuid, Path), DiffQuery), responses((status = 200, body = DiffDto)))]
pub async fn checkpoint_diff(
    State(state): State<AppState>,
    p: Principal,
    Path((project, checkpoint)): Path<(Uuid, Uuid)>,
    Query(q): Query<DiffQuery>,
) -> ApiResult<Json<DiffDto>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let to = db::get_checkpoint(&state.db, project, checkpoint).await?;
    let base = match q.base {
        Some(id) => Some(db::get_checkpoint(&state.db, project, id).await?),
        None => db::list_checkpoints(&state.db, project).await?.into_iter().find(|c| c.seq < to.seq),
    };
    let repo = state.repos.open(project).await.map_err(git_err)?;
    let files = repo.diff(base.as_ref().map(|b| b.commit_sha.as_str()), &to.commit_sha).await.map_err(git_err)?;
    Ok(Json(DiffDto {
        base_seq: base.map(|b| b.seq),
        files: files.into_iter().map(|f| FileChangeDto { path: f.path, added: f.added, removed: f.removed }).collect(),
    }))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StageDto {
    pub key: String,
    pub name: String,
    pub requires_approval: bool,
    /// What the environment runs now.
    pub head: Option<CheckpointDto>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub released_at: Option<OffsetDateTime>,
    pub pending: Option<ReleaseDto>,
    /// A release being deployed right now, or waiting for the runner.
    pub active: Option<ReleaseDto>,
    /// Public addresses of what the environment runs now.
    #[schema(value_type = Vec<Object>)]
    pub endpoints: Value,
    /// Where the environment deploys to: `git`, `docker` or `kubernetes`.
    pub target: String,
    /// What a promotion would bring in: the previous stage's head (or the latest checkpoint for the
    /// first stage) when it differs from this stage's head.
    pub candidate: Option<CheckpointDto>,
}

#[derive(Serialize, ToSchema)]
pub struct PipelineDto {
    pub stages: Vec<StageDto>,
}

#[utoipa::path(get, path = "/api/projects/{project}/pipeline", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = PipelineDto)))]
pub async fn pipeline(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<PipelineDto>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    let checkpoints: HashMap<Uuid, db::Checkpoint> = db::list_checkpoints(&state.db, project).await?.into_iter().map(|c| (c.id, c)).collect();
    let latest = checkpoints.values().max_by_key(|c| c.seq).map(|c| c.id);
    let heads: HashMap<String, db::Head> = db::heads(&state.db, project).await?.into_iter().map(|h| (h.env_key.clone(), h)).collect();
    let mut pending: HashMap<String, db::Release> = HashMap::new();
    let mut active: HashMap<String, db::Release> = HashMap::new();
    for r in db::list_releases(&state.db, project, 200).await? {
        match r.status {
            ReleaseStatus::Pending => {
                pending.insert(r.env_key.clone(), r);
            }
            ReleaseStatus::Queued | ReleaseStatus::Deploying => {
                active.insert(r.env_key.clone(), r);
            }
            _ => {}
        }
    }
    let dto = |id: Uuid| checkpoints.get(&id).cloned().map(CheckpointDto::from);

    let mut out = Vec::new();
    let mut upstream: Option<Uuid> = latest;
    for stage in stages(&saved.doc) {
        let head = heads.get(&stage.key);
        let head_id = head.map(|h| h.checkpoint_id);
        let candidate = upstream.filter(|c| Some(*c) != head_id).and_then(dto);
        out.push(StageDto {
            head: head_id.and_then(dto),
            released_at: head.map(|h| h.updated_at),
            pending: pending.remove(&stage.key).map(Into::into),
            active: active.remove(&stage.key).map(Into::into),
            endpoints: head.map(|h| h.endpoints.clone()).unwrap_or_else(|| json!([])),
            target: stage.target.clone(),
            candidate,
            key: stage.key,
            name: stage.name,
            requires_approval: stage.approval,
        });
        upstream = head_id;
    }
    Ok(Json(PipelineDto { stages: out }))
}

#[utoipa::path(get, path = "/api/projects/{project}/releases", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = [ReleaseDto])))]
pub async fn list_releases(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<ReleaseDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::DeploymentRead).await?;
    let rows = db::list_releases(&state.db, project, 100).await?;
    Ok(Json(rows.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateRelease {
    pub env: String,
    pub checkpoint_id: Uuid,
    #[serde(default)]
    pub note: String,
    /// Deploy the checkpoint the environment already runs again, e.g. after changing a secret.
    #[serde(default)]
    pub redeploy: bool,
    /// Required when the release runs migrations that can drop or fail on existing data.
    #[serde(default)]
    pub confirm_destructive: bool,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePreviewQuery {
    pub env: String,
    pub checkpoint_id: Uuid,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MigrationDto {
    pub database: String,
    pub file: String,
    pub sql: String,
    /// What can drop data or fail on existing rows. Empty when the migration only adds or renames.
    pub destructive: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleasePreviewDto {
    /// Database migrations this release runs that the environment has not run yet.
    pub migrations: Vec<MigrationDto>,
}

impl From<tessery_core::migrations::PendingMigration> for MigrationDto {
    fn from(m: tessery_core::migrations::PendingMigration) -> Self {
        Self { database: m.database, file: m.file, sql: m.sql, destructive: m.destructive }
    }
}

/// What releasing a checkpoint into an environment would change, such as the database migrations it runs.
#[utoipa::path(get, path = "/api/projects/{project}/releases/preview", tag = "delivery", params(("project" = Uuid, Path), ReleasePreviewQuery), responses((status = 200, body = ReleasePreviewDto)))]
pub async fn release_preview(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
    Query(q): Query<ReleasePreviewQuery>,
) -> ApiResult<Json<ReleasePreviewDto>> {
    let project_target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &env_target(&project_target, &q.env), P::DeploymentRead).await?;
    let checkpoint = db::get_checkpoint(&state.db, project, q.checkpoint_id)
        .await
        .map_err(|_| ApiError::invalid("checkpointId", "checkpoint not found"))?;
    let migrations = release_migrations(&state, project, &q.env, &checkpoint.commit_sha).await?;
    Ok(Json(ReleasePreviewDto { migrations: migrations.into_iter().map(Into::into).collect() }))
}

/// Releases a checkpoint into an environment. Goes live at once unless the environment requires
/// approval, in which case it waits as `pending`.
#[utoipa::path(post, path = "/api/projects/{project}/releases", tag = "delivery", params(("project" = Uuid, Path)), request_body = CreateRelease, responses((status = 201, body = ReleaseDto), (status = 409)))]
pub async fn create_release(
    State(state): State<AppState>,
    p: Principal,
    Path(project): Path<Uuid>,
    Json(req): Json<CreateRelease>,
) -> ApiResult<(StatusCode, Json<ReleaseDto>)> {
    let project_target = rbac::project_target(&state, project).await?;
    let target = env_target(&project_target, &req.env);
    let d = rbac::require(&state, &p, &target, P::DeploymentRun).await?;

    let mut tx = state.db.begin().await.map_err(tx_err)?;
    db::lock_project(&mut tx, project).await?;
    let saved = tessery_db::projects::get(&mut *tx, project).await?;
    let all = stages(&saved.doc);
    let idx = all.iter().position(|s| s.key == req.env).ok_or_else(|| ApiError::invalid("env", "no such environment in the design"))?;
    let stage = &all[idx];
    if !valid_env_key(&stage.key) {
        return Err(ApiError::invalid("env", "environment ids may only use letters, digits, `-`, `_` and `.`"));
    }
    let checkpoint = db::get_checkpoint(&mut *tx, project, req.checkpoint_id)
        .await
        .map_err(|_| ApiError::invalid("checkpointId", "checkpoint not found"))?;
    let from_env = idx.checked_sub(1).map(|i| all[i].key.as_str());
    if let Some(prev) = from_env
        && !db::was_released(&mut *tx, project, prev, checkpoint.id).await?
    {
        return Err(ApiError::Conflict(format!("checkpoint {} has not been released to {} yet", checkpoint.seq, all[idx - 1].name)));
    }
    let head = db::heads(&mut *tx, project).await?.into_iter().find(|h| h.env_key == stage.key);
    if !req.redeploy && head.as_ref().is_some_and(|h| h.checkpoint_id == checkpoint.id) {
        return Err(ApiError::Conflict(format!("{} already runs checkpoint {}", stage.name, checkpoint.seq)));
    }

    if !req.confirm_destructive {
        let risky: Vec<String> = release_migrations(&state, project, &stage.key, &checkpoint.commit_sha)
            .await?
            .into_iter()
            .flat_map(|m| m.destructive.into_iter().map(move |d| format!("{} {}: {d}", m.database, m.file)))
            .collect();
        if !risky.is_empty() {
            return Err(ApiError::Conflict(format!("this release runs migrations that can lose data; confirm them first: {}", risky.join("; "))));
        }
    }

    let runner = needs_runner(&state, project, &checkpoint.commit_sha, &stage.key).await;
    if runner {
        let missing = missing_secrets(&state, project, &checkpoint.commit_sha, &stage.key).await?;
        if !missing.is_empty() {
            return Err(ApiError::Conflict(format!("set these secrets for {} first: {}", stage.name, missing.join(", "))));
        }
    }
    let status = match (stage.approval, runner) {
        (true, _) => ReleaseStatus::Pending,
        (false, true) => ReleaseStatus::Queued,
        (false, false) => ReleaseStatus::Released,
    };
    let id = db::insert_release(
        &mut tx,
        NewRelease { project_id: project, env_key: &stage.key, checkpoint_id: checkpoint.id, from_env, status, note: req.note.trim(), requested_by: p.user.id },
    )
    .await
    .map_err(|e| match e {
        DbError::Conflict(_) => ApiError::Conflict(format!("{} already has a release waiting for approval or being deployed", stage.name)),
        e => e.into(),
    })?;
    if status == ReleaseStatus::Released {
        db::set_head(&mut tx, project, &stage.key, checkpoint.id, id).await?;
    }
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(project_target.org().0), if stage.approval { "release.request" } else { "release.apply" }, "project", project)
            .decision(d)
            .details(json!({ "env": stage.key, "checkpoint": checkpoint.seq, "commit": checkpoint.commit_sha, "release": id })),
    )
    .await?;
    let row = db::get_release(&mut *tx, id).await?;
    tx.commit().await.map_err(tx_err)?;
    match status {
        ReleaseStatus::Released => after_change(&state, project).await,
        ReleaseStatus::Queued => enqueue_deploy(&state, id).await?,
        _ => {}
    }
    Ok((StatusCode::CREATED, Json(row.into())))
}

#[derive(Deserialize, ToSchema, Default)]
pub struct DecisionBody {
    #[serde(default)]
    pub note: String,
}

#[derive(Clone, Copy)]
enum Verdict {
    Approve,
    Reject,
    Cancel,
}

async fn decide(state: AppState, p: Principal, release: Uuid, verdict: Verdict, note: String) -> ApiResult<Json<ReleaseDto>> {
    let r = db::get_release(&state.db, release).await?;
    let project_target = rbac::project_target(&state, r.project_id).await?;
    let target = env_target(&project_target, &r.env_key);
    let mine = r.requested_by == Some(p.user.id);
    let d = match verdict {
        Verdict::Cancel if mine => rbac::require(&state, &p, &target, P::DeploymentRun).await?,
        Verdict::Cancel => rbac::require(&state, &p, &target, P::DeploymentApprove).await?,
        Verdict::Approve | Verdict::Reject => {
            let d = rbac::require(&state, &p, &target, P::DeploymentApprove).await?;
            if mine && matches!(verdict, Verdict::Approve) && !p.is_instance_admin() {
                return Err(ApiError::ForbiddenMsg("you cannot approve your own release; ask someone else with deployment:approve".into()));
            }
            if mine && matches!(verdict, Verdict::Approve) { Decision::Bypassed } else { d }
        }
    };

    let mut tx = state.db.begin().await.map_err(tx_err)?;
    db::lock_project(&mut tx, r.project_id).await?;
    let current = db::get_release(&mut *tx, release).await?;
    if current.status != ReleaseStatus::Pending {
        return Err(ApiError::Conflict("this release was already decided".into()));
    }
    let runner = matches!(verdict, Verdict::Approve) && needs_runner(&state, r.project_id, &r.commit_sha, &r.env_key).await;
    let (status, action) = match verdict {
        Verdict::Approve if runner => (ReleaseStatus::Queued, "release.approve"),
        Verdict::Approve => (ReleaseStatus::Released, "release.approve"),
        Verdict::Reject => (ReleaseStatus::Rejected, "release.reject"),
        Verdict::Cancel => (ReleaseStatus::Cancelled, "release.cancel"),
    };
    if status == ReleaseStatus::Released {
        db::set_head(&mut tx, r.project_id, &r.env_key, r.checkpoint_id, release).await?;
    }
    db::decide_release(&mut tx, release, status, Some(p.user.id), note.trim(), None).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(project_target.org().0), action, "project", r.project_id)
            .decision(d)
            .details(json!({ "env": r.env_key, "checkpoint": r.checkpoint_seq, "release": release, "note": note.trim() })),
    )
    .await?;
    let row = db::get_release(&mut *tx, release).await?;
    tx.commit().await.map_err(tx_err)?;
    match status {
        ReleaseStatus::Released => after_change(&state, r.project_id).await,
        ReleaseStatus::Queued => enqueue_deploy(&state, release).await?,
        _ => {}
    }
    Ok(Json(row.into()))
}

#[utoipa::path(post, path = "/api/releases/{release}/approve", tag = "delivery", params(("release" = Uuid, Path)), request_body = DecisionBody, responses((status = 200, body = ReleaseDto)))]
pub async fn approve(State(state): State<AppState>, p: Principal, Path(release): Path<Uuid>, body: Option<Json<DecisionBody>>) -> ApiResult<Json<ReleaseDto>> {
    decide(state, p, release, Verdict::Approve, body.map(|b| b.0.note).unwrap_or_default()).await
}

#[utoipa::path(post, path = "/api/releases/{release}/reject", tag = "delivery", params(("release" = Uuid, Path)), request_body = DecisionBody, responses((status = 200, body = ReleaseDto)))]
pub async fn reject(State(state): State<AppState>, p: Principal, Path(release): Path<Uuid>, body: Option<Json<DecisionBody>>) -> ApiResult<Json<ReleaseDto>> {
    decide(state, p, release, Verdict::Reject, body.map(|b| b.0.note).unwrap_or_default()).await
}

#[utoipa::path(post, path = "/api/releases/{release}/cancel", tag = "delivery", params(("release" = Uuid, Path)), responses((status = 200, body = ReleaseDto)))]
pub async fn cancel(State(state): State<AppState>, p: Principal, Path(release): Path<Uuid>) -> ApiResult<Json<ReleaseDto>> {
    decide(state, p, release, Verdict::Cancel, String::new()).await
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RemoteDto {
    pub url: String,
    pub username: String,
    pub has_token: bool,
    pub auto_push: bool,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_push_at: Option<OffsetDateTime>,
    pub last_push_ok: Option<bool>,
    pub last_push_error: Option<String>,
}

impl From<db::Remote> for RemoteDto {
    fn from(r: db::Remote) -> Self {
        Self {
            url: r.url,
            username: r.username,
            has_token: r.token_cipher.is_some(),
            auto_push: r.auto_push,
            last_push_at: r.last_push_at,
            last_push_ok: r.last_push_ok,
            last_push_error: r.last_push_error,
        }
    }
}

#[utoipa::path(get, path = "/api/projects/{project}/remote", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = Option<RemoteDto>)))]
pub async fn get_remote(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Option<RemoteDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    Ok(Json(db::get_remote(&state.db, project).await?.map(Into::into)))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PutRemote {
    /// HTTPS clone URL, e.g. `https://github.com/acme/shop.git`.
    pub url: String,
    #[serde(default)]
    pub username: String,
    /// Omit to keep the stored token, send an empty string to remove it.
    pub token: Option<String>,
    #[serde(default = "yes")]
    pub auto_push: bool,
}

fn yes() -> bool {
    true
}

fn validate_remote_url(url: &str) -> ApiResult<()> {
    let lower = url.to_ascii_lowercase();
    let scheme_ok = lower.starts_with("https://") || lower.starts_with("http://");
    let rest = url.split_once("://").map(|(_, r)| r).unwrap_or_default();
    let host = rest.split('/').next().unwrap_or_default();
    if !scheme_ok || host.is_empty() || url.len() > 500 || url.chars().any(|c| c.is_whitespace() || c.is_control()) {
        return Err(ApiError::invalid("url", "must be an http(s) URL"));
    }
    if host.contains('@') {
        return Err(ApiError::invalid("url", "put credentials in the token field, not in the URL"));
    }
    Ok(())
}

#[utoipa::path(put, path = "/api/projects/{project}/remote", tag = "delivery", params(("project" = Uuid, Path)), request_body = PutRemote, responses((status = 200, body = RemoteDto)))]
pub async fn put_remote(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>, Json(req): Json<PutRemote>) -> ApiResult<Json<RemoteDto>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::SecretWrite).await?;
    let url = req.url.trim();
    validate_remote_url(url)?;
    let token_cipher = match req.token.as_deref().map(str::trim) {
        None => None,
        Some("") => Some(None),
        Some(token) => {
            let key = state
                .config
                .secret_key
                .as_ref()
                .ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY on the server before saving tokens".into()))?;
            Some(Some(key.encrypt(token.as_bytes())))
        }
    };
    let mut tx = state.db.begin().await.map_err(tx_err)?;
    db::upsert_remote(&mut *tx, RemoteUpdate { project_id: project, url, username: req.username.trim(), token_cipher, auto_push: req.auto_push, updated_by: p.user.id }).await?;
    audit::record(
        &mut *tx,
        &p,
        Entry::new(Some(target.org().0), "remote.update", "project", project)
            .decision(d)
            .details(json!({ "url": url, "tokenChanged": req.token.is_some(), "autoPush": req.auto_push })),
    )
    .await?;
    let row = db::get_remote(&mut *tx, project).await?.ok_or(ApiError::NotFound)?;
    tx.commit().await.map_err(tx_err)?;
    Ok(Json(row.into()))
}

#[utoipa::path(delete, path = "/api/projects/{project}/remote", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete_remote(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::SecretWrite).await?;
    let mut tx = state.db.begin().await.map_err(tx_err)?;
    if !db::delete_remote(&mut *tx, project).await? {
        return Err(ApiError::NotFound);
    }
    audit::record(&mut *tx, &p, Entry::new(Some(target.org().0), "remote.delete", "project", project).decision(d)).await?;
    tx.commit().await.map_err(tx_err)?;
    Ok(Json(OK))
}

/// Queues a push of every branch and tag to the remote. The result shows up on the remote's status.
#[utoipa::path(post, path = "/api/projects/{project}/remote/push", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 202, body = Ok)))]
pub async fn push_remote(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<(StatusCode, Json<Ok>)> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    if db::get_remote(&state.db, project).await?.is_none() {
        return Err(ApiError::Conflict("connect a remote first".into()));
    }
    state.repos.open(project).await.map_err(|_| ApiError::Conflict("create a checkpoint first; the repository is empty".into()))?;
    state.mq.publish(Job::PushRemote { project_id: project }).await.map_err(|e| ApiError::Internal(e.into()))?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "remote.push", "project", project).decision(d)).await?;
    Ok((StatusCode::ACCEPTED, Json(OK)))
}

/// Every branch and tag as a git bundle: `git clone <project>.bundle` gives a normal repository.
#[utoipa::path(get, path = "/api/projects/{project}/repository.bundle", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, content_type = "application/octet-stream")))]
pub async fn bundle(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<impl IntoResponse> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectRead).await?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    let repo = state.repos.open(project).await.map_err(git_err)?;
    let bytes = repo.bundle().await.map_err(git_err)?;
    let disposition = format!("attachment; filename=\"{}.bundle\"", saved.slug);
    Ok(([(header::CONTENT_TYPE, "application/octet-stream".to_owned()), (header::CONTENT_DISPOSITION, disposition)], bytes))
}

#[derive(Deserialize, IntoParams)]
pub struct LogQuery {
    /// Return lines after this sequence number.
    #[serde(default)]
    pub after: i64,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct LogLineDto {
    pub seq: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub line: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ReleaseLogDto {
    pub release: ReleaseDto,
    pub lines: Vec<LogLineDto>,
}

/// Deploy output, oldest first. Poll with `after` set to the last `seq` you have.
#[utoipa::path(get, path = "/api/releases/{release}/logs", tag = "delivery", params(("release" = Uuid, Path), LogQuery), responses((status = 200, body = ReleaseLogDto)))]
pub async fn release_logs(State(state): State<AppState>, p: Principal, Path(release): Path<Uuid>, Query(q): Query<LogQuery>) -> ApiResult<Json<ReleaseLogDto>> {
    let r = db::get_release(&state.db, release).await?;
    let project_target = rbac::project_target(&state, r.project_id).await?;
    rbac::require(&state, &p, &env_target(&project_target, &r.env_key), P::DeploymentRead).await?;
    let lines = db::logs(&state.db, release, q.after, 2000).await?;
    Ok(Json(ReleaseLogDto {
        release: r.into(),
        lines: lines.into_iter().map(|l| LogLineDto { seq: l.seq, at: l.at, line: l.line }).collect(),
    }))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SecretDto {
    pub name: String,
    /// Created by Tessery on the first deploy, like a database password.
    pub generated: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub updated_at: OffsetDateTime,
    pub updated_by: Option<String>,
}

fn valid_secret_name(name: &str) -> bool {
    name.len() <= 128
        && name.chars().next().is_some_and(|c| c.is_ascii_uppercase() || c == '_')
        && name.chars().all(|c| c.is_ascii_uppercase() || c.is_ascii_digit() || c == '_')
}

/// Names of the secrets stored for an environment. Values are never returned.
#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/secrets", tag = "delivery", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 200, body = [SecretDto])))]
pub async fn list_secrets(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<Json<Vec<SecretDto>>> {
    let project_target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &env_target(&project_target, &env), P::DeploymentRead).await?;
    let rows = db::secrets(&state.db, project, &env).await?;
    Ok(Json(rows.into_iter().map(|s| SecretDto { name: s.name, generated: s.generated, updated_at: s.updated_at, updated_by: s.updated_by_name }).collect()))
}

#[derive(Deserialize, ToSchema)]
pub struct PutSecret {
    pub value: String,
}

#[utoipa::path(put, path = "/api/projects/{project}/environments/{env}/secrets/{name}", tag = "delivery", params(("project" = Uuid, Path), ("env" = String, Path), ("name" = String, Path)), request_body = PutSecret, responses((status = 200, body = Ok)))]
pub async fn put_secret(State(state): State<AppState>, p: Principal, Path((project, env, name)): Path<(Uuid, String, String)>, Json(req): Json<PutSecret>) -> ApiResult<Json<Ok>> {
    let project_target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &env_target(&project_target, &env), P::SecretWrite).await?;
    if !valid_secret_name(&name) {
        return Err(ApiError::invalid("name", "use capital letters, digits and underscores, starting with a letter"));
    }
    if !valid_env_key(&env) {
        return Err(ApiError::invalid("env", "unknown environment"));
    }
    if req.value.len() > 64 * 1024 {
        return Err(ApiError::invalid("value", "at most 64 KiB"));
    }
    if req.value.contains('\n') && !tessery_core::runner::is_connection_secret(&name) {
        return Err(ApiError::invalid("value", "only KUBECONFIG, SSH_PRIVATE_KEY and SSH_KNOWN_HOSTS may span several lines"));
    }
    let key = state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY on the server before saving secrets".into()))?;
    let cipher = key.encrypt(req.value.as_bytes());
    db::put_secret(&state.db, project, &env, &name, &cipher, false, Some(p.user.id)).await?;
    audit::record(&state.db, &p, Entry::new(Some(project_target.org().0), "secret.write", "project", project).decision(d).details(json!({ "env": env, "name": name }))).await?;
    Ok(Json(OK))
}

#[utoipa::path(delete, path = "/api/projects/{project}/environments/{env}/secrets/{name}", tag = "delivery", params(("project" = Uuid, Path), ("env" = String, Path), ("name" = String, Path)), responses((status = 200, body = Ok)))]
pub async fn delete_secret(State(state): State<AppState>, p: Principal, Path((project, env, name)): Path<(Uuid, String, String)>) -> ApiResult<Json<Ok>> {
    let project_target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &env_target(&project_target, &env), P::SecretWrite).await?;
    if !db::delete_secret(&state.db, project, &env, &name).await? {
        return Err(ApiError::NotFound);
    }
    audit::record(&state.db, &p, Entry::new(Some(project_target.org().0), "secret.delete", "project", project).decision(d).details(json!({ "env": env, "name": name }))).await?;
    Ok(Json(OK))
}
