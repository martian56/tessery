use crate::error::DbResult;
use serde_json::Value;
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Span {
    pub trace_id: String,
    pub span_id: String,
    pub parent_id: Option<String>,
    pub service: String,
    pub name: String,
    pub kind: i16,
    pub start_at: OffsetDateTime,
    pub duration_us: i64,
    pub error: bool,
    pub attributes: Value,
}

#[derive(Debug, Clone)]
pub struct TraceSummary {
    pub trace_id: String,
    pub started_at: OffsetDateTime,
    pub duration_us: i64,
    pub spans: i64,
    pub error: bool,
    pub root_service: String,
    pub root_name: String,
    pub services: Vec<String>,
}

pub async fn insert(ex: impl PgExecutor<'_> + Copy, project: Uuid, env: &str, spans: &[Span]) -> DbResult<u64> {
    if spans.is_empty() {
        return Ok(0);
    }
    let col = |f: fn(&Span) -> String| spans.iter().map(f).collect::<Vec<_>>();
    let parents: Vec<Option<String>> = spans.iter().map(|s| s.parent_id.clone()).collect();
    let kinds: Vec<i16> = spans.iter().map(|s| s.kind).collect();
    let starts: Vec<OffsetDateTime> = spans.iter().map(|s| s.start_at).collect();
    let durations: Vec<i64> = spans.iter().map(|s| s.duration_us).collect();
    let errors: Vec<bool> = spans.iter().map(|s| s.error).collect();
    let attributes: Vec<Value> = spans.iter().map(|s| s.attributes.clone()).collect();
    let n = sqlx::query!(
        r#"INSERT INTO spans (project_id, env_key, trace_id, span_id, parent_id, service, name, kind, start_at, duration_us, error, attributes)
           SELECT $1, $2, * FROM UNNEST($3::text[], $4::text[], $5::text[], $6::text[], $7::text[], $8::int2[], $9::timestamptz[], $10::int8[], $11::bool[], $12::jsonb[])
           ON CONFLICT DO NOTHING"#,
        project,
        env,
        &col(|s| s.trace_id.clone()),
        &col(|s| s.span_id.clone()),
        &parents as &[Option<String>],
        &col(|s| s.service.clone()),
        &col(|s| s.name.clone()),
        &kinds,
        &starts,
        &durations,
        &errors,
        &attributes,
    )
    .execute(ex)
    .await?
    .rows_affected();
    Ok(n)
}

/// How long an environment keeps its spans: its traceRetentionDays setting, from 1 to 90 days, or 3 when unset.
pub async fn retention_days(ex: impl PgExecutor<'_>, project: Uuid, env: &str) -> DbResult<i32> {
    let days = sqlx::query_scalar!(
        r#"SELECT CASE WHEN jsonb_typeof(e -> 'traceRetentionDays') = 'number' THEN (e ->> 'traceRetentionDays')::numeric::int END AS days
           FROM projects p, jsonb_array_elements(p.doc -> 'environments') e
           WHERE p.id = $1 AND e ->> 'id' = $2"#,
        project,
        env
    )
    .fetch_optional(ex)
    .await?
    .flatten();
    Ok(days.unwrap_or(DEFAULT_RETENTION_DAYS).clamp(1, 90))
}

pub const DEFAULT_RETENTION_DAYS: i32 = 3;

/// Deletes an environment's spans that started more than `days` days ago.
pub async fn prune(ex: impl PgExecutor<'_>, project: Uuid, env: &str, days: i32) -> DbResult<u64> {
    Ok(sqlx::query!("DELETE FROM spans WHERE project_id = $1 AND env_key = $2 AND start_at < now() - make_interval(days => $3)", project, env, days)
        .execute(ex)
        .await?
        .rows_affected())
}

pub async fn traces(ex: impl PgExecutor<'_>, project: Uuid, env: &str, service: Option<&str>, errors_only: bool, limit: i64) -> DbResult<Vec<TraceSummary>> {
    Ok(sqlx::query_as!(
        TraceSummary,
        r#"WITH recent AS (
               SELECT trace_id FROM spans
               WHERE project_id = $1 AND env_key = $2 AND ($3::text IS NULL OR service = $3) AND (NOT $4 OR error)
               GROUP BY trace_id ORDER BY max(start_at) DESC LIMIT $5
           )
           SELECT s.trace_id AS "trace_id!",
                  min(s.start_at) AS "started_at!",
                  (extract(epoch FROM max(s.start_at + s.duration_us * interval '1 microsecond') - min(s.start_at)) * 1000000)::int8 AS "duration_us!",
                  count(*) AS "spans!",
                  bool_or(s.error) AS "error!",
                  (array_agg(s.service ORDER BY s.parent_id IS NOT NULL, s.start_at))[1] AS "root_service!",
                  (array_agg(s.name ORDER BY s.parent_id IS NOT NULL, s.start_at))[1] AS "root_name!",
                  array_agg(DISTINCT s.service) AS "services!"
           FROM spans s JOIN recent r USING (trace_id)
           WHERE s.project_id = $1 AND s.env_key = $2
           GROUP BY s.trace_id
           ORDER BY min(s.start_at) DESC"#,
        project,
        env,
        service,
        errors_only,
        limit
    )
    .fetch_all(ex)
    .await?)
}

pub async fn trace(ex: impl PgExecutor<'_>, project: Uuid, env: &str, trace_id: &str) -> DbResult<Vec<Span>> {
    Ok(sqlx::query_as!(
        Span,
        "SELECT trace_id, span_id, parent_id, service, name, kind, start_at, duration_us, error, attributes
         FROM spans WHERE project_id = $1 AND env_key = $2 AND trace_id = $3 ORDER BY start_at LIMIT 2000",
        project,
        env,
        trace_id
    )
    .fetch_all(ex)
    .await?)
}
