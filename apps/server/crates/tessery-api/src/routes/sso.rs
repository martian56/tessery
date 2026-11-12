use crate::audit::{self, Entry};
use crate::auth::{self, Principal, RequestMeta, session};
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Query, State};
use axum::response::{IntoResponse, Redirect, Response};
use axum_extra::extract::CookieJar;
use base64::Engine;
use rand::Rng;
use redis::AsyncCommands;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};
use utoipa::ToSchema;

#[derive(Debug, Clone)]
pub struct OidcConfig {
    pub issuer: String,
    pub client_id: String,
    pub client_secret: String,
    pub name: String,
    pub public_url: String,
    pub trust_email: bool,
}

impl OidcConfig {
    pub fn from_env() -> Option<Self> {
        let get = |k: &str| std::env::var(k).ok().filter(|v| !v.trim().is_empty());
        Some(Self {
            issuer: get("TESSERY_OIDC_ISSUER")?.trim_end_matches('/').to_owned(),
            client_id: get("TESSERY_OIDC_CLIENT_ID")?,
            client_secret: get("TESSERY_OIDC_CLIENT_SECRET").unwrap_or_default(),
            name: get("TESSERY_OIDC_NAME").unwrap_or_else(|| "single sign-on".into()),
            public_url: get("TESSERY_PUBLIC_URL")?.trim_end_matches('/').to_owned(),
            trust_email: get("TESSERY_OIDC_TRUST_EMAIL").is_some_and(|v| v == "true" || v == "1"),
        })
    }

    fn redirect_uri(&self) -> String {
        format!("{}/api/auth/sso/callback", self.public_url)
    }
}

#[derive(Serialize, ToSchema)]
pub struct SsoInfo {
    pub enabled: bool,
    pub name: Option<String>,
}

/// Whether the login page should offer single sign-on.
#[utoipa::path(get, path = "/api/auth/sso", tag = "auth", responses((status = 200, body = SsoInfo)))]
pub async fn info(State(state): State<AppState>) -> Json<SsoInfo> {
    Json(SsoInfo { enabled: state.config.oidc.is_some(), name: state.config.oidc.as_ref().map(|o| o.name.clone()) })
}

#[derive(Deserialize)]
struct Discovery {
    issuer: String,
    authorization_endpoint: String,
    token_endpoint: String,
    userinfo_endpoint: Option<String>,
}

fn http() -> reqwest::Client {
    reqwest::Client::builder().timeout(std::time::Duration::from_secs(10)).build().expect("static client config")
}

async fn discover(cfg: &OidcConfig) -> ApiResult<Discovery> {
    let url = format!("{}/.well-known/openid-configuration", cfg.issuer);
    let d: Discovery = http().get(&url).send().await.and_then(|r| r.error_for_status()).map_err(|e| ApiError::Internal(anyhow::anyhow!("OIDC discovery at {url}: {e}")))?.json().await.map_err(|e| ApiError::Internal(anyhow::anyhow!("OIDC discovery: {e}")))?;
    if d.issuer.trim_end_matches('/') != cfg.issuer {
        return Err(ApiError::Internal(anyhow::anyhow!("OIDC issuer mismatch: configured {}, provider says {}", cfg.issuer, d.issuer)));
    }
    Ok(d)
}

fn random(bytes: usize) -> String {
    let mut b = vec![0u8; bytes];
    rand::rng().fill_bytes(&mut b);
    base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b)
}

fn sso_config(state: &AppState) -> ApiResult<&OidcConfig> {
    state.config.oidc.as_ref().ok_or(ApiError::NotFound)
}

const STATE_COOKIE: &str = "tessery_sso_state";

fn state_cookie(state: &AppState, value: String, max_age: i64) -> axum_extra::extract::cookie::Cookie<'static> {
    axum_extra::extract::cookie::Cookie::build((STATE_COOKIE, value))
        .path("/api/auth/sso")
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(axum_extra::extract::cookie::SameSite::Lax)
        .max_age(time::Duration::seconds(max_age))
        .build()
}

