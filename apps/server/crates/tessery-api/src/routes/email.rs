use crate::audit::{self, Entry};
use crate::auth::{Principal, RequestMeta, password, rate_limit, session};
use crate::error::{ApiError, ApiResult};
use crate::mail::{self, SmtpSettings};
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Query, State};
use axum::http::HeaderMap;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use sha2::{Digest, Sha256};
use time::{Duration, OffsetDateTime};
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailSettingsDto {
    pub configured: bool,
    pub settings: Option<SmtpSettings>,
    pub has_password: bool,
}

#[utoipa::path(get, path = "/api/admin/email", tag = "admin", responses((status = 200, body = EmailSettingsDto)))]
pub async fn get_settings(State(state): State<AppState>, p: Principal) -> ApiResult<Json<EmailSettingsDto>> {
    p.require_instance_admin()?;
    let s = mail::settings(&state).await?;
    Ok(Json(EmailSettingsDto { configured: s.is_some(), has_password: s.as_ref().is_some_and(|(_, pw)| pw.is_some()), settings: s.map(|(s, _)| s) }))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EmailSettingsInput {
    /// Leave out to turn email off.
    pub settings: Option<SmtpSettings>,
    /// Leave out to keep the stored password.
    pub password: Option<String>,
}

#[utoipa::path(put, path = "/api/admin/email", tag = "admin", request_body = EmailSettingsInput, responses((status = 200, body = EmailSettingsDto)))]
pub async fn put_settings(State(state): State<AppState>, p: Principal, Json(req): Json<EmailSettingsInput>) -> ApiResult<Json<EmailSettingsDto>> {
    p.require_instance_admin()?;
    if let Some(s) = &req.settings {
        if s.host.trim().is_empty() || s.port == 0 {
            return Err(ApiError::invalid("settings", "host and port are required"));
        }
        if !["starttls", "tls", "none"].contains(&s.security.as_str()) {
            return Err(ApiError::invalid("security", "use starttls, tls or none"));
        }
        s.from.parse::<lettre::message::Mailbox>().map_err(|_| ApiError::invalid("from", "use an address like Tessery <tessery@example.com>"))?;
    }
    let cipher = match &req.password {
        Some(pw) if !pw.is_empty() => Some(state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY to store the SMTP password".into()))?.encrypt(pw.as_bytes())),
        _ => None,
    };
    let value = req.settings.as_ref().map(|s| serde_json::to_value(s).expect("settings serialize"));
    tessery_db::settings::set_smtp(&state.db, value.as_ref(), cipher.as_deref(), req.password.is_none() && req.settings.is_some()).await?;
    audit::record(&state.db, &p, Entry::new(None, "instance.email", "instance", p.user.id).details(json!({ "configured": req.settings.is_some(), "host": req.settings.as_ref().map(|s| s.host.clone()) }))).await?;
    get_settings(State(state), p).await
}

#[derive(Deserialize, ToSchema)]
pub struct TestEmail {
    pub to: String,
}

#[utoipa::path(post, path = "/api/admin/email/test", tag = "admin", request_body = TestEmail, responses((status = 200, body = Ok)))]
pub async fn test(State(state): State<AppState>, p: Principal, Json(req): Json<TestEmail>) -> ApiResult<Json<Ok>> {
    p.require_instance_admin()?;
    mail::send(&state, req.to.trim(), "Tessery test email", "Email from your Tessery instance works.\n\nPassword resets and invitations will be sent this way.\n").await?;
    Ok(Json(OK))
}

fn new_token() -> (String, Vec<u8>) {
    let mut b = [0u8; 32];
    rand::rng().fill_bytes(&mut b);
    let token = hex::encode(b);
    let hash = Sha256::digest(token.as_bytes()).to_vec();
    (token, hash)
}

pub async fn send_invite(state: &AppState, headers: &HeaderMap, user: Uuid, email: &str, org_name: &str, inviter: &str) -> ApiResult<()> {
    let (token, hash) = new_token();
    tessery_db::tokens_password::create(&state.db, &hash, user, "invite", OffsetDateTime::now_utc() + Duration::days(7)).await?;
    let link = format!("{}/reset-password?token={token}", mail::base_url(state, headers));
    let body = format!("{inviter} added you to {org_name} on Tessery.\n\nChoose a password to sign in:\n{link}\n\nThe link works once and expires in 7 days.\n");
    mail::send(state, email, &format!("You were added to {org_name} on Tessery"), &body).await
}

#[derive(Deserialize, ToSchema)]
pub struct ForgotInput {
    pub email: String,
}

/// Emails a link to choose a new password. Answers the same whether or not the address has an account.
#[utoipa::path(post, path = "/api/auth/password/forgot", tag = "auth", request_body = ForgotInput, responses((status = 200, body = Ok)))]
pub async fn forgot(State(state): State<AppState>, meta: RequestMeta, headers: HeaderMap, Json(req): Json<ForgotInput>) -> ApiResult<Json<Ok>> {
    let email = req.email.trim().to_lowercase();
    let mut redis = state.redis.clone();
    let ip_key = format!("forgot:ip:{}", meta.ip.as_deref().unwrap_or("unknown"));
    let email_key = format!("forgot:email:{email}");
    if !rate_limit::allow(&mut redis, &ip_key, 10, 900).await? || !rate_limit::allow(&mut redis, &email_key, 3, 900).await? {
        return Err(ApiError::RateLimited);
    }
    if mail::settings(&state).await?.is_none() {
        return Err(ApiError::Conflict("this instance cannot send email; ask an administrator to reset your password".into()));
    }
    if let Some(user) = tessery_db::users::find_by_email(&state.db, &email).await?
        && user.disabled_at.is_none()
    {
        let (token, hash) = new_token();
        tessery_db::tokens_password::create(&state.db, &hash, user.id, "reset", OffsetDateTime::now_utc() + Duration::hours(1)).await?;
        let link = format!("{}/reset-password?token={token}", mail::base_url(&state, &headers));
        let body = format!("Someone asked to reset the password for {email} on Tessery.\n\nChoose a new password:\n{link}\n\nThe link works once and expires in an hour. If you did not ask for this, ignore this email.\n");
        if let Err(e) = mail::send(&state, &email, "Reset your Tessery password", &body).await {
            tracing::warn!(error = ?e, "sending a password reset email failed");
        }
    }
    Ok(Json(OK))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct TokenQuery {
    pub token: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenInfo {
    /// `reset` or `invite`.
    pub purpose: String,
    pub email: String,
}

#[utoipa::path(get, path = "/api/auth/password/token", tag = "auth", params(TokenQuery), responses((status = 200, body = TokenInfo), (status = 404)))]
pub async fn token_info(State(state): State<AppState>, Query(q): Query<TokenQuery>) -> ApiResult<Json<TokenInfo>> {
    let hash = Sha256::digest(q.token.trim().as_bytes()).to_vec();
    let (user, purpose) = tessery_db::tokens_password::peek(&state.db, &hash).await?.ok_or(ApiError::NotFound)?;
    let user = tessery_db::users::get(&state.db, user).await?;
    Ok(Json(TokenInfo { purpose, email: user.email }))
}

#[derive(Deserialize, ToSchema)]
pub struct ResetInput {
    pub token: String,
    pub password: String,
}

#[utoipa::path(post, path = "/api/auth/password/reset", tag = "auth", request_body = ResetInput, responses((status = 200, body = Ok)))]
pub async fn reset(State(state): State<AppState>, meta: RequestMeta, Json(req): Json<ResetInput>) -> ApiResult<Json<Ok>> {
    let mut redis = state.redis.clone();
    if !rate_limit::allow(&mut redis, &format!("reset:ip:{}", meta.ip.as_deref().unwrap_or("unknown")), 20, 900).await? {
        return Err(ApiError::RateLimited);
    }
    password::validate(&req.password)?;
    let hash = Sha256::digest(req.token.trim().as_bytes()).to_vec();
    let user = tessery_db::tokens_password::consume(&state.db, &hash).await?.ok_or_else(|| ApiError::invalid("token", "this link was already used or has expired; ask for a new one"))?;
    let password_hash = password::hash(req.password).await?;
    tessery_db::users::set_password(&state.db, user, &password_hash).await?;
    session::destroy_all(&mut redis, user, None).await?;
    Ok(Json(OK))
}
