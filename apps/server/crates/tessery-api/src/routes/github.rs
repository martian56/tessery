use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode};
use axum::response::{IntoResponse, Redirect, Response};
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use tessery_cloud::github::{self as gh, AppInfo};
use tessery_core::Permission as P;
use tessery_mq::Job;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

fn key(state: &AppState) -> ApiResult<&tessery_core::SecretKey> {
    state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY to connect GitHub".into()))
}

pub async fn app(state: &AppState) -> ApiResult<Option<(gh::App, AppInfo)>> {
    let row = tessery_db::github::app(&state.db).await?;
    let (Some(info), Some(cipher)) = (row.app, row.key) else { return Ok(None) };
    let info: AppInfo = serde_json::from_value(info).map_err(|e| ApiError::Internal(e.into()))?;
    let pem = String::from_utf8(key(state)?.decrypt(&cipher).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?;
    let app = gh::App::new(info.id, &pem).map_err(ApiError::Conflict)?;
    Ok(Some((app, info)))
}

fn public_url(state: &AppState, headers: &HeaderMap) -> String {
    crate::mail::base_url(state, headers)
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubSettings {
    #[schema(value_type = Option<Object>)]
    pub app: Option<Value>,
    /// Where the browser posts the manifest to create the app: a personal account or, with `?org=`, an organization.
    pub create_url: String,
    #[schema(value_type = Object)]
    pub manifest: Value,
    pub webhook_url: String,
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct CreateQuery {
    /// A GitHub organization to create the app in. Leave out for your personal account.
    pub org: Option<String>,
}

#[utoipa::path(get, path = "/api/admin/github", tag = "admin", params(CreateQuery), responses((status = 200, body = GithubSettings)))]
pub async fn settings(State(state): State<AppState>, p: Principal, headers: HeaderMap, Query(q): Query<CreateQuery>) -> ApiResult<Json<GithubSettings>> {
    p.require_instance_admin()?;
    let url = public_url(&state, &headers);
    let host = url.split("://").nth(1).unwrap_or(&url).to_owned();
    let mut b = [0u8; 16];
    rand::rng().fill_bytes(&mut b);
    let nonce = hex::encode(b);
    let mut redis = state.redis.clone();
    let _: () = redis.set_ex(format!("tessery:gh-manifest:{nonce}"), p.user.id.to_string(), 900).await.map_err(|e| ApiError::Internal(e.into()))?;
    let base = match q.org.as_deref().map(str::trim).filter(|o| !o.is_empty()) {
        Some(org) if org.chars().all(|c| c.is_ascii_alphanumeric() || c == '-') => format!("https://github.com/organizations/{org}/settings/apps/new"),
        Some(_) => return Err(ApiError::invalid("org", "use the organization's login, for example acme")),
        None => "https://github.com/settings/apps/new".into(),
    };
    let row = tessery_db::github::app(&state.db).await?;
    Ok(Json(GithubSettings {
        app: row.app,
        create_url: format!("{base}?state={nonce}"),
        manifest: gh::manifest(&format!("Tessery {}", host.split(':').next().unwrap_or(&host)).chars().take(34).collect::<String>(), &url),
        webhook_url: format!("{url}/api/github/webhook"),
    }))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct ManifestReturn {
    pub code: String,
    pub state: String,
}

/// GitHub sends the admin back here after creating the app; this stores its keys.
#[utoipa::path(get, path = "/api/github/manifest", tag = "admin", params(ManifestReturn), responses((status = 303)))]
pub async fn manifest_return(State(state): State<AppState>, p: Principal, Query(q): Query<ManifestReturn>) -> ApiResult<Response> {
    p.require_instance_admin()?;
    let mut redis = state.redis.clone();
    let owner: Option<String> = redis.get_del(format!("tessery:gh-manifest:{}", q.state)).await.map_err(|e| ApiError::Internal(e.into()))?;
    if owner.as_deref() != Some(p.user.id.to_string().as_str()) {
        return Err(ApiError::ForbiddenMsg("this GitHub App link expired or was started by someone else; start again from Instance admin, GitHub".into()));
    }
    let created = gh::convert_manifest(&q.code).await.map_err(ApiError::Conflict)?;
    let k = key(&state)?;
    let info = serde_json::to_value(&created.info).map_err(|e| ApiError::Internal(e.into()))?;
    tessery_db::github::set_app(&state.db, Some(&info), Some(&k.encrypt(created.pem.as_bytes())), Some(&k.encrypt(created.webhook_secret.as_bytes()))).await?;
    audit::record(&state.db, &p, Entry::new(None, "instance.github_app", "instance", p.user.id).details(json!({ "app": created.info.slug, "owner": created.info.owner }))).await?;
    Ok(Redirect::to("/admin/github?created=1").into_response())
}

#[utoipa::path(delete, path = "/api/admin/github", tag = "admin", responses((status = 200, body = Ok)))]
pub async fn forget(State(state): State<AppState>, p: Principal) -> ApiResult<Json<Ok>> {
    p.require_instance_admin()?;
    tessery_db::github::set_app(&state.db, None, None, None).await?;
    audit::record(&state.db, &p, Entry::new(None, "instance.github_app_removed", "instance", p.user.id)).await?;
    Ok(Json(OK))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GithubRepoDto {
    pub full_name: String,
    pub private: bool,
    pub installation: i64,
}

/// Repositories the app is installed on, to pick one for a project.
#[utoipa::path(get, path = "/api/projects/{project}/github/repos", tag = "delivery", params(("project" = Uuid, Path)), responses((status = 200, body = [GithubRepoDto]), (status = 409)))]
pub async fn repos(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>) -> ApiResult<Json<Vec<GithubRepoDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let (app, _) = app(&state).await?.ok_or_else(|| ApiError::Conflict("an instance admin has to create the GitHub App first, under Instance admin, GitHub".into()))?;
    let repos = app.repos().await.map_err(ApiError::Conflict)?;
    Ok(Json(repos.into_iter().map(|r| GithubRepoDto { full_name: r.full_name, private: r.private, installation: r.installation }).collect()))
}

#[derive(Deserialize, ToSchema)]
pub struct LinkInput {
    /// `owner/name`, from the repository list.
    pub repo: String,
}

/// Links the project to a GitHub repository and starts the first sync.
#[utoipa::path(put, path = "/api/projects/{project}/github", tag = "delivery", request_body = LinkInput, params(("project" = Uuid, Path)), responses((status = 200, body = Ok), (status = 409)))]
pub async fn link(State(state): State<AppState>, p: Principal, Path(project): Path<Uuid>, Json(req): Json<LinkInput>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let (app, _) = app(&state).await?.ok_or_else(|| ApiError::Conflict("an instance admin has to create the GitHub App first".into()))?;
    let repo = app.repos().await.map_err(ApiError::Conflict)?.into_iter().find(|r| r.full_name.eq_ignore_ascii_case(req.repo.trim())).ok_or_else(|| ApiError::invalid("repo", "the GitHub App is not installed on that repository"))?;
    tessery_db::github::link(&state.db, tessery_db::github::Link { project_id: project, repo: &repo.full_name, installation: repo.installation, linked_by: p.user.id, auto_push: true }).await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "project.github_link", "project", project).decision(d).details(json!({ "repo": repo.full_name }))).await?;
    state.mq.publish(Job::PushRemote { project_id: project }).await.map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    Ok(Json(OK))
}

/// Receives push events from GitHub. A push to `main` of a linked repository is imported as a checkpoint.
#[utoipa::path(post, path = "/api/github/webhook", tag = "delivery", request_body(content = Object, description = "A GitHub webhook payload, signed with X-Hub-Signature-256", content_type = "application/json"), responses((status = 202), (status = 401)))]
pub async fn webhook(State(state): State<AppState>, headers: HeaderMap, body: Bytes) -> ApiResult<StatusCode> {
    let row = tessery_db::github::app(&state.db).await?;
    let secret = row.webhook_secret.ok_or(ApiError::NotFound)?;
    let secret = key(&state)?.decrypt(&secret).map_err(|e| ApiError::Internal(e.into()))?;
    let signature = headers.get("x-hub-signature-256").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !gh::verify_webhook(&secret, &body, signature) {
        return Err(ApiError::Unauthenticated);
    }
    let event = headers.get("x-github-event").and_then(|v| v.to_str().ok()).unwrap_or_default();
    if event != "push" {
        return Ok(StatusCode::ACCEPTED);
    }
    let payload: Value = serde_json::from_slice(&body).map_err(|_| ApiError::invalid("body", "not JSON"))?;
    if payload["ref"] != "refs/heads/main" || payload["deleted"] == true {
        return Ok(StatusCode::ACCEPTED);
    }
    let repo = payload["repository"]["full_name"].as_str().unwrap_or_default();
    for linked in tessery_db::github::projects_for_repo(&state.db, repo).await? {
        if let Err(e) = state.mq.publish(Job::PushRemote { project_id: linked.project_id }).await {
            tracing::warn!(error = %e, project = %linked.project_id, "could not queue a GitHub sync");
        }
    }
    Ok(StatusCode::ACCEPTED)
}
