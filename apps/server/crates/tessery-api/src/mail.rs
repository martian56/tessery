use crate::error::{ApiError, ApiResult};
use crate::state::AppState;

pub use tessery_notify::SmtpSettings;

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

pub async fn send(state: &AppState, to: &str, subject: &str, body: &str) -> ApiResult<()> {
    let (s, password) = settings(state).await?.ok_or_else(|| ApiError::Conflict("email is not set up on this instance".into()))?;
    tessery_notify::send_email(&s, password.as_deref(), to, subject, body).await.map_err(ApiError::Conflict)
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
