pub mod extract;
pub mod password;
pub mod rate_limit;
pub mod session;

pub use extract::{Principal, RequestMeta, TOKEN_PREFIX, TokenScope, token_hash};

use crate::state::AppState;
use axum_extra::extract::cookie::{Cookie, SameSite};

pub fn session_cookie(state: &AppState, token: String) -> Cookie<'static> {
    Cookie::build((session::COOKIE, token))
        .path("/")
        .http_only(true)
        .secure(state.config.cookie_secure)
        .same_site(SameSite::Lax)
        .max_age(time::Duration::seconds(
            state.config.session_ttl.as_secs() as i64
        ))
        .build()
}

pub fn clear_cookie() -> Cookie<'static> {
    Cookie::build((session::COOKIE, ""))
        .path("/")
        .max_age(time::Duration::ZERO)
        .build()
}
