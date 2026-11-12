use crate::audit::{self, Entry};
use crate::auth::{self, Principal, RequestMeta, password, rate_limit, session};
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok, UserDto, clean_name};
use crate::state::AppState;
use tessery_core::{OrgId, Target, TeamId};
use axum::Json;
use axum::extract::{Query, State};
use axum_extra::extract::CookieJar;
use serde::{Deserialize, Serialize};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Deserialize, ToSchema)]
pub struct LoginRequest {
    pub email: String,
    pub password: String,
}

#[utoipa::path(post, path = "/api/auth/login", tag = "auth", request_body = LoginRequest, responses((status = 200, body = UserDto), (status = 401), (status = 429)))]
pub async fn login(
    State(state): State<AppState>,
    meta: RequestMeta,
    jar: CookieJar,
    Json(req): Json<LoginRequest>,
) -> ApiResult<(CookieJar, Json<UserDto>)> {
    let email = req.email.trim().to_lowercase();
    let mut redis = state.redis.clone();
    let ip_key = format!("login:ip:{}", meta.ip.as_deref().unwrap_or("unknown"));
    let email_key = format!("login:email:{email}");
    if !rate_limit::allow(&mut redis, &ip_key, 30, 300).await?
        || !rate_limit::allow(&mut redis, &email_key, 8, 300).await?
    {
        return Err(ApiError::RateLimited);
    }
    let user = tessery_db::users::find_by_email(&state.db, &email).await?;
    let ok = password::verify(
        req.password,
        user.as_ref().and_then(|u| u.password_hash.clone()),
    )
    .await;
    let user = match user {
        Some(u) if ok && u.disabled_at.is_none() => u,
        _ => {
            tessery_db::audit::insert(
                &state.db,
                tessery_db::audit::NewEvent {
                    actor_email: Some(email),
                    action: "auth.login".into(),
                    resource_type: "session".into(),
                    result: Some(tessery_db::types::AuditResult::Denied),
                    ip: meta.ip,
                    user_agent: meta.user_agent,
                    details: serde_json::json!({}),
                    ..Default::default()
                },
            )
            .await?;
            return Err(ApiError::InvalidCredentials);
        }
    };
    rate_limit::reset(&mut redis, &email_key).await?;
    let token = session::create(&mut redis, user.id, state.config.session_ttl).await?;
    tessery_db::users::touch_login(&state.db, user.id).await?;
    let actor = Principal {
        user: user.clone(),
        token: token.clone(),
        meta,
        scope: None,
    };
    audit::record(
        &state.db,
        &actor,
        Entry::new(None, "auth.login", "session", user.id),
    )
    .await?;
    Ok((
        jar.add(auth::session_cookie(&state, token)),
        Json(user.into()),
    ))
}

#[utoipa::path(post, path = "/api/auth/logout", tag = "auth", responses((status = 200, body = Ok)))]
pub async fn logout(
    State(state): State<AppState>,
    p: Principal,
    jar: CookieJar,
) -> ApiResult<(CookieJar, Json<Ok>)> {
    let mut redis = state.redis.clone();
    session::destroy(&mut redis, &p.token).await?;
    Ok((jar.add(auth::clear_cookie()), Json(OK)))
}

#[utoipa::path(get, path = "/api/auth/me", tag = "auth", responses((status = 200, body = UserDto), (status = 401)))]
pub async fn me(p: Principal) -> Json<UserDto> {
    Json(p.user.into())
}

#[derive(Deserialize, ToSchema)]
pub struct UpdateMe {
    pub name: String,
}

#[utoipa::path(patch, path = "/api/auth/me", tag = "auth", request_body = UpdateMe, responses((status = 200, body = UserDto)))]
pub async fn update_me(
    State(state): State<AppState>,
    p: Principal,
    Json(req): Json<UpdateMe>,
) -> ApiResult<Json<UserDto>> {
    let name = clean_name("name", &req.name, 120)?;
    tessery_db::users::update_profile(&state.db, p.user.id, &name).await?;
    Ok(Json(
        tessery_db::users::get(&state.db, p.user.id).await?.into(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ChangePassword {
    pub current_password: String,
    pub new_password: String,
}

/// Changes the password and signs out every other session.
#[utoipa::path(post, path = "/api/auth/password", tag = "auth", request_body = ChangePassword, responses((status = 200, body = Ok), (status = 403)))]
pub async fn change_password(
    State(state): State<AppState>,
    p: Principal,
    Json(req): Json<ChangePassword>,
) -> ApiResult<Json<Ok>> {
    if !password::verify(req.current_password, p.user.password_hash.clone()).await {
        return Err(ApiError::ForbiddenMsg(
            "current password is incorrect".into(),
        ));
    }
    password::validate(&req.new_password)?;
    let hash = password::hash(req.new_password).await?;
    tessery_db::users::set_password(&state.db, p.user.id, &hash).await?;
    let mut redis = state.redis.clone();
    session::destroy_all(&mut redis, p.user.id, Some(&p.token)).await?;
    audit::record(
        &state.db,
        &p,
        Entry::new(None, "auth.password_changed", "user", p.user.id),
    )
    .await?;
    Ok(Json(OK))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct PermissionsQuery {
    pub org: Uuid,
    pub team: Option<Uuid>,
    pub project: Option<Uuid>,
    pub env: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MyPermissions {
    pub permissions: Vec<String>,
    /// True when the caller is an instance administrator and may act beyond `permissions`.
    pub bypass: bool,
}

/// Effective permissions of the caller at a scope, so the UI can hide what the user cannot do.
#[utoipa::path(get, path = "/api/me/permissions", tag = "auth", params(PermissionsQuery), responses((status = 200, body = MyPermissions)))]
pub async fn my_permissions(
    State(state): State<AppState>,
    p: Principal,
    Query(q): Query<PermissionsQuery>,
) -> ApiResult<Json<MyPermissions>> {
    let org = OrgId(q.org);
    let target = match (q.project, q.team) {
        (Some(project), _) => {
            let t = rbac::project_target(&state, project).await?;
            if t.org() != org {
                return Err(ApiError::NotFound);
            }
            match (t, q.env) {
                (Target::Project { org, team, project }, Some(env)) => Target::Environment {
                    org,
                    team,
                    project,
                    env,
                },
                (t, _) => t,
            }
        }
        (None, Some(team)) => Target::Team {
            org,
            team: TeamId(team),
        },
        (None, None) => Target::Org(org),
    };
    let eff = rbac::effective(&state, p.user.id, &target).await?;
    Ok(Json(MyPermissions {
        permissions: eff.to_strings(),
        bypass: p.is_instance_admin(),
    }))
}