pub async fn start(State(state): State<AppState>, jar: CookieJar) -> ApiResult<(CookieJar, Redirect)> {
    let cfg = sso_config(&state)?;
    let d = discover(cfg).await?;
    let (state_token, nonce, verifier) = (random(24), random(24), random(48));
    let challenge = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(Sha256::digest(verifier.as_bytes()));
    let mut redis = state.redis.clone();
    let _: () = redis.set_ex(format!("tessery:sso:{state_token}"), json!({ "nonce": nonce, "verifier": verifier }).to_string(), 600).await?;
    let mut url = reqwest::Url::parse(&d.authorization_endpoint).map_err(|e| ApiError::Internal(e.into()))?;
    url.query_pairs_mut()
        .append_pair("response_type", "code")
        .append_pair("client_id", &cfg.client_id)
        .append_pair("redirect_uri", &cfg.redirect_uri())
        .append_pair("scope", "openid email profile")
        .append_pair("state", &state_token)
        .append_pair("nonce", &nonce)
        .append_pair("code_challenge", &challenge)
        .append_pair("code_challenge_method", "S256");
    let jar = jar.add(state_cookie(&state, state_token, 600));
    Ok((jar, Redirect::to(url.as_str())))
}

#[derive(Deserialize)]
pub struct Callback {
    code: Option<String>,
    state: Option<String>,
    error: Option<String>,
    error_description: Option<String>,
}

fn back_to_login(message: &str) -> Response {
    let q: String = reqwest::Url::parse_with_params("http://x/", &[("sso_error", message)]).map(|u| u.query().unwrap_or("").to_owned()).unwrap_or_default();
    Redirect::to(&format!("/?{q}")).into_response()
}

pub async fn callback(State(state): State<AppState>, meta: RequestMeta, jar: CookieJar, Query(q): Query<Callback>) -> Response {
    let started_here = jar.get(STATE_COOKIE).map(|c| c.value().to_owned());
    let jar = jar.add(state_cookie(&state, String::new(), 0));
    if q.state.is_some() && q.state != started_here {
        return (jar, back_to_login("This sign-in was started in another browser. Try again.")).into_response();
    }
    match finish(&state, meta, q).await {
        Ok(token) => (jar.add(auth::session_cookie(&state, token)), Redirect::to("/")).into_response(),
        Err(SsoError::User(msg)) => (jar, back_to_login(&msg)).into_response(),
        Err(SsoError::Api(e)) => {
            tracing::error!(error = %e, "single sign-on failed");
            (jar, back_to_login("Single sign-on failed. Check the server log.")).into_response()
        }
    }
}

enum SsoError {
    User(String),
    Api(ApiError),
}

impl From<ApiError> for SsoError {
    fn from(e: ApiError) -> Self {
        Self::Api(e)
    }
}

impl From<tessery_db::DbError> for SsoError {
    fn from(e: tessery_db::DbError) -> Self {
        Self::Api(e.into())
    }
}

fn claims_of(id_token: &str) -> Option<Value> {
    let body = id_token.split('.').nth(1)?;
    serde_json::from_slice(&base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(body.trim_end_matches('=')).ok()?).ok()
}

