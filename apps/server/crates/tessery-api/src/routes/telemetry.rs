use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::otlp;
use crate::rbac;
use crate::state::AppState;
use tessery_core::{Permission as P, Target};
use axum::Json;
use axum::body::Bytes;
use axum::extract::{Path, Query, State};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

fn plain(status: StatusCode, msg: &str) -> Response {
    (status, [(header::CONTENT_TYPE, "text/plain; charset=utf-8")], msg.to_owned()).into_response()
}

pub async fn ingest(State(state): State<AppState>, Path((project, env, signal)): Path<(Uuid, String, String)>, headers: HeaderMap, body: Bytes) -> Response {
    let Some(key) = state.config.secret_key.as_ref() else {
        return plain(StatusCode::SERVICE_UNAVAILABLE, "TESSERY_SECRET_KEY is not set, so telemetry is off");
    };
    let sent = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()).and_then(|v| v.strip_prefix("Bearer ")).unwrap_or_default();
    let accepted = tessery_core::runner::telemetry_tokens(key, project, &env);
    if !accepted.iter().any(|want| constant_time_eq(sent.as_bytes(), want.as_bytes())) {
        return plain(StatusCode::UNAUTHORIZED, "bad ingest token");
    }
    if signal != "traces" {
        return (StatusCode::OK, [(header::CONTENT_TYPE, "application/x-protobuf")]).into_response();
    }
    let ctype = headers.get(header::CONTENT_TYPE).and_then(|v| v.to_str().ok()).unwrap_or_default();
    if !ctype.starts_with("application/x-protobuf") || headers.contains_key(header::CONTENT_ENCODING) {
        return plain(StatusCode::UNSUPPORTED_MEDIA_TYPE, "send uncompressed OTLP protobuf (OTEL_EXPORTER_OTLP_PROTOCOL=http/protobuf)");
    }
    let spans = match otlp::decode(&body) {
        Ok(s) => s,
        Err(e) => return plain(StatusCode::BAD_REQUEST, &format!("not an OTLP trace export: {e}")),
    };
    if let Err(e) = tessery_db::telemetry::insert(&state.db, project, &env, &spans).await {
        tracing::warn!(error = %e, %project, env, "storing spans failed");
        return plain(StatusCode::SERVICE_UNAVAILABLE, "could not store spans");
    }
    match tessery_db::telemetry::retention_days(&state.db, project, &env).await {
        Ok(days) => {
            if let Err(e) = tessery_db::telemetry::prune(&state.db, project, &env, days).await {
                tracing::warn!(error = %e, %project, env, "removing old spans failed");
            }
        }
        Err(e) => tracing::warn!(error = %e, %project, env, "reading trace retention failed; old spans are removed on the next export"),
    }
    (StatusCode::OK, [(header::CONTENT_TYPE, "application/x-protobuf")]).into_response()
}

fn constant_time_eq(a: &[u8], b: &[u8]) -> bool {
    a.len() == b.len() && a.iter().zip(b).fold(0u8, |acc, (x, y)| acc | (x ^ y)) == 0
}

async fn guard(state: &AppState, p: &Principal, project: Uuid, env: &str) -> ApiResult<()> {
    let target = match rbac::project_target(state, project).await? {
        Target::Project { org, team, project } => Target::Environment { org, team, project, env: env.to_owned() },
        t => t,
    };
    rbac::require(state, p, &target, P::DeploymentRead).await?;
    Ok(())
}

#[derive(Deserialize, IntoParams)]
pub struct TracesQuery {
    /// Only traces that pass through this service.
    pub service: Option<String>,
    /// Only traces with a failed span.
    #[serde(default)]
    pub errors: bool,
    pub limit: Option<i64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TraceSummaryDto {
    pub trace_id: String,
    #[serde(with = "time::serde::rfc3339")]
    pub started_at: OffsetDateTime,
    pub duration_us: i64,
    pub spans: i64,
    pub error: bool,
    pub root_service: String,
    pub root_name: String,
    pub services: Vec<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SpanDto {
    pub span_id: String,
    pub parent_id: Option<String>,
    pub service: String,
    pub name: String,
    /// 1 internal, 2 server, 3 client, 4 producer, 5 consumer
    pub kind: i16,
    #[serde(with = "time::serde::rfc3339")]
    pub start_at: OffsetDateTime,
    pub duration_us: i64,
    pub error: bool,
    #[schema(value_type = Object)]
    pub attributes: Value,
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/traces", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), TracesQuery), responses((status = 200, body = Vec<TraceSummaryDto>)))]
pub async fn traces(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>, Query(q): Query<TracesQuery>) -> ApiResult<Json<Vec<TraceSummaryDto>>> {
    guard(&state, &p, project, &env).await?;
    let rows = tessery_db::telemetry::traces(&state.db, project, &env, q.service.as_deref().filter(|s| !s.is_empty()), q.errors, q.limit.unwrap_or(100).clamp(1, 500)).await?;
    Ok(Json(rows.into_iter().map(|t| TraceSummaryDto { trace_id: t.trace_id, started_at: t.started_at, duration_us: t.duration_us, spans: t.spans, error: t.error, root_service: t.root_service, root_name: t.root_name, services: t.services }).collect()))
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/traces/{trace}", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), ("trace" = String, Path)), responses((status = 200, body = Vec<SpanDto>)))]
pub async fn trace(State(state): State<AppState>, p: Principal, Path((project, env, trace)): Path<(Uuid, String, String)>) -> ApiResult<Json<Vec<SpanDto>>> {
    guard(&state, &p, project, &env).await?;
    let spans = tessery_db::telemetry::trace(&state.db, project, &env, &trace).await?;
    if spans.is_empty() {
        return Err(ApiError::NotFound);
    }
    Ok(Json(spans.into_iter().map(|s| SpanDto { span_id: s.span_id, parent_id: s.parent_id, service: s.service, name: s.name, kind: s.kind, start_at: s.start_at, duration_us: s.duration_us, error: s.error, attributes: s.attributes }).collect()))
}
