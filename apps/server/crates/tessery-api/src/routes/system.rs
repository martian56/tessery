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

/// Where the latest release is read from; tests point this at a fake.
pub const RELEASES_URL: &str = "https://api.github.com/repos/martian56/tessery/releases/latest";
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
    let update_available = latest.as_ref().is_some_and(|(v, _)| is_newer(v, &current));
    let (latest, release_url) = latest.unzip();
    Json(VersionInfo { current, latest, release_url, update_available })
}

/// The latest release's version and page, cached in Redis so instances stay well under GitHub's rate limit.
async fn latest_release(state: &AppState) -> Option<(String, String)> {
    let url = &state.config.releases_url;
    let key = format!("tessery:latest-release:{url}");
    let mut r = state.redis.clone();
    if let Ok(Some(hit)) = redis::cmd("GET").arg(&key).query_async::<Option<String>>(&mut r).await
        && let Ok(found) = serde_json::from_str::<Option<(String, String)>>(&hit)
    {
        return found;
    }
    let found = fetch_latest(url).await;
    let _: Result<(), _> = redis::cmd("SET")
        .arg(&key)
        .arg(serde_json::to_string(&found).unwrap_or_default())
        .arg("EX")
        .arg(if found.is_some() { RELEASE_CACHE_SECS } else { MISS_CACHE_SECS })
        .query_async(&mut r)
        .await;
    found
}

async fn fetch_latest(url: &str) -> Option<(String, String)> {
    #[derive(Deserialize)]
    struct Release {
        tag_name: String,
        #[serde(default)]
        html_url: String,
    }
    let res = reqwest::Client::new()
        .get(url)
        .header("user-agent", "tessery")
        .header("accept", "application/vnd.github+json")
        .timeout(std::time::Duration::from_secs(5))
        .send()
        .await
        .ok()?;
    if !res.status().is_success() {
        return None;
    }
    let release: Release = res.json().await.ok()?;
    let version = release.tag_name.trim_start_matches('v').to_owned();
    parse_version(&version)?;
    Some((version, release.html_url))
}

/// `major.minor.patch` with an optional `-pre` suffix; anything else (such as `dev`) is not a version.
fn parse_version(v: &str) -> Option<([u64; 3], Option<&str>)> {
    let (core, pre) = match v.split_once('-') {
        Some((c, p)) => (c, Some(p)),
        None => (v, None),
    };
    let mut parts = core.split('.').map(|p| p.parse::<u64>().ok());
    let n = [parts.next()??, parts.next()??, parts.next()??];
    if parts.next().is_some() {
        return None;
    }
    Some((n, pre))
}

/// Whether `latest` is a later version than `current`. A pre-release sorts before its release, and a build
/// without a version never reports an update.
pub fn is_newer(latest: &str, current: &str) -> bool {
    let (Some((l, lp)), Some((c, cp))) = (parse_version(latest), parse_version(current)) else {
        return false;
    };
    match l.cmp(&c) {
        std::cmp::Ordering::Greater => true,
        std::cmp::Ordering::Less => false,
        std::cmp::Ordering::Equal => match (lp, cp) {
            (None, Some(_)) => true,
            (Some(a), Some(b)) => pre_release_order(a, b).is_gt(),
            _ => false,
        },
    }
}

/// Orders pre-release labels by their dot-separated parts, numbers as numbers: `rc.10` comes after `rc.2`.
fn pre_release_order(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut x, mut y) = (a.split('.'), b.split('.'));
    loop {
        let ord = match (x.next(), y.next()) {
            (None, None) => return std::cmp::Ordering::Equal,
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (Some(p), Some(q)) => match (p.parse::<u64>(), q.parse::<u64>()) {
                (Ok(m), Ok(n)) => m.cmp(&n),
                (Ok(_), Err(_)) => std::cmp::Ordering::Less,
                (Err(_), Ok(_)) => std::cmp::Ordering::Greater,
                (Err(_), Err(_)) => p.cmp(q),
            },
        };
        if ord.is_ne() {
            return ord;
        }
    }
}
