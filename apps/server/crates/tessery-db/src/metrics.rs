use crate::error::{DbError, DbResult};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Sample {
    pub node: String,
    pub instance: String,
    pub at: OffsetDateTime,
    pub state: String,
    pub healthy: Option<bool>,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<i64>,
    pub memory_limit_bytes: Option<i64>,
    pub restarts: Option<i64>,
}

pub async fn deployed(ex: impl PgExecutor<'_>) -> DbResult<Vec<(Uuid, String)>> {
    Ok(sqlx::query!("SELECT project_id, env_key FROM environment_heads ORDER BY project_id, env_key").fetch_all(ex).await?.into_iter().map(|r| (r.project_id, r.env_key)).collect())
}

pub async fn insert(ex: impl PgExecutor<'_>, project: Uuid, env: &str, samples: &[Sample]) -> DbResult<()> {
    if samples.is_empty() {
        return Ok(());
    }
    let nodes: Vec<String> = samples.iter().map(|s| s.node.clone()).collect();
    let instances: Vec<String> = samples.iter().map(|s| s.instance.clone()).collect();
    let ats: Vec<OffsetDateTime> = samples.iter().map(|s| s.at).collect();
    let states: Vec<String> = samples.iter().map(|s| s.state.clone()).collect();
    let healthy: Vec<Option<bool>> = samples.iter().map(|s| s.healthy).collect();
    let cpu: Vec<Option<f64>> = samples.iter().map(|s| s.cpu_percent).collect();
    let mem: Vec<Option<i64>> = samples.iter().map(|s| s.memory_bytes).collect();
    let lim: Vec<Option<i64>> = samples.iter().map(|s| s.memory_limit_bytes).collect();
    let restarts: Vec<Option<i64>> = samples.iter().map(|s| s.restarts).collect();
    sqlx::query!(
        r#"INSERT INTO metric_samples (project_id, env_key, node, instance, at, state, healthy, cpu_percent, memory_bytes, memory_limit_bytes, restarts)
           SELECT $1, $2, * FROM UNNEST($3::text[], $4::text[], $5::timestamptz[], $6::text[], $7::bool[], $8::float8[], $9::int8[], $10::int8[], $11::int8[])"#,
        project,
        env,
        &nodes,
        &instances,
        &ats,
        &states,
        &healthy as &[Option<bool>],
        &cpu as &[Option<f64>],
        &mem as &[Option<i64>],
        &lim as &[Option<i64>],
        &restarts as &[Option<i64>],
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn since(ex: impl PgExecutor<'_>, project: Uuid, env: &str, from: OffsetDateTime) -> DbResult<Vec<Sample>> {
    Ok(sqlx::query_as!(
        Sample,
        "SELECT node, instance, at, state, healthy, cpu_percent, memory_bytes, memory_limit_bytes, restarts FROM metric_samples WHERE project_id = $1 AND env_key = $2 AND at >= $3 ORDER BY at",
        project,
        env,
        from
    )
    .fetch_all(ex)
    .await?)
}

#[derive(Debug, Clone)]
pub struct Point {
    pub node: String,
    pub t: OffsetDateTime,
    pub cpu: Option<f64>,
    pub memory: Option<f64>,
    pub limit: Option<f64>,
    pub restarts: Option<i64>,
    pub ok: Option<bool>,
}

pub async fn series(ex: impl PgExecutor<'_>, project: Uuid, env: &str, range_secs: f64, step_secs: f64) -> DbResult<Vec<Point>> {
    Ok(sqlx::query_as!(
        Point,
        r#"WITH per AS (
               SELECT node, at, sum(cpu_percent) AS cpu, sum(memory_bytes)::float8 AS mem, sum(memory_limit_bytes)::float8 AS lim,
                      sum(restarts)::int8 AS restarts, bool_and(coalesce(healthy, state = 'running')) AS ok
               FROM metric_samples
               WHERE project_id = $1 AND env_key = $2 AND at > now() - make_interval(secs => $3)
               GROUP BY node, at)
           SELECT node AS "node!", date_bin(make_interval(secs => $4), at, timestamptz '2000-01-01') AS "t!",
                  avg(cpu) AS cpu, avg(mem) AS memory, max(lim) AS "limit", max(restarts)::int8 AS restarts, bool_and(ok) AS ok
           FROM per GROUP BY 1, 2 ORDER BY 1, 2"#,
        project,
        env,
        range_secs,
        step_secs
    )
    .fetch_all(ex)
    .await?)
}

pub async fn prune(ex: impl PgExecutor<'_>) -> DbResult<u64> {
    Ok(sqlx::query!("DELETE FROM metric_samples WHERE at < now() - make_interval(days => (SELECT metrics_retention_days FROM instance_settings))")
        .execute(ex)
        .await?
        .rows_affected())
}

pub async fn retention_days(ex: impl PgExecutor<'_>) -> DbResult<i32> {
    Ok(sqlx::query_scalar!("SELECT metrics_retention_days FROM instance_settings").fetch_one(ex).await?)
}

pub async fn set_retention_days(ex: impl PgExecutor<'_>, days: i32) -> DbResult<()> {
    sqlx::query!("UPDATE instance_settings SET metrics_retention_days = $1", days).execute(ex).await?;
    Ok(())
}

#[derive(Debug, Clone)]
pub struct Rule {
    pub id: Uuid,
    pub project_id: Uuid,
    pub env_key: String,
    pub node: String,
    pub metric: String,
    pub threshold: f64,
    pub minutes: i32,
    pub firing_nodes: Vec<String>,
    pub fired_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
}

pub async fn rules(ex: impl PgExecutor<'_>, project: Uuid, env: &str) -> DbResult<Vec<Rule>> {
    Ok(sqlx::query_as!(Rule, "SELECT * FROM alert_rules WHERE project_id = $1 AND env_key = $2 ORDER BY created_at", project, env).fetch_all(ex).await?)
}

pub async fn add_rule(ex: impl PgExecutor<'_>, project: Uuid, env: &str, node: &str, metric: &str, threshold: f64, minutes: i32) -> DbResult<Rule> {
    Ok(sqlx::query_as!(
        Rule,
        "INSERT INTO alert_rules (id, project_id, env_key, node, metric, threshold, minutes) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *",
        Uuid::now_v7(),
        project,
        env,
        node,
        metric,
        threshold,
        minutes
    )
    .fetch_one(ex)
    .await?)
}

pub async fn delete_rule(ex: impl PgExecutor<'_>, project: Uuid, id: Uuid) -> DbResult<()> {
    let n = sqlx::query!("DELETE FROM alert_rules WHERE project_id = $1 AND id = $2", project, id).execute(ex).await?.rows_affected();
    if n == 0 { Err(DbError::NotFound) } else { Ok(()) }
}

pub async fn set_firing(ex: impl PgExecutor<'_>, id: Uuid, nodes: &[String], fired: bool) -> DbResult<()> {
    sqlx::query!("UPDATE alert_rules SET firing_nodes = $2, fired_at = CASE WHEN $3 THEN now() ELSE fired_at END WHERE id = $1", id, nodes, fired).execute(ex).await?;
    Ok(())
}
