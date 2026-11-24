use crate::audit::{self, Entry};
use crate::auth::{self, Principal, RequestMeta, password, session};
use crate::error::{ApiError, ApiResult};
use crate::routes::dto::{UserDto, clean_name, normalize_email, slug_or_from};
use crate::state::AppState;
use tessery_db::bindings::NewBinding;
use tessery_db::types::{ScopeKind, SubjectKind};
use axum::Json;
use axum::extract::State;
use axum::http::StatusCode;
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;

#[derive(Serialize, ToSchema)]
pub struct Health {
    pub status: &'static str,
    pub database: bool,
    pub redis: bool,
    pub queue: bool,
    /// The Node process that runs code generation and design edits.
    pub engine: bool,
}

#[utoipa::path(get, path = "/api/health", tag = "system", responses((status = 200, body = Health), (status = 503, body = Health)))]
pub async fn health(State(state): State<AppState>) -> (StatusCode, Json<Health>) {
    let database = sqlx::query_scalar::<_, i32>("SELECT 1")
        .fetch_one(&state.db)
        .await
        .is_ok();
    let mut r = state.redis.clone();
    let redis = redis::cmd("PING")
        .query_async::<String>(&mut r)
        .await
        .is_ok();
    let queue = state.mq.healthy().await;
    let engine = state.engine.ping().await.is_ok();
    let ok = database && redis && queue && engine;
    (
        if ok {
            StatusCode::OK
        } else {
            StatusCode::SERVICE_UNAVAILABLE
        },
        Json(Health {
            status: if ok { "ok" } else { "degraded" },
            database,
            redis,
            queue,
            engine,
        }),
    )
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupStatus {
    pub required: bool,
}

#[utoipa::path(get, path = "/api/setup", tag = "system", responses((status = 200, body = SetupStatus)))]
pub async fn setup_status(State(state): State<AppState>) -> ApiResult<Json<SetupStatus>> {
    let s = tessery_db::settings::get(&state.db).await?;
    Ok(Json(SetupStatus {
        required: s.setup_completed_at.is_none(),
    }))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupRequest {
    pub email: String,
    pub name: String,
    pub password: String,
    pub org_name: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SetupResponse {
    pub user: UserDto,
    pub org_id: uuid::Uuid,
}

/// First-run setup. Creates the instance administrator and their first organization. Works exactly once.
#[utoipa::path(post, path = "/api/setup", tag = "system", request_body = SetupRequest, responses((status = 201, body = SetupResponse), (status = 409)))]
pub async fn setup(
    State(state): State<AppState>,
    meta: RequestMeta,
    jar: CookieJar,
    Json(req): Json<SetupRequest>,
) -> ApiResult<(StatusCode, CookieJar, Json<SetupResponse>)> {
    let email = normalize_email(&req.email)?;
    let name = clean_name("name", &req.name, 120)?;
    let org_name = clean_name("orgName", &req.org_name, 120)?;
    let slug = slug_or_from("orgName", None, &org_name)?;
    password::validate(&req.password)?;
    let hash = password::hash(req.password).await?;

    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    if !tessery_db::settings::complete_setup(&mut *tx).await? {
        return Err(ApiError::Conflict(
            "setup has already been completed".into(),
        ));
    }
    let user = tessery_db::users::create(&mut *tx, &email, &name, Some(&hash), true).await?;
    let org = tessery_db::orgs::create(&mut *tx, &slug, &org_name, user.id).await?;
    tessery_db::orgs::add_member(&mut *tx, org.id, user.id).await?;
    let owner = tessery_db::roles::get_by_key(&mut *tx, org.id, "owner").await?;
    tessery_db::bindings::create(
        &mut *tx,
        NewBinding {
            org_id: org.id,
            role_id: owner.id,
            subject_kind: SubjectKind::User,
            subject_id: user.id,
            scope_kind: ScopeKind::Org,
            scope_id: None,
            env_key: None,
            expires_at: None,
            created_by: user.id,
        },
    )
    .await?;
    let actor = Principal {
        user: user.clone(),
        token: String::new(),
        meta,
        scope: None,
    };
    audit::record(
        &mut *tx,
        &actor,
        Entry::new(Some(org.id), "instance.setup", "instance", "instance")
            .details(json!({ "org": org.slug })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;

    let mut redis = state.redis.clone();
    let token = session::create(&mut redis, user.id, state.config.session_ttl).await?;
    tessery_db::users::touch_login(&state.db, user.id).await?;
    let jar = jar.add(auth::session_cookie(&state, token));
    Ok((
        StatusCode::CREATED,
        jar,
        Json(SetupResponse {
            user: user.into(),
            org_id: org.id,
        }),
    ))
}

pub use tessery_update::{RELEASES_URL, is_newer};
use tessery_update::Release;

const RELEASE_CACHE_SECS: u64 = 600;
/// How long a failed or empty lookup is remembered before GitHub is asked again.
const MISS_CACHE_SECS: u64 = 120;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct VersionInfo {
    /// The version this instance runs, or `dev` for a build without one.
    pub current: String,
    /// The newest published release, or null when GitHub can't be reached.
    pub latest: Option<String>,
    /// The latest release's notes on GitHub.
    pub release_url: Option<String>,
    pub update_available: bool,
}

#[utoipa::path(get, path = "/api/system/version", operation_id = "system_version", tag = "system", responses((status = 200, body = VersionInfo)))]
pub async fn version(State(state): State<AppState>, _p: Principal) -> Json<VersionInfo> {
    let current = state.config.version.clone();
    let latest = latest_release(&state).await;
    let update_available = latest.as_ref().is_some_and(|r| is_newer(&r.version, &current));
    let (latest, release_url) = latest.map(|r| (r.version, r.url)).unzip();
    Json(VersionInfo { current, latest, release_url, update_available })
}

/// Reads through a Redis cache so instances stay well under GitHub's rate limit; misses are kept for less time.
async fn cached<T: Serialize + serde::de::DeserializeOwned>(state: &AppState, key: &str, fetch: impl std::future::Future<Output = Option<T>>) -> Option<T> {
    let key = format!("tessery:{key}:{}", state.config.releases_url);
    let mut r = state.redis.clone();
    if let Ok(Some(hit)) = redis::cmd("GET").arg(&key).query_async::<Option<String>>(&mut r).await
        && let Ok(found) = serde_json::from_str::<Option<T>>(&hit)
    {
        return found;
    }
    let found = fetch.await;
    let _: Result<(), _> = redis::cmd("SET")
        .arg(&key)
        .arg(serde_json::to_string(&found).unwrap_or_default())
        .arg("EX")
        .arg(if found.is_some() { RELEASE_CACHE_SECS } else { MISS_CACHE_SECS })
        .query_async(&mut r)
        .await;
    found
}

async fn latest_release(state: &AppState) -> Option<Release> {
    cached(state, "latest-release", tessery_update::fetch_latest(&state.config.releases_url)).await
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemRelease {
    pub version: String,
    pub name: String,
    /// Release notes in Markdown.
    pub notes: String,
    pub url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SystemReleaseList {
    /// Null when GitHub can't be reached.
    pub releases: Option<Vec<SystemRelease>>,
}

#[utoipa::path(get, path = "/api/system/releases", operation_id = "system_releases", tag = "system", responses((status = 200, body = SystemReleaseList)))]
pub async fn releases(State(state): State<AppState>, p: Principal) -> ApiResult<Json<SystemReleaseList>> {
    p.require_instance_admin()?;
    let list = cached(&state, "releases", tessery_update::fetch_releases(&state.config.releases_url)).await;
    Ok(Json(SystemReleaseList {
        releases: list.map(|l| {
            l.into_iter()
                .map(|r| SystemRelease { version: r.version, name: r.name, notes: r.notes, url: r.url, published_at: r.published_at, prerelease: r.prerelease })
                .collect()
        }),
    }))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateEntry {
    pub from_version: String,
    pub to_version: String,
    /// `update` or `rollback`.
    pub kind: String,
    pub automatic: bool,
    pub started_by: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    #[schema(value_type = String, format = DateTime)]
    pub started_at: time::OffsetDateTime,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdatesInfo {
    pub current: String,
    /// False when `TESSERY_COMPOSE_DIR` isn't set, which turns in-app updates off.
    pub enabled: bool,
    /// The older version the last move to the running version came from, which a rollback returns to.
    pub rollback_to: Option<String>,
    pub history: Vec<UpdateEntry>,
}

#[utoipa::path(get, path = "/api/system/updates", operation_id = "system_updates", tag = "system", responses((status = 200, body = UpdatesInfo)))]
pub async fn updates(State(state): State<AppState>, p: Principal) -> ApiResult<Json<UpdatesInfo>> {
    p.require_instance_admin()?;
    let current = state.config.version.clone();
    let history = tessery_db::updates::list(&state.db, 20).await?;
    let rollback_to = history
        .iter()
        .find(|u| u.to_version == current)
        .map(|u| u.from_version.clone())
        .filter(|v| is_newer(&current, v));
    Ok(Json(UpdatesInfo {
        enabled: state.config.updater.enabled(),
        rollback_to,
        history: history
            .into_iter()
            .map(|u| UpdateEntry {
                from_version: u.from_version,
                to_version: u.to_version,
                kind: u.kind,
                automatic: u.automatic,
                started_by: u.started_by_email,
                started_at: u.started_at,
            })
            .collect(),
        current,
    }))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct StartUpdate {
    /// The version to move to: a newer one updates, an older one rolls back.
    pub version: String,
}

#[utoipa::path(post, path = "/api/system/update", operation_id = "system_update", tag = "system", request_body = StartUpdate, responses((status = 202, body = crate::routes::dto::Ok), (status = 409, body = crate::error::ErrorBody)))]
pub async fn start_update(State(state): State<AppState>, p: Principal, Json(req): Json<StartUpdate>) -> ApiResult<(StatusCode, Json<crate::routes::dto::Ok>)> {
    p.require_instance_admin()?;
    let target = req.version.trim().trim_start_matches('v').to_owned();
    let current = state.config.version.clone();
    if !tessery_update::is_version(&target) {
        return Err(ApiError::invalid("version", "use a version such as 0.2.0"));
    }
    if target == current {
        return Err(ApiError::Conflict(format!("Tessery already runs {target}")));
    }
    let kind = if is_newer(&target, &current) || !tessery_update::is_version(&current) { "update" } else { "rollback" };
    state.config.updater.start(&target).await.map_err(|e| match e {
        tessery_update::UpdateError::Disabled | tessery_update::UpdateError::AlreadyRunning => ApiError::Conflict(e.to_string()),
        tessery_update::UpdateError::BadVersion(_) => ApiError::invalid("version", e.to_string()),
        tessery_update::UpdateError::Failed(_) => ApiError::Internal(anyhow::anyhow!(e.to_string())),
    })?;
    tessery_db::updates::record(&state.db, &current, &target, kind, Some(p.user.id)).await?;
    audit::record(
        &state.db,
        &p,
        Entry::new(None, if kind == "update" { "system.update" } else { "system.rollback" }, "instance", "instance")
            .details(json!({ "from": current, "to": target, "trigger": "manual" })),
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(crate::routes::dto::Ok { ok: true })))
}
