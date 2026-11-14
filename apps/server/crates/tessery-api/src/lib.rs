pub mod audit;
pub mod auth;
pub mod config;
pub mod error;
pub mod mail;
pub mod metrics;
pub mod openapi;
pub mod otlp;
pub mod rbac;
pub mod rotate;
pub mod routes;
pub mod runtime;
pub mod state;
pub mod totp;

use crate::error::ApiError;
use crate::state::AppState;
use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderName, HeaderValue, Method, header};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::LatencyUnit;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::set_header::SetResponseHeaderLayer;
use tower_http::services::{ServeDir, ServeFile};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};

pub const CSRF_HEADER: &str = "x-tessery-csrf";

async fn csrf_guard(req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let token = req.headers().contains_key(axum::http::header::AUTHORIZATION);
    let mcp = req.uri().path().ends_with("/mcp");
    let signed_webhook = req.uri().path().ends_with("/github/webhook") && req.headers().contains_key("x-hub-signature-256");
    if safe || token || mcp || signed_webhook || req.headers().contains_key(CSRF_HEADER) {
        next.run(req).await
    } else {
        ApiError::ForbiddenMsg(format!("missing {CSRF_HEADER} header")).into_response()
    }
}

pub async fn connect(config: config::Config) -> anyhow::Result<AppState> {
    use anyhow::Context;
    let db = tessery_db::connect(&config.database_url, config.db_max_connections)
        .await
        .context("connecting to Postgres")?;
    tessery_db::migrate(&db).await.context("running migrations")?;
    let redis_config = redis::aio::ConnectionManagerConfig::new()
        .set_response_timeout(Some(std::time::Duration::from_secs(5)))
        .set_connection_timeout(Some(std::time::Duration::from_secs(5)));
    let redis = redis::Client::open(config.redis_url.as_str())?
        .get_connection_manager_with_config(redis_config)
        .await
        .context("connecting to Redis")?;
    let mq = tessery_mq::Mq::connect(&config.amqp_url, "tessery-server")
        .await
        .context("connecting to RabbitMQ")?;
    Ok(AppState {
        db,
        redis,
        mq,
        repos: tessery_git::Repos::new(&config.data_dir),
        engine: tessery_engine::Engine::new(config.engine.clone()).context("starting the Tessery engine")?,
        config: std::sync::Arc::new(config),
    })
}

/// For sandbox.html, the page builder's preview of hand-written components. Their code is evaluated there, so the page
/// runs in an iframe sandboxed without same-origin access, and only Tessery may frame it.
const SANDBOX_CSP: &str = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src https: data: blob:; connect-src https:; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";
const CSP: &str = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; img-src 'self' data: blob: https:; media-src 'self' https:; font-src 'self' data: https://fonts.gstatic.com; frame-src 'self' https:; connect-src 'self'; worker-src 'self' blob:; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'";

pub fn app(state: AppState) -> Router {
    let request_id = HeaderName::from_static("x-request-id");
    let api = routes::api()
        .route_layer(middleware::from_fn(csrf_guard))
        .fallback(|| async { error::ApiError::NotFound })
        .layer(
            ServiceBuilder::new()
                .layer(TimeoutLayer::with_status_code(axum::http::StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(30)))
                .layer(RequestBodyLimitLayer::new(8 * 1024 * 1024)),
        );
    let git = Router::new()
        .route("/{repo}/{*rest}", axum::routing::any(routes::git::serve))
        .layer(
            ServiceBuilder::new()
                .layer(axum::extract::DefaultBodyLimit::disable())
                .layer(TimeoutLayer::with_status_code(axum::http::StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(900)))
                .layer(RequestBodyLimitLayer::new(256 * 1024 * 1024)),
        );
    let uploads = Router::new()
        .route("/api/projects/{project}/assets/upload", axum::routing::post(routes::assets::upload))
        .route_layer(middleware::from_fn(csrf_guard))
        .layer(
            ServiceBuilder::new()
                .layer(axum::extract::DefaultBodyLimit::max(routes::assets::MAX_BYTES))
                .layer(TimeoutLayer::with_status_code(axum::http::StatusCode::GATEWAY_TIMEOUT, Duration::from_secs(120)))
                .layer(RequestBodyLimitLayer::new(routes::assets::MAX_BYTES)),
        );
    let mut router = Router::new().merge(uploads).nest("/api", api).nest("/git", git);
    if let Some(dir) = state.config.web_dir.clone() {
        // The page is revalidated on every load, so after an update it names the new build's files.
        let cache = |res: &axum::http::Response<_>| {
            let html = res.headers().get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).is_some_and(|v| v.starts_with("text/html"));
            html.then(|| HeaderValue::from_static("no-cache"))
        };
        // The component preview runs code people write, in an iframe sandboxed without allow-same-origin. Its own policy
        // allows evaluating that code and loading theme fonts, and lets only Tessery frame it.
        let sandbox = ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::overriding(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(SANDBOX_CSP)))
            .layer(SetResponseHeaderLayer::overriding(header::X_FRAME_OPTIONS, HeaderValue::from_static("SAMEORIGIN")))
            .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-cache")))
            .service(ServeFile::new(dir.join("sandbox.html")));
        router = router.route_service("/sandbox.html", sandbox);
        // Its script has a fixed name, so it is revalidated like the page.
        let script = ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, HeaderValue::from_static("no-cache")))
            .service(ServeFile::new(dir.join("sandbox.js")));
        router = router.route_service("/sandbox.js", script);
        router = router.fallback_service(
            ServiceBuilder::new()
                .layer(SetResponseHeaderLayer::overriding(header::CACHE_CONTROL, cache))
                .service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html")))),
        );
    }
    let hsts = state.config.cookie_secure.then(|| HeaderValue::from_static("max-age=31536000; includeSubDomains"));
    router.with_state(state).layer(
        ServiceBuilder::new()
            .layer(SetResponseHeaderLayer::if_not_present(header::CONTENT_SECURITY_POLICY, HeaderValue::from_static(CSP)))
            .layer(SetResponseHeaderLayer::if_not_present(header::X_CONTENT_TYPE_OPTIONS, HeaderValue::from_static("nosniff")))
            .layer(SetResponseHeaderLayer::if_not_present(header::X_FRAME_OPTIONS, HeaderValue::from_static("DENY")))
            .layer(SetResponseHeaderLayer::if_not_present(header::REFERRER_POLICY, HeaderValue::from_static("strict-origin-when-cross-origin")))
            .layer(SetResponseHeaderLayer::if_not_present(HeaderName::from_static("permissions-policy"), HeaderValue::from_static("camera=(), microphone=(), geolocation=(), payment=()")))
            .layer(SetResponseHeaderLayer::if_not_present(header::STRICT_TRANSPORT_SECURITY, move |_: &axum::http::Response<_>| hsts.clone()))
            .layer(SetRequestIdLayer::new(request_id.clone(), MakeRequestUuid))
            .layer(
                TraceLayer::new_for_http()
                    .make_span_with(DefaultMakeSpan::new().include_headers(false))
                    .on_response(DefaultOnResponse::new().latency_unit(LatencyUnit::Millis)),
            )
            .layer(PropagateRequestIdLayer::new(request_id)),
    )
}