async fn finish(state: &AppState, meta: RequestMeta, q: Callback) -> Result<String, SsoError> {
    let cfg = sso_config(state)?;
    if let Some(e) = q.error {
        return Err(SsoError::User(q.error_description.unwrap_or(e)));
    }
    let (Some(code), Some(state_token)) = (q.code, q.state) else { return Err(SsoError::User("The sign-in response was incomplete.".into())) };
    let mut redis = state.redis.clone();
    let saved: Option<String> = redis.get_del(format!("tessery:sso:{state_token}")).await.map_err(ApiError::from)?;
    let Some(saved) = saved.and_then(|s| serde_json::from_str::<Value>(&s).ok()) else { return Err(SsoError::User("The sign-in took too long or was started elsewhere. Try again.".into())) };

    let d = discover(cfg).await?;
    let mut form = vec![("grant_type", "authorization_code".to_owned()), ("code", code), ("redirect_uri", cfg.redirect_uri()), ("client_id", cfg.client_id.clone()), ("code_verifier", saved["verifier"].as_str().unwrap_or_default().to_owned())];
    if !cfg.client_secret.is_empty() {
        form.push(("client_secret", cfg.client_secret.clone()));
    }
    let body = reqwest::Url::parse_with_params("http://form/", &form).map_err(|e| ApiError::Internal(e.into()))?.query().unwrap_or("").to_owned();
    let tokens: Value = http().post(&d.token_endpoint).header("content-type", "application/x-www-form-urlencoded").body(body).send().await.map_err(|e| ApiError::Internal(e.into()))?.json().await.map_err(|e| ApiError::Internal(e.into()))?;
    let Some(id_token) = tokens["id_token"].as_str() else { return Err(SsoError::Api(ApiError::Internal(anyhow::anyhow!("token endpoint returned no id_token (error: {})", tokens["error"].as_str().unwrap_or("none"))))) };
    let claims = claims_of(id_token).ok_or_else(|| ApiError::Internal(anyhow::anyhow!("unreadable id_token")))?;

    let aud_ok = match &claims["aud"] {
        Value::String(a) => a == &cfg.client_id,
        Value::Array(a) => a.iter().any(|x| x.as_str() == Some(&cfg.client_id)),
        _ => false,
    };
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    if claims["iss"].as_str().map(|i| i.trim_end_matches('/')) != Some(cfg.issuer.as_str()) || !aud_ok || claims["exp"].as_i64().unwrap_or(0) < now || claims["nonce"] != saved["nonce"] {
        return Err(SsoError::Api(ApiError::Internal(anyhow::anyhow!("id_token failed validation (iss {:?}, aud {}, exp {:?})", claims["iss"].as_str(), claims["aud"], claims["exp"].as_i64()))));
    }
    let mut email = claims["email"].as_str().map(str::to_owned);
    let mut verified = claims["email_verified"].as_bool();
    let mut name = claims["name"].as_str().map(str::to_owned);
    if (email.is_none() || verified.is_none()) && let (Some(url), Some(access)) = (&d.userinfo_endpoint, tokens["access_token"].as_str()) {
        let info: Value = http().get(url).bearer_auth(access).send().await.map_err(|e| ApiError::Internal(e.into()))?.json().await.map_err(|e| ApiError::Internal(e.into()))?;
        email = email.or(info["email"].as_str().map(str::to_owned));
        verified = verified.or(info["email_verified"].as_bool());
        name = name.or(info["name"].as_str().map(str::to_owned));
    }
    let Some(email) = email.map(|e| e.trim().to_lowercase()) else { return Err(SsoError::User("Your identity provider did not share an email address.".into())) };
    if verified != Some(true) && !cfg.trust_email {
        return Err(SsoError::User("Your identity provider did not confirm that your email address is verified.".into()));
    }

    let user = match tessery_db::users::find_by_email(&state.db, &email).await? {
        Some(u) => u,
        None => {
            let display = name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| email.split('@').next().unwrap_or("user").to_owned());
            tessery_db::users::create(&state.db, &email, &display, None, false).await?
        }
    };
    if user.disabled_at.is_some() {
        return Err(SsoError::User("Your Tessery account is disabled.".into()));
    }
    let token = session::create(&mut redis, user.id, state.config.session_ttl).await.map_err(ApiError::from)?;
    tessery_db::users::touch_login(&state.db, user.id).await?;
    let actor = Principal { user: user.clone(), token: token.clone(), meta, scope: None };
    audit::record(&state.db, &actor, Entry::new(None, "auth.sso_login", "session", user.id).details(json!({ "issuer": cfg.issuer }))).await?;
    Ok(token)
}
