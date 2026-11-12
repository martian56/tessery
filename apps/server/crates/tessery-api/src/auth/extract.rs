use crate::auth::session;
use crate::error::ApiError;
use crate::state::AppState;
use tessery_db::users::User;
use axum::extract::{ConnectInfo, FromRequestParts};
use axum::http::request::Parts;
use axum_extra::extract::CookieJar;
use std::net::SocketAddr;

#[derive(Debug, Clone, Default)]
pub struct RequestMeta {
    pub ip: Option<String>,
    pub user_agent: Option<String>,
}

impl FromRequestParts<AppState> for RequestMeta {
    type Rejection = std::convert::Infallible;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        let forwarded = state
            .config
            .trust_proxy
            .then(|| {
                parts
                    .headers
                    .get("x-forwarded-for")
                    .and_then(|v| v.to_str().ok())
                    .and_then(|v| v.split(',').next())
                    .map(|v| v.trim().to_owned())
            })
            .flatten();
        let ip = forwarded.or_else(|| {
            parts
                .extensions
                .get::<ConnectInfo<SocketAddr>>()
                .map(|c| c.0.ip().to_string())
        });
        let user_agent = parts
            .headers
            .get("user-agent")
            .and_then(|v| v.to_str().ok())
            .map(|v| v.chars().take(300).collect());
        Ok(Self { ip, user_agent })
    }
}

#[derive(Debug, Clone)]
pub struct TokenScope {
    pub id: uuid::Uuid,
    pub permissions: Option<Vec<tessery_core::Permission>>,
    pub project: Option<uuid::Uuid>,
}

#[derive(Debug, Clone)]
pub struct Principal {
    pub user: User,
    pub token: String,
    pub meta: RequestMeta,
    pub scope: Option<TokenScope>,
}

pub const TOKEN_PREFIX: &str = "tessery_";

pub fn token_hash(token: &str) -> Vec<u8> {
    use sha2::{Digest, Sha256};
    Sha256::digest(token.as_bytes()).to_vec()
}

fn bearer(parts: &Parts) -> Option<String> {
    let value = parts.headers.get(axum::http::header::AUTHORIZATION)?.to_str().ok()?;
    if let Some(t) = value.strip_prefix("Bearer ") {
        return Some(t.trim().to_owned());
    }
    let encoded = value.strip_prefix("Basic ")?;
    use base64::Engine;
    let decoded = String::from_utf8(base64::engine::general_purpose::STANDARD.decode(encoded.trim()).ok()?).ok()?;
    let (_, password) = decoded.split_once(':')?;
    Some(password.to_owned())
}

impl Principal {
    pub fn is_instance_admin(&self) -> bool {
        self.user.is_instance_admin && self.scope.as_ref().is_none_or(|s| s.permissions.is_none() && s.project.is_none())
    }

    pub fn require_instance_admin(&self) -> Result<(), ApiError> {
        if self.is_instance_admin() {
            Ok(())
        } else {
            Err(ApiError::ForbiddenMsg("instance administrator only".into()))
        }
    }
}

impl FromRequestParts<AppState> for Principal {
    type Rejection = ApiError;

    async fn from_request_parts(
        parts: &mut Parts,
        state: &AppState,
    ) -> Result<Self, Self::Rejection> {
        if let Some(raw) = bearer(parts) {
            return from_api_token(parts, state, &raw).await;
        }
        let jar = CookieJar::from_headers(&parts.headers);
        let token = jar
            .get(session::COOKIE)
            .map(|c| c.value().to_owned())
            .ok_or(ApiError::Unauthenticated)?;
        let mut redis = state.redis.clone();
        let user_id = session::resolve(&mut redis, &token, state.config.session_ttl)
            .await?
            .ok_or(ApiError::Unauthenticated)?;
        let user = match tessery_db::users::get(&state.db, user_id).await {
            Ok(u) => u,
            Err(tessery_db::DbError::NotFound) => return Err(ApiError::Unauthenticated),
            Err(e) => return Err(e.into()),
        };
        if user.disabled_at.is_some() {
            session::destroy(&mut redis, &token).await?;
            return Err(ApiError::Unauthenticated);
        }
        let meta = RequestMeta::from_request_parts(parts, state)
            .await
            .unwrap_or_default();
        Ok(Self { user, token, meta, scope: None })
    }
}

async fn from_api_token(parts: &mut Parts, state: &AppState, raw: &str) -> Result<Principal, ApiError> {
    if !raw.starts_with(TOKEN_PREFIX) {
        return Err(ApiError::Unauthenticated);
    }
    let token = match tessery_db::tokens::authenticate(&state.db, &token_hash(raw)).await {
        Ok(t) => t,
        Err(tessery_db::DbError::NotFound) => return Err(ApiError::Unauthenticated),
        Err(e) => return Err(e.into()),
    };
    let user = match tessery_db::users::get(&state.db, token.user_id).await {
        Ok(u) if u.disabled_at.is_none() => u,
        Ok(_) | Err(tessery_db::DbError::NotFound) => return Err(ApiError::Unauthenticated),
        Err(e) => return Err(e.into()),
    };
    let permissions = token.permissions.map(|ps| ps.iter().filter_map(|p| p.parse().ok()).collect());
    let meta = RequestMeta::from_request_parts(parts, state).await.unwrap_or_default();
    Ok(Principal { user, token: String::new(), meta, scope: Some(TokenScope { id: token.id, permissions, project: token.project_id }) })
}
