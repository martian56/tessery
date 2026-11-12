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
