pub mod audit;
pub mod auth;
pub mod config;
pub mod error;
pub mod openapi;
pub mod otlp;
pub mod rbac;
pub mod routes;
pub mod runtime;
pub mod state;

use crate::error::ApiError;
use crate::state::AppState;
use axum::Router;
use axum::extract::Request;
use axum::http::{HeaderName, Method};
use axum::middleware::{self, Next};
use axum::response::{IntoResponse, Response};
use std::time::Duration;
use tower::ServiceBuilder;
use tower_http::LatencyUnit;
use tower_http::limit::RequestBodyLimitLayer;
use tower_http::request_id::{MakeRequestUuid, PropagateRequestIdLayer, SetRequestIdLayer};
use tower_http::services::{ServeDir, ServeFile};
use tower_http::timeout::TimeoutLayer;
use tower_http::trace::{DefaultMakeSpan, DefaultOnResponse, TraceLayer};

pub const CSRF_HEADER: &str = "x-tessery-csrf";

async fn csrf_guard(req: Request, next: Next) -> Response {
    let safe = matches!(*req.method(), Method::GET | Method::HEAD | Method::OPTIONS);
    let token = req.headers().contains_key(axum::http::header::AUTHORIZATION);
    let mcp = req.uri().path().ends_with("/mcp");
    if safe || token || mcp || req.headers().contains_key(CSRF_HEADER) {
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
    let mut router = Router::new().nest("/api", api).nest("/git", git);
    if let Some(dir) = state.config.web_dir.clone() {
        router = router
            .fallback_service(ServeDir::new(&dir).fallback(ServeFile::new(dir.join("index.html"))));
    }
    router.with_state(state).layer(
        ServiceBuilder::new()
            .layer(SetRequestIdLayer::new(request_id.clone(), MakeRequestUuid))
            .layer(
                TraceLayer::new_for_http()
                    .make_span_with(DefaultMakeSpan::new().include_headers(false))
                    .on_response(DefaultOnResponse::new().latency_unit(LatencyUnit::Millis)),
            )
            .layer(PropagateRequestIdLayer::new(request_id)),
    )
}
