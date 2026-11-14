use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::delivery::env_target;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::json;
use tessery_core::Permission as P;
use tessery_db::metrics as db;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct RangeQuery {
    /// `1h`, `1d` or `1w`.
    pub range: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct PointDto {
    /// Milliseconds since the epoch, the start of the bucket.
    pub t: i64,
    /// Summed over the node's containers, so two busy replicas can pass 100.
    pub cpu: Option<f64>,
    pub memory_bytes: Option<f64>,
    pub memory_limit_bytes: Option<f64>,
    pub restarts: Option<i64>,
    /// False when any container was unhealthy or not running in the bucket.
    pub ok: Option<bool>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NodeSeriesDto {
    pub name: String,
    pub points: Vec<PointDto>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct MetricsDto {
    pub range: String,
    pub step_seconds: i64,
    pub nodes: Vec<NodeSeriesDto>,
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/metrics", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), RangeQuery), responses((status = 200, body = MetricsDto)))]
pub async fn series(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>, Query(q): Query<RangeQuery>) -> ApiResult<Json<MetricsDto>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &env_target(&target, &env), P::DeploymentRead).await?;
    let range = q.range.unwrap_or_else(|| "1h".into());
    let (span, step) = match range.as_str() {
        "1h" => (3600, 30),
        "1d" => (86_400, 300),
        "1w" => (604_800, 3600),
        _ => return Err(ApiError::invalid("range", "use 1h, 1d or 1w")),
    };
    let mut nodes: Vec<NodeSeriesDto> = Vec::new();
    for pt in db::series(&state.db, project, &env, span as f64, step as f64).await? {
        let point = PointDto { t: (pt.t.unix_timestamp_nanos() / 1_000_000) as i64, cpu: pt.cpu.map(|c| (c * 10.0).round() / 10.0), memory_bytes: pt.memory, memory_limit_bytes: pt.limit, restarts: pt.restarts, ok: pt.ok };
        match nodes.last_mut() {
            Some(n) if n.name == pt.node => n.points.push(point),
            _ => nodes.push(NodeSeriesDto { name: pt.node, points: vec![point] }),
        }
    }
    Ok(Json(MetricsDto { range, step_seconds: step, nodes }))
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AlertRuleDto {
    pub id: Uuid,
    /// Empty means every node.
    pub node: String,
    /// `cpu`, `memory`, `restarts` or `unhealthy`.
    pub metric: String,
    pub threshold: f64,
    pub minutes: i32,
    pub summary: String,
    /// Nodes this rule is firing for right now.
    pub firing: Vec<String>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub fired_at: Option<OffsetDateTime>,
}

impl From<db::Rule> for AlertRuleDto {
    fn from(r: db::Rule) -> Self {
        let summary = crate::metrics::describe(&r, if r.node.is_empty() { "any node" } else { &r.node });
        Self { id: r.id, node: r.node, metric: r.metric, threshold: r.threshold, minutes: r.minutes, summary, firing: r.firing_nodes, fired_at: r.fired_at }
    }
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/alerts", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 200, body = [AlertRuleDto])))]
pub async fn rules(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<Json<Vec<AlertRuleDto>>> {
    let target = rbac::project_target(&state, project).await?;
    rbac::require(&state, &p, &env_target(&target, &env), P::DeploymentRead).await?;
    Ok(Json(db::rules(&state.db, project, &env).await?.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize, ToSchema)]
pub struct NewRuleInput {
    #[serde(default)]
    pub node: String,
    pub metric: String,
    #[serde(default)]
    pub threshold: f64,
    pub minutes: i32,
}

#[utoipa::path(post, path = "/api/projects/{project}/environments/{env}/alerts", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path)), request_body = NewRuleInput, responses((status = 201, body = AlertRuleDto)))]
pub async fn add_rule(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>, Json(req): Json<NewRuleInput>) -> ApiResult<(StatusCode, Json<AlertRuleDto>)> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    let saved = tessery_db::projects::get(&state.db, project).await?;
    if !saved.doc["environments"].as_array().into_iter().flatten().any(|e| e["id"] == env.as_str()) {
        return Err(ApiError::invalid("env", "no such environment in the design"));
    }
    let node = req.node.trim();
    if !node.is_empty() && !saved.doc["nodes"].as_array().into_iter().flatten().any(|n| n["name"] == node) {
        return Err(ApiError::invalid("node", "no such node in the design"));
    }
    let threshold_ok = match req.metric.as_str() {
        "cpu" => req.threshold > 0.0 && req.threshold <= 6400.0,
        "memory" => req.threshold > 0.0 && req.threshold < 100.0,
        "restarts" => req.threshold >= 1.0 && req.threshold <= 1000.0,
        "unhealthy" => true,
        _ => return Err(ApiError::invalid("metric", "use cpu, memory, restarts or unhealthy")),
    };
    if !threshold_ok {
        return Err(ApiError::invalid("threshold", "cpu takes a percent above 0, memory a percent between 0 and 100, restarts a count of at least 1"));
    }
    if !(1..=1440).contains(&req.minutes) {
        return Err(ApiError::invalid("minutes", "use 1 to 1440"));
    }
    let r = db::add_rule(&state.db, project, &env, node, &req.metric, req.threshold, req.minutes).await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "alert.create", "project", project).decision(d).details(json!({ "env": env, "rule": r.id, "metric": r.metric }))).await?;
    Ok((StatusCode::CREATED, Json(r.into())))
}

#[utoipa::path(delete, path = "/api/projects/{project}/alerts/{rule}", tag = "runtime", params(("project" = Uuid, Path), ("rule" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete_rule(State(state): State<AppState>, p: Principal, Path((project, rule)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let target = rbac::project_target(&state, project).await?;
    let d = rbac::require(&state, &p, &target, P::ProjectEdit).await?;
    db::delete_rule(&state.db, project, rule).await?;
    audit::record(&state.db, &p, Entry::new(Some(target.org().0), "alert.delete", "project", project).decision(d).details(json!({ "rule": rule }))).await?;
    Ok(Json(OK))
}
