use crate::audit::{self, Entry};
use crate::auth::{Principal, RequestMeta, password, rate_limit};
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::routes::auth::start_session;
use crate::routes::dto::{OK, Ok, UserDto};
use crate::state::AppState;
use crate::totp;
use axum::Json;
use axum::extract::{Path, State};
use axum_extra::extract::CookieJar;
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tessery_core::Permission as P;
use tessery_db::two_factor as db;
use utoipa::ToSchema;
use uuid::Uuid;

const TICKET_TTL: u64 = 300;

fn key(state: &AppState) -> ApiResult<&tessery_core::SecretKey> {
    state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY to use two-factor sign-in".into()))
}

fn secret_of(state: &AppState, cipher: &[u8]) -> ApiResult<Vec<u8>> {
    key(state)?.decrypt(cipher).map_err(|e| ApiError::Internal(e.into()))
}

pub async fn new_ticket(state: &AppState, user: Uuid) -> ApiResult<String> {
    let mut b = [0u8; 24];
    rand::rng().fill_bytes(&mut b);
    let ticket = hex::encode(b);
    let mut redis = state.redis.clone();
    let _: () = redis.set_ex(format!("tessery:2fa:{ticket}"), user.to_string(), TICKET_TTL).await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(ticket)
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorChallenge {
    /// Send this with the code to `/api/auth/login/two-factor` within five minutes.
    pub two_factor_ticket: String,
}

#[derive(Deserialize, ToSchema)]
pub struct SecondStep {
    pub ticket: String,
    /// A six digit code from the authenticator app, or one of the recovery codes.
    pub code: String,
}

/// Finishes a sign-in for an account with two-factor on.
#[utoipa::path(post, path = "/api/auth/login/two-factor", tag = "auth", request_body = SecondStep, responses((status = 200, body = UserDto), (status = 422), (status = 429)))]
pub async fn login_second_step(State(state): State<AppState>, meta: RequestMeta, jar: CookieJar, Json(req): Json<SecondStep>) -> ApiResult<(CookieJar, Json<UserDto>)> {
    let mut redis = state.redis.clone();
    let ticket_key = format!("tessery:2fa:{}", req.ticket.trim());
    let ip_key = format!("2fa:ip:{}", meta.ip.as_deref().unwrap_or("unknown"));
    if !rate_limit::allow(&mut redis, &ip_key, 30, 900).await? || !rate_limit::allow(&mut redis, &format!("2fa:ticket:{}", req.ticket.trim()), 5, TICKET_TTL).await? {
        return Err(ApiError::RateLimited);
    }
    let user: Option<String> = redis.get(&ticket_key).await.map_err(|e| ApiError::Internal(e.into()))?;
    let user_id = user.and_then(|u| u.parse::<Uuid>().ok()).ok_or_else(|| ApiError::invalid("ticket", "the sign-in expired; enter your password again"))?;
    let user = tessery_db::users::get(&state.db, user_id).await?;
    if user.disabled_at.is_some() {
        return Err(ApiError::InvalidCredentials);
    }
    let state_row = db::state(&state.db, user.id).await?;
    let secret = state_row.secret.as_deref().filter(|_| state_row.enabled).ok_or(ApiError::InvalidCredentials)?;
    let secret = secret_of(&state, secret)?;
    let method = match totp::check(&secret, &req.code, totp::now_step()) {
        Some(step) if db::use_step(&state.db, user.id, step as i64).await? => "app",
        Some(_) => return Err(ApiError::invalid("code", "that code was already used; wait for the next one")),
        None if db::use_recovery_code(&state.db, user.id, &totp::hash_recovery(&req.code)).await? => "recovery code",
        None => {
            tessery_db::audit::insert(
                &state.db,
                tessery_db::audit::NewEvent {
                    actor_email: Some(user.email.clone()),
                    action: "auth.login_two_factor".into(),
                    resource_type: "session".into(),
                    result: Some(tessery_db::types::AuditResult::Denied),
                    ip: meta.ip.clone(),
                    user_agent: meta.user_agent.clone(),
                    details: json!({}),
                    ..Default::default()
                },
            )
            .await?;
            return Err(ApiError::invalid("code", "that code is not right"));
        }
    };
    let _: () = redis.del(&ticket_key).await.map_err(|e| ApiError::Internal(e.into()))?;
    start_session(&state, meta, jar, user, json!({ "twoFactor": method })).await
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorStatus {
    pub enabled: bool,
    pub recovery_codes_left: i64,
}

#[utoipa::path(get, path = "/api/auth/two-factor", tag = "auth", responses((status = 200, body = TwoFactorStatus)))]
pub async fn status(State(state): State<AppState>, p: Principal) -> ApiResult<Json<TwoFactorStatus>> {
    let s = db::state(&state.db, p.user.id).await?;
    Ok(Json(TwoFactorStatus { enabled: s.enabled, recovery_codes_left: if s.enabled { db::codes_left(&state.db, p.user.id).await? } else { 0 } }))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TwoFactorSetup {
    /// The secret in base32, for apps that cannot scan the code.
    pub secret: String,
    pub otpauth_url: String,
    /// An SVG image of the QR code.
    pub qr_svg: String,
}

/// Starts setting up an authenticator app. Nothing changes until `enable` confirms a code.
#[utoipa::path(post, path = "/api/auth/two-factor/setup", tag = "auth", responses((status = 200, body = TwoFactorSetup), (status = 409)))]
pub async fn setup(State(state): State<AppState>, p: Principal) -> ApiResult<Json<TwoFactorSetup>> {
    if p.scope.is_some() {
        return Err(ApiError::ForbiddenMsg("API tokens cannot change two-factor settings".into()));
    }
    if db::state(&state.db, p.user.id).await?.enabled {
        return Err(ApiError::Conflict("two-factor is already on; turn it off first to move to another app".into()));
    }
    let secret = totp::new_secret();
    db::set_pending(&state.db, p.user.id, &key(&state)?.encrypt(&secret)).await?;
    let url = totp::otpauth_url(&secret, &p.user.email, "Tessery");
    Ok(Json(TwoFactorSetup { secret: totp::encode(&secret), qr_svg: totp::qr_svg(&url), otpauth_url: url }))
}

#[derive(Deserialize, ToSchema)]
pub struct CodeInput {
    pub code: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct RecoveryCodes {
    /// Shown once. Each works one time in place of an app code.
    pub recovery_codes: Vec<String>,
}

#[utoipa::path(post, path = "/api/auth/two-factor/enable", tag = "auth", request_body = CodeInput, responses((status = 200, body = RecoveryCodes), (status = 422)))]
pub async fn enable(State(state): State<AppState>, p: Principal, Json(req): Json<CodeInput>) -> ApiResult<Json<RecoveryCodes>> {
    if p.scope.is_some() {
        return Err(ApiError::ForbiddenMsg("API tokens cannot change two-factor settings".into()));
    }
    let s = db::state(&state.db, p.user.id).await?;
    if s.enabled {
        return Err(ApiError::Conflict("two-factor is already on".into()));
    }
    let secret = secret_of(&state, s.secret.as_deref().ok_or_else(|| ApiError::Conflict("start the setup first".into()))?)?;
    let step = totp::check(&secret, &req.code, totp::now_step()).ok_or_else(|| ApiError::invalid("code", "that code is not right; check the time on your phone"))?;
    let codes = totp::recovery_codes();
    let hashes: Vec<Vec<u8>> = codes.iter().map(|c| totp::hash_recovery(c)).collect();
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    db::enable(&mut tx, p.user.id, step as i64, &hashes).await?;
    audit::record(&mut *tx, &p, Entry::new(None, "auth.two_factor_enabled", "user", p.user.id)).await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(RecoveryCodes { recovery_codes: codes }))
}

#[derive(Deserialize, ToSchema)]
pub struct PasswordInput {
    pub password: String,
}

#[utoipa::path(post, path = "/api/auth/two-factor/disable", tag = "auth", request_body = PasswordInput, responses((status = 200, body = Ok), (status = 403)))]
pub async fn disable(State(state): State<AppState>, p: Principal, Json(req): Json<PasswordInput>) -> ApiResult<Json<Ok>> {
    if p.scope.is_some() {
        return Err(ApiError::ForbiddenMsg("API tokens cannot change two-factor settings".into()));
    }
    if !password::verify(req.password, p.user.password_hash.clone()).await {
        return Err(ApiError::ForbiddenMsg("the password is incorrect".into()));
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    db::disable(&mut tx, p.user.id).await?;
    audit::record(&mut *tx, &p, Entry::new(None, "auth.two_factor_disabled", "user", p.user.id)).await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(OK))
}

#[utoipa::path(post, path = "/api/auth/two-factor/recovery-codes", tag = "auth", request_body = CodeInput, responses((status = 200, body = RecoveryCodes), (status = 422)))]
pub async fn new_codes(State(state): State<AppState>, p: Principal, Json(req): Json<CodeInput>) -> ApiResult<Json<RecoveryCodes>> {
    if p.scope.is_some() {
        return Err(ApiError::ForbiddenMsg("API tokens cannot change two-factor settings".into()));
    }
    let s = db::state(&state.db, p.user.id).await?;
    let secret = secret_of(&state, s.secret.as_deref().filter(|_| s.enabled).ok_or_else(|| ApiError::Conflict("two-factor is off".into()))?)?;
    let step = totp::check(&secret, &req.code, totp::now_step()).ok_or_else(|| ApiError::invalid("code", "that code is not right"))?;
    if !db::use_step(&state.db, p.user.id, step as i64).await? {
        return Err(ApiError::invalid("code", "that code was already used; wait for the next one"));
    }
    let codes = totp::recovery_codes();
    let hashes: Vec<Vec<u8>> = codes.iter().map(|c| totp::hash_recovery(c)).collect();
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    db::replace_codes(&mut tx, p.user.id, &hashes).await?;
    audit::record(&mut *tx, &p, Entry::new(None, "auth.recovery_codes_replaced", "user", p.user.id)).await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    Ok(Json(RecoveryCodes { recovery_codes: codes }))
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrgSecurity {
    pub require_two_factor: bool,
    /// Members who have not turned two-factor on. Filled in responses only.
    #[serde(default)]
    pub members_without: Vec<String>,
}

#[utoipa::path(get, path = "/api/orgs/{org}/security", tag = "orgs", params(("org" = Uuid, Path)), responses((status = 200, body = OrgSecurity)))]
pub async fn org_security(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>) -> ApiResult<Json<OrgSecurity>> {
    rbac::require(&state, &p, &org_target(org), P::MemberRead).await?;
    Ok(Json(OrgSecurity { require_two_factor: db::org_requires(&state.db, org).await?, members_without: db::members_without(&state.db, org).await? }))
}

#[utoipa::path(put, path = "/api/orgs/{org}/security", tag = "orgs", params(("org" = Uuid, Path)), request_body = OrgSecurity, responses((status = 200, body = OrgSecurity), (status = 409)))]
pub async fn put_org_security(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>, Json(req): Json<OrgSecurity>) -> ApiResult<Json<OrgSecurity>> {
    let d = rbac::require(&state, &p, &org_target(org), P::OrgManage).await?;
    if req.require_two_factor && p.user.two_factor_enabled_at.is_none() {
        return Err(ApiError::Conflict("turn on two-factor for your own account first, so you are not locked out".into()));
    }
    db::set_org_requires(&state.db, org, req.require_two_factor).await?;
    audit::record(&state.db, &p, Entry::new(Some(org), "org.security_update", "org", org).decision(d).details(json!({ "requireTwoFactor": req.require_two_factor }))).await?;
    org_security(State(state), p, Path(org)).await
}

/// Turns off a member's second factor so they can set it up again, for example after losing their phone.
#[utoipa::path(delete, path = "/api/orgs/{org}/members/{user}/two-factor", tag = "members", params(("org" = Uuid, Path), ("user" = Uuid, Path)), responses((status = 200, body = Ok), (status = 404)))]
pub async fn reset_member(State(state): State<AppState>, p: Principal, Path((org, user)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::OrgManage).await?;
    if !db::is_member(&state.db, org, user).await? {
        return Err(ApiError::NotFound);
    }
    let target = tessery_db::users::get(&state.db, user).await?;
    if target.is_instance_admin && !p.user.is_instance_admin {
        return Err(ApiError::ForbiddenMsg("only an instance administrator can reset another administrator".into()));
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    db::disable(&mut tx, user).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "member.two_factor_reset", "user", user).decision(d).details(json!({ "email": target.email }))).await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    let mut redis = state.redis.clone();
    crate::auth::session::destroy_all(&mut redis, user, None).await?;
    Ok(Json(OK))
}
