use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::{Deserialize, Serialize};
use std::time::Duration;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    /// The sender, such as `Tessery <tessery@example.com>`.
    pub from: String,
    /// `starttls` (port 587), `tls` (port 465) or `none` (only for a local relay).
    pub security: String,
}

pub async fn settings(state: &AppState) -> ApiResult<Option<(SmtpSettings, Option<String>)>> {
    let row = tessery_db::settings::smtp(&state.db).await?;
    let Some(raw) = row.smtp else { return Ok(None) };
    let settings: SmtpSettings = serde_json::from_value(raw).map_err(|e| ApiError::Internal(e.into()))?;
    let password = match (row.smtp_password, state.config.secret_key.as_ref()) {
        (Some(cipher), Some(key)) => Some(String::from_utf8(key.decrypt(&cipher).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?),
        _ => None,
    };
    Ok(Some((settings, password)))
}

pub fn transport(s: &SmtpSettings, password: Option<&str>) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let builder = match s.security.as_str() {
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&s.host).map_err(|e| e.to_string())?,
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.host).map_err(|e| e.to_string())?,
        _ => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&s.host),
    };
    let builder = builder.port(s.port).timeout(Some(Duration::from_secs(15)));
    let builder = if s.username.is_empty() { builder } else { builder.credentials(Credentials::new(s.username.clone(), password.unwrap_or_default().to_owned())) };
    Ok(builder.build())
}

pub async fn send_with(s: &SmtpSettings, password: Option<&str>, to: &str, subject: &str, body: &str) -> Result<(), String> {
    let message = Message::builder()
        .from(s.from.parse().map_err(|e| format!("the sender address is not valid: {e}"))?)
        .to(to.parse().map_err(|e| format!("{to} is not a valid address: {e}"))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_owned())
        .map_err(|e| e.to_string())?;
    transport(s, password)?.send(message).await.map(drop).map_err(|e| format!("the mail server refused the message: {e}"))
}

pub async fn send(state: &AppState, to: &str, subject: &str, body: &str) -> ApiResult<()> {
    let (s, password) = settings(state).await?.ok_or_else(|| ApiError::Conflict("email is not set up on this instance".into()))?;
    send_with(&s, password.as_deref(), to, subject, body).await.map_err(ApiError::Conflict)
}

pub fn base_url(state: &AppState, headers: &axum::http::HeaderMap) -> String {
    if let Ok(url) = std::env::var("TESSERY_PUBLIC_URL")
        && !url.trim().is_empty()
    {
        return url.trim().trim_end_matches('/').to_owned();
    }
    let header = |name: &str| headers.get(name).and_then(|v| v.to_str().ok()).map(str::to_owned);
    let host = (state.config.trust_proxy.then(|| header("x-forwarded-host")).flatten()).or_else(|| header("host")).unwrap_or_else(|| "localhost".into());
    let proto = state.config.trust_proxy.then(|| header("x-forwarded-proto")).flatten().unwrap_or_else(|| if state.config.cookie_secure { "https".into() } else { "http".into() });
    format!("{proto}://{host}")
}
