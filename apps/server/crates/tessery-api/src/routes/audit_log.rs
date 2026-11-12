use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::state::AppState;
use tessery_core::Permission as P;
use tessery_db::audit::{Event, Filter};
use tessery_db::types::{AuditResult, ExportStatus};
use tessery_mq::Job;
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::{StatusCode, header};
use axum::response::IntoResponse;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
pub struct AuditQuery {
    /// Substring of the actor's email.
    pub actor: Option<String>,
    /// Action prefix, e.g. `project.` or `access.grant`.
    pub action: Option<String>,
    pub result: Option<AuditResult>,
    /// RFC 3339 timestamp.
    pub since: Option<String>,
    pub until: Option<String>,
    /// Return events older than this id (cursor from the previous page).
    pub before: Option<i64>,
    pub limit: Option<i64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditEventDto {
    pub id: i64,
    #[serde(with = "time::serde::rfc3339")]
    pub at: OffsetDateTime,
    pub actor_id: Option<Uuid>,
    pub actor_email: Option<String>,
    pub action: String,
    pub resource_type: String,
    pub resource_id: Option<String>,
    pub result: AuditResult,
    pub ip: Option<String>,
    pub user_agent: Option<String>,
    #[schema(value_type = Object)]
    pub details: serde_json::Value,
}

impl From<Event> for AuditEventDto {
    fn from(e: Event) -> Self {
        Self {
            id: e.id,
            at: e.at,
            actor_id: e.actor_id,
            actor_email: e.actor_email,
            action: e.action,
            resource_type: e.resource_type,
            resource_id: e.resource_id,
            result: e.result,
            ip: e.ip,
            user_agent: e.user_agent,
            details: e.details,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct AuditPage {
    pub events: Vec<AuditEventDto>,
    pub next_cursor: Option<i64>,
}

fn parse_time(field: &'static str, v: Option<&str>) -> ApiResult<Option<OffsetDateTime>> {
    v.filter(|s| !s.is_empty())
        .map(|s| {
            OffsetDateTime::parse(s, &time::format_description::well_known::Rfc3339)
                .map_err(|_| ApiError::invalid(field, "must be an RFC 3339 timestamp"))
        })
        .transpose()
}

fn filter_from(q: &AuditQuery) -> ApiResult<Filter> {
    Ok(Filter {
        actor: q.actor.clone().filter(|s| !s.is_empty()),
        action: q.action.clone().filter(|s| !s.is_empty()),
        result: q.result,
        since: parse_time("since", q.since.as_deref())?,
        until: parse_time("until", q.until.as_deref())?,
    })
}

#[utoipa::path(get, path = "/api/orgs/{org}/audit", tag = "audit", params(("org" = Uuid, Path), AuditQuery), responses((status = 200, body = AuditPage)))]
pub async fn list(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Query(q): Query<AuditQuery>,
) -> ApiResult<Json<AuditPage>> {
    rbac::require(&state, &p, &org_target(org), P::AuditRead).await?;
    let limit = q.limit.unwrap_or(100).clamp(1, 500);
    let events = tessery_db::audit::list(&state.db, org, &filter_from(&q)?, q.before, limit).await?;
    let next_cursor = if events.len() as i64 == limit {
        events.last().map(|e| e.id)
    } else {
        None
    };
    Ok(Json(AuditPage {
        events: events.into_iter().map(Into::into).collect(),
        next_cursor,
    }))
}

#[derive(Deserialize, ToSchema)]
pub struct ExportRequest {
    /// `json` or `csv`.
    pub format: String,
    #[serde(default)]
    pub actor: Option<String>,
    #[serde(default)]
    pub action: Option<String>,
    #[serde(default)]
    pub result: Option<AuditResult>,
    #[serde(default)]
    pub since: Option<String>,
    #[serde(default)]
    pub until: Option<String>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ExportDto {
    pub id: Uuid,
    pub format: String,
    pub status: ExportStatus,
    pub row_count: Option<i32>,
    pub error: Option<String>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub finished_at: Option<OffsetDateTime>,
}

impl From<tessery_db::audit::Export> for ExportDto {
    fn from(e: tessery_db::audit::Export) -> Self {
        Self {
            id: e.id,
            format: e.format,
            status: e.status,
            row_count: e.row_count,
            error: e.error,
            created_at: e.created_at,
            finished_at: e.finished_at,
        }
    }
}

/// Queues an export. The worker produces the file; poll the export until `status` is `done`.
#[utoipa::path(post, path = "/api/orgs/{org}/audit/exports", tag = "audit", params(("org" = Uuid, Path)), request_body = ExportRequest, responses((status = 202, body = ExportDto)))]
pub async fn create_export(
    State(state): State<AppState>,
    p: Principal,
    Path(org): Path<Uuid>,
    Json(req): Json<ExportRequest>,
) -> ApiResult<(StatusCode, Json<ExportDto>)> {
    let d = rbac::require(&state, &p, &org_target(org), P::AuditRead).await?;
    if !matches!(req.format.as_str(), "json" | "csv") {
        return Err(ApiError::invalid("format", "must be json or csv"));
    }
    let filter = filter_from(&AuditQuery {
        actor: req.actor,
        action: req.action,
        result: req.result,
        since: req.since,
        until: req.until,
        before: None,
        limit: None,
    })?;
    let export = tessery_db::audit::create_export(
        &state.db,
        org,
        p.user.id,
        &req.format,
        &serde_json::to_value(&filter).map_err(anyhow::Error::from)?,
    )
    .await?;
    state
        .mq
        .publish(Job::AuditExport {
            export_id: export.id,
        })
        .await?;
    audit::record(
        &state.db,
        &p,
        Entry::new(Some(org), "audit.export", "audit_export", export.id)
            .decision(d)
            .details(json!({ "format": export.format })),
    )
    .await?;
    Ok((StatusCode::ACCEPTED, Json(export.into())))
}

#[utoipa::path(get, path = "/api/orgs/{org}/audit/exports/{export}", tag = "audit", params(("org" = Uuid, Path), ("export" = Uuid, Path)), responses((status = 200, body = ExportDto)))]
pub async fn get_export(
    State(state): State<AppState>,
    p: Principal,
    Path((org, export)): Path<(Uuid, Uuid)>,
) -> ApiResult<Json<ExportDto>> {
    rbac::require(&state, &p, &org_target(org), P::AuditRead).await?;
    Ok(Json(
        tessery_db::audit::get_export(&state.db, org, export)
            .await?
            .into(),
    ))
}

#[utoipa::path(get, path = "/api/orgs/{org}/audit/exports/{export}/download", tag = "audit", params(("org" = Uuid, Path), ("export" = Uuid, Path)), responses((status = 200, description = "The export file")))]
pub async fn download_export(
    State(state): State<AppState>,
    p: Principal,
    Path((org, export)): Path<(Uuid, Uuid)>,
) -> ApiResult<impl IntoResponse> {
    rbac::require(&state, &p, &org_target(org), P::AuditRead).await?;
    let e = tessery_db::audit::get_export(&state.db, org, export).await?;
    let content = tessery_db::audit::export_content(&state.db, org, export)
        .await?
        .ok_or_else(|| ApiError::Conflict("the export is not ready yet".into()))?;
    let (mime, ext) = if e.format == "csv" {
        ("text/csv; charset=utf-8", "csv")
    } else {
        ("application/json", "json")
    };
    Ok((
        [
            (header::CONTENT_TYPE, mime.to_owned()),
            (
                header::CONTENT_DISPOSITION,
                format!("attachment; filename=\"audit-{export}.{ext}\""),
            ),
        ],
        content,
    ))
}
