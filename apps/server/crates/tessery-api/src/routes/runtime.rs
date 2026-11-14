use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::runtime::{self, Running, Where};
use crate::state::AppState;
use tessery_core::{Permission as P, Target};
use axum::Json;
use axum::extract::{Path, Query, State};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::collections::HashMap;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

async fn guard(state: &AppState, p: &Principal, project: Uuid, env: &str, perm: P) -> ApiResult<HashMap<String, String>> {
    let target = match rbac::project_target(state, project).await? {
        Target::Project { org, team, project } => Target::Environment { org, team, project, env: env.to_owned() },
        t => t,
    };
    rbac::require(state, p, &target, perm).await?;
    let doc = tessery_db::projects::get(&state.db, project).await?.doc;
    Ok(doc["nodes"].as_array().map(|ns| ns.iter().filter_map(|n| Some((n["name"].as_str()?.to_owned(), n["id"].as_str()?.to_owned()))).collect()).unwrap_or_default())
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct InstanceDto {
    pub id: String,
    /// running, exited, restarting, pending...
    pub state: String,
    pub healthy: Option<bool>,
    pub detail: String,
    pub cpu_percent: Option<f64>,
    pub memory_bytes: Option<u64>,
    pub memory_limit_bytes: Option<u64>,
    pub restarts: Option<u64>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NodeStatusDto {
    pub name: String,
    pub node_id: Option<String>,
    pub instances: Vec<InstanceDto>,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EnvStatusDto {
    pub target: String,
    #[schema(value_type = Vec<Object>)]
    pub endpoints: Value,
    pub nodes: Vec<NodeStatusDto>,
}

fn bytes(s: &str) -> Option<u64> {
    let s = s.trim();
    let split = s.find(|c: char| c.is_ascii_alphabetic()).unwrap_or(s.len());
    let n: f64 = s[..split].trim().parse().ok()?;
    let mult = match s[split..].trim() {
        "B" | "" => 1.0,
        "kB" | "KB" => 1e3,
        "KiB" => 1024.0,
        "MB" => 1e6,
        "MiB" => 1024.0 * 1024.0,
        "GB" => 1e9,
        "GiB" => 1024.0 * 1024.0 * 1024.0,
        _ => return None,
    };
    Some((n * mult) as u64)
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/status", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path)), responses((status = 200, body = EnvStatusDto)))]
pub async fn status(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>) -> ApiResult<Json<EnvStatusDto>> {
    let ids = guard(&state, &p, project, &env, P::DeploymentRead).await?;
    Ok(Json(collect(&state, project, &env, &ids).await?))
}

pub async fn collect(state: &AppState, project: Uuid, env: &str, ids: &HashMap<String, String>) -> ApiResult<EnvStatusDto> {
    let Running { place, plan } = runtime::locate(state, project, env).await?;
    let mut nodes: Vec<NodeStatusDto> = Vec::new();
    let mut push = |name: String, inst: InstanceDto| match nodes.iter_mut().find(|n| n.name == name) {
        Some(n) => n.instances.push(inst),
        None => nodes.push(NodeStatusDto { node_id: ids.get(&name).cloned(), name, instances: vec![inst] }),
    };
    let target = match &place {
        Where::Docker { stack, host } => {
            let list = runtime::containers(stack, host, None).await?;
            let running: Vec<String> = list.iter().filter(|c| c["State"] == "running").filter_map(|c| c["ID"].as_str().map(str::to_owned)).collect();
            let mut stats: HashMap<String, Value> = HashMap::new();
            if !running.is_empty() {
                let mut args = vec!["stats".to_owned(), "--no-stream".into(), "--format".into(), "{{json .}}".into()];
                args.extend(running.iter().cloned());
                if let Ok(out) = runtime::docker(host, &args, None).await {
                    for l in out.stdout.lines() {
                        if let Ok(v) = serde_json::from_str::<Value>(l) {
                            stats.insert(v["Container"].as_str().unwrap_or_default().to_owned(), v);
                        }
                    }
                }
            }
            let mut restarts: HashMap<String, u64> = HashMap::new();
            let all: Vec<String> = list.iter().filter_map(|c| c["ID"].as_str().map(str::to_owned)).collect();
            if !all.is_empty() {
                let mut args = vec!["inspect".to_owned(), "--format".into(), "{{.Id}} {{.RestartCount}}".into()];
                args.extend(all);
                if let Ok(out) = runtime::docker(host, &args, None).await {
                    for l in out.stdout.lines() {
                        if let Some((id, n)) = l.split_once(' ')
                            && let Ok(n) = n.trim().parse()
                        {
                            restarts.insert(id.to_owned(), n);
                        }
                    }
                }
            }
            for c in &list {
                let id = c["ID"].as_str().unwrap_or_default().to_owned();
                let detail = c["Status"].as_str().unwrap_or_default().to_owned();
                let s = stats.get(&id);
                let mem = s.and_then(|s| s["MemUsage"].as_str()).map(|m| m.split('/').map(bytes).collect::<Vec<_>>());
                push(runtime::label(c, "com.docker.compose.service").unwrap_or_default(), InstanceDto {
                    state: c["State"].as_str().unwrap_or_default().to_owned(),
                    healthy: if detail.contains("(healthy)") { Some(true) } else if detail.contains("(unhealthy)") { Some(false) } else { None },
                    cpu_percent: s.and_then(|s| s["CPUPerc"].as_str()).and_then(|c| c.trim_end_matches('%').parse().ok()),
                    memory_bytes: mem.as_ref().and_then(|m| m.first().copied().flatten()),
                    memory_limit_bytes: mem.as_ref().and_then(|m| m.get(1).copied().flatten()),
                    restarts: restarts.get(&id).copied(),
                    detail,
                    id: id.chars().take(12).collect(),
                });
            }
            "docker"
        }
        Where::Kubernetes { namespace, kubeconfig } => {
            let pods_args: Vec<String> = vec!["-n".into(), namespace.clone(), "get".into(), "pods".into(), "-o".into(), "json".into()];
            let usage_args: Vec<String> = vec!["get".into(), "--raw".into(), format!("/apis/metrics.k8s.io/v1beta1/namespaces/{namespace}/pods")];
            let (out, usage) = tokio::join!(runtime::kubectl(kubeconfig, &pods_args, None), runtime::kubectl(kubeconfig, &usage_args, None));
            let out = out?;
            let usage: HashMap<String, (f64, u64)> = usage
                .ok()
                .filter(|u| u.ok)
                .and_then(|u| serde_json::from_str::<Value>(&u.stdout).ok())
                .map(|v| {
                    v["items"].as_array().into_iter().flatten().map(|pod| {
                        let (mut cpu, mut mem) = (0.0, 0);
                        for c in pod["containers"].as_array().into_iter().flatten() {
                            cpu += c["usage"]["cpu"].as_str().and_then(cores).unwrap_or(0.0);
                            mem += c["usage"]["memory"].as_str().and_then(quantity).unwrap_or(0);
                        }
                        (pod["metadata"]["name"].as_str().unwrap_or_default().to_owned(), (cpu, mem))
                    }).collect()
                })
                .unwrap_or_default();
            if !out.ok {
                return Err(ApiError::Conflict(format!("kubectl: {}", out.stderr.trim())));
            }
            let pods: Value = serde_json::from_str(&out.stdout).map_err(|e| ApiError::Internal(e.into()))?;
            for pod in pods["items"].as_array().into_iter().flatten() {
                let cs = &pod["status"]["containerStatuses"][0];
                let waiting = cs["state"]["waiting"]["reason"].as_str();
                let used = pod["metadata"]["name"].as_str().and_then(|n| usage.get(n));
                let limit = pod["spec"]["containers"][0]["resources"]["limits"]["memory"].as_str().and_then(quantity);
                push(pod["metadata"]["labels"]["app"].as_str().unwrap_or_default().to_owned(), InstanceDto {
                    id: pod["metadata"]["name"].as_str().unwrap_or_default().to_owned(),
                    state: waiting.map(str::to_lowercase).unwrap_or_else(|| pod["status"]["phase"].as_str().unwrap_or_default().to_lowercase()),
                    healthy: cs["ready"].as_bool(),
                    detail: waiting.or(pod["status"]["reason"].as_str()).unwrap_or_default().to_owned(),
                    cpu_percent: used.map(|u| (u.0 * 1000.0).round() / 10.0),
                    memory_bytes: used.map(|u| u.1),
                    memory_limit_bytes: limit,
                    restarts: cs["restartCount"].as_u64(),
                });
            }
            "kubernetes"
        }
    };
    nodes.sort_by(|a, b| a.name.cmp(&b.name));
    Ok(EnvStatusDto { target: target.into(), endpoints: plan["endpoints"].clone(), nodes })
}

fn cores(q: &str) -> Option<f64> {
    let (num, scale) = match q.char_indices().last()? {
        (i, 'n') => (&q[..i], 1e-9),
        (i, 'u') => (&q[..i], 1e-6),
        (i, 'm') => (&q[..i], 1e-3),
        _ => (q, 1.0),
    };
    num.parse::<f64>().ok().map(|n| n * scale)
}

fn quantity(q: &str) -> Option<u64> {
    const UNITS: &[(&str, f64)] = &[("Ki", 1024.0), ("Mi", 1048576.0), ("Gi", 1073741824.0), ("Ti", 1099511627776.0), ("k", 1e3), ("K", 1e3), ("M", 1e6), ("G", 1e9), ("T", 1e12)];
    let (num, scale) = UNITS.iter().find_map(|(u, f)| q.strip_suffix(u).map(|n| (n, *f))).unwrap_or((q, 1.0));
    num.parse::<f64>().ok().map(|n| (n * scale) as u64)
}

#[derive(Deserialize, IntoParams)]
pub struct LogsQuery {
    /// Node name or id; all nodes when empty.
    pub node: Option<String>,
    /// Case-insensitive text to look for.
    pub q: Option<String>,
    /// Only this level and worse: debug, info, warn, error.
    pub level: Option<String>,
    #[serde(default = "default_limit")]
    pub limit: usize,
}

fn default_limit() -> usize {
    300
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct EnvLogLineDto {
    /// Milliseconds since the epoch.
    pub t: i64,
    pub node_id: String,
    pub node: String,
    pub level: String,
    pub msg: String,
}

fn level_of(msg: &str) -> &'static str {
    let lower = msg.to_ascii_lowercase();
    let pino = |n: u64| lower.contains(&format!("\"level\":{n}"));
    if pino(50) || pino(60) || lower.contains("\"level\":\"error\"") || lower.contains("level=error") || lower.contains(" error ") || lower.starts_with("error") || lower.contains("[error]") || lower.contains("panic") || lower.contains("fatal") {
        "error"
    } else if pino(40) || lower.contains("\"level\":\"warn") || lower.contains("level=warn") || lower.contains("warn") {
        "warn"
    } else if pino(20) || pino(10) || lower.contains("level=debug") || lower.contains("\"level\":\"debug\"") {
        "debug"
    } else {
        "info"
    }
}

fn rank(level: &str) -> u8 {
    match level {
        "debug" => 0,
        "info" => 1,
        "warn" => 2,
        _ => 3,
    }
}

fn parse_line(raw: &str) -> Option<(i64, String)> {
    let (ts, msg) = raw.split_once(' ')?;
    let t = OffsetDateTime::parse(ts, &time::format_description::well_known::Rfc3339).ok()?;
    Some(((t.unix_timestamp_nanos() / 1_000_000) as i64, msg.to_owned()))
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/logs", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), LogsQuery), responses((status = 200, body = [EnvLogLineDto])))]
pub async fn logs(State(state): State<AppState>, p: Principal, Path((project, env)): Path<(Uuid, String)>, Query(q): Query<LogsQuery>) -> ApiResult<Json<Vec<EnvLogLineDto>>> {
    let ids = guard(&state, &p, project, &env, P::DeploymentRead).await?;
    let names: HashMap<&String, &String> = ids.iter().map(|(n, i)| (i, n)).collect();
    let node = q.node.as_ref().map(|n| names.get(n).map(|s| (*s).clone()).unwrap_or_else(|| n.clone()));
    let limit = q.limit.clamp(1, 2000);
    let Running { place, plan } = runtime::locate(&state, project, &env).await?;
    let mut lines: Vec<(i64, String, String)> = Vec::new();
    match &place {
        Where::Docker { stack, host } => {
            for c in runtime::containers(stack, host, node.as_deref()).await? {
                let svc = runtime::label(&c, "com.docker.compose.service").unwrap_or_default();
                let id = c["ID"].as_str().unwrap_or_default().to_owned();
                let out = runtime::docker(host, &["logs".into(), "--timestamps".into(), "--tail".into(), limit.to_string(), id], None).await?;
                for raw in out.stdout.lines().chain(out.stderr.lines()) {
                    if let Some((t, msg)) = parse_line(raw) {
                        lines.push((t, svc.clone(), msg));
                    }
                }
            }
        }
        Where::Kubernetes { namespace, kubeconfig } => {
            let selector = match &node {
                Some(n) => format!("app={n}"),
                None => format!("app.kubernetes.io/part-of={}", plan["project"].as_str().unwrap_or_default()),
            };
            let args = ["-n", namespace, "logs", "-l", &selector, "--timestamps", "--prefix", "--all-containers", "--max-log-requests", "20", &format!("--tail={limit}")].map(str::to_owned).to_vec();
            let out = runtime::kubectl(kubeconfig, &args, None).await?;
            for raw in out.stdout.lines() {
                let Some((prefix, rest)) = raw.split_once("] ") else { continue };
                let container = prefix.rsplit('/').next().unwrap_or_default().to_owned();
                if let Some((t, msg)) = parse_line(rest) {
                    lines.push((t, container, msg));
                }
            }
        }
    }
    let needle = q.q.as_deref().map(str::to_lowercase).filter(|s| !s.is_empty());
    let min = q.level.as_deref().map(rank).unwrap_or(0);
    lines.sort_by_key(|l| l.0);
    let out: Vec<EnvLogLineDto> = lines
        .into_iter()
        .map(|(t, name, msg)| (t, name, level_of(&msg), msg))
        .filter(|(_, _, level, msg)| rank(level) >= min && needle.as_ref().is_none_or(|n| msg.to_lowercase().contains(n)))
        .map(|(t, name, level, msg)| EnvLogLineDto { t, node_id: ids.get(&name).cloned().unwrap_or_else(|| name.clone()), node: name, level: level.into(), msg })
        .collect();
    let skip = out.len().saturating_sub(limit);
    Ok(Json(out.into_iter().skip(skip).collect()))
}

async fn psql(state: &AppState, project: Uuid, env: &str, node: &str, sql: &str, csv: bool, write: bool) -> ApiResult<String> {
    let Running { place, .. } = runtime::locate(state, project, env).await?;
    let mut psql: Vec<String> = ["psql", "-X", "-U", "app", "-d", "app", "-v", "ON_ERROR_STOP=1", "-c"].map(str::to_owned).to_vec();
    psql.push(sql.to_owned());
    psql.extend(if csv { vec!["--csv".to_owned()] } else { vec!["-q".to_owned(), "-t".into(), "-A".into()] });
    let read_only = (!write).then_some("PGOPTIONS=-c default_transaction_read_only=on");
    let out = match &place {
        Where::Docker { stack, host } => {
            let c = runtime::containers(stack, host, Some(node)).await?.into_iter().find(|c| c["State"] == "running").ok_or_else(|| ApiError::Conflict(format!("{node} is not running in {env}")))?;
            let mut args = vec!["exec".to_owned(), "-i".into()];
            if let Some(e) = read_only {
                args.extend(["-e".to_owned(), e.to_owned()]);
            }
            args.push(c["ID"].as_str().unwrap_or_default().to_owned());
            args.extend(psql);
            runtime::docker(host, &args, None).await?
        }
        Where::Kubernetes { namespace, kubeconfig } => {
            let mut args = vec!["-n".to_owned(), namespace.clone(), "exec".into(), "-i".into(), format!("{node}-0"), "--".into(), "env".into()];
            args.push(read_only.unwrap_or("PGOPTIONS=").to_owned());
            args.extend(psql);
            runtime::kubectl(kubeconfig, &args, None).await?
        }
    };
    if !out.ok {
        let msg = out.stderr.lines().find(|l| l.contains("ERROR")).unwrap_or(out.stderr.trim()).replace("psql:<stdin>:", "");
        return Err(ApiError::BadRequest(msg.trim().trim_start_matches(|c: char| c.is_ascii_digit() || c == ':').trim().to_owned()));
    }
    Ok(out.stdout)
}

fn ident(s: &str) -> ApiResult<String> {
    let ok = !s.is_empty() && s.len() <= 63 && s.chars().next().is_some_and(|c| c.is_ascii_alphabetic() || c == '_') && s.chars().all(|c| c.is_ascii_alphanumeric() || c == '_');
    if ok { Ok(format!("\"{s}\"")) } else { Err(ApiError::invalid("table", "not a plain identifier")) }
}

fn node_name(ids: &HashMap<String, String>, node: &str) -> String {
    ids.iter().find(|(_, id)| id.as_str() == node).map(|(n, _)| n.clone()).unwrap_or_else(|| node.to_owned())
}

#[derive(Serialize, ToSchema)]
pub struct TablesDto {
    pub tables: Vec<String>,
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/databases/{node}/tables", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), ("node" = String, Path)), responses((status = 200, body = TablesDto)))]
pub async fn tables(State(state): State<AppState>, p: Principal, Path((project, env, node)): Path<(Uuid, String, String)>) -> ApiResult<Json<TablesDto>> {
    let ids = guard(&state, &p, project, &env, P::DataRead).await?;
    let out = psql(&state, project, &env, &node_name(&ids, &node), "SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY 1", false, false).await?;
    Ok(Json(TablesDto { tables: out.lines().map(str::trim).filter(|l| !l.is_empty()).map(str::to_owned).collect() }))
}

#[derive(Deserialize, IntoParams)]
#[serde(rename_all = "camelCase")]
pub struct RowsQuery {
    #[serde(default)]
    pub page: i64,
    #[serde(default = "default_page")]
    pub page_size: i64,
    /// Column name, optionally followed by ` desc`.
    pub sort: Option<String>,
    /// Text to look for anywhere in the row.
    pub filter: Option<String>,
}

fn default_page() -> i64 {
    50
}

#[derive(Serialize, ToSchema)]
pub struct RowsDto {
    pub columns: Vec<String>,
    #[schema(value_type = Vec<Object>)]
    pub rows: Value,
    pub total: i64,
}

#[utoipa::path(get, path = "/api/projects/{project}/environments/{env}/databases/{node}/tables/{table}/rows", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), ("node" = String, Path), ("table" = String, Path), RowsQuery), responses((status = 200, body = RowsDto)))]
pub async fn rows(State(state): State<AppState>, p: Principal, Path((project, env, node, table)): Path<(Uuid, String, String, String)>, Query(q): Query<RowsQuery>) -> ApiResult<Json<RowsDto>> {
    let ids = guard(&state, &p, project, &env, P::DataRead).await?;
    let t = ident(&table)?;
    let size = q.page_size.clamp(1, 500);
    let offset = q.page.max(0) * size;
    let order = match q.sort.as_deref().filter(|s| !s.is_empty()) {
        Some(s) => {
            let (col, desc) = s.strip_suffix(" desc").map(|c| (c, true)).unwrap_or((s, false));
            format!("ORDER BY {} {}", ident(col)?, if desc { "DESC" } else { "ASC" })
        }
        None => String::new(),
    };
    let filter = q.filter.as_deref().filter(|f| !f.is_empty()).map(|f| format!("WHERE r::text ILIKE '%{}%'", f.replace('\'', "''").replace('\\', "\\\\"))).unwrap_or_default();
    let sql = format!(
        "SELECT json_build_object('columns', (SELECT coalesce(json_agg(column_name ORDER BY ordinal_position), '[]') FROM information_schema.columns WHERE table_schema = 'public' AND table_name = '{name}'), \
         'total', (SELECT count(*) FROM {t} r {filter}), \
         'rows', (SELECT coalesce(json_agg(x), '[]') FROM (SELECT r.* FROM {t} r {filter} {order} LIMIT {size} OFFSET {offset}) x))",
        name = table.replace('\'', "''"),
    );
    let out = psql(&state, project, &env, &node_name(&ids, &node), &sql, false, false).await?;
    let v: Value = serde_json::from_str(out.trim()).map_err(|e| ApiError::Internal(anyhow::anyhow!("unexpected psql output: {e}")))?;
    Ok(Json(RowsDto { columns: serde_json::from_value(v["columns"].clone()).unwrap_or_default(), total: v["total"].as_i64().unwrap_or(0), rows: v["rows"].clone() }))
}

#[derive(Deserialize, ToSchema)]
pub struct SqlRequest {
    pub sql: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SqlResultDto {
    pub columns: Vec<String>,
    #[schema(value_type = Vec<Object>)]
    pub rows: Value,
    pub took_ms: u64,
    pub message: Option<String>,
    /// False when the statement ran read-only because the caller lacks data:write.
    pub writable: bool,
}

fn parse_csv(s: &str) -> Vec<Vec<String>> {
    let mut rows = Vec::new();
    let (mut row, mut field, mut quoted) = (Vec::new(), String::new(), false);
    let mut chars = s.chars().peekable();
    while let Some(c) = chars.next() {
        match (c, quoted) {
            ('"', true) if chars.peek() == Some(&'"') => {
                field.push('"');
                chars.next();
            }
            ('"', _) => quoted = !quoted,
            (',', false) => row.push(std::mem::take(&mut field)),
            ('\n', false) => {
                row.push(std::mem::take(&mut field));
                rows.push(std::mem::take(&mut row));
            }
            ('\r', false) => {}
            (c, _) => field.push(c),
        }
    }
    if !field.is_empty() || !row.is_empty() {
        row.push(field);
        rows.push(row);
    }
    rows
}

#[utoipa::path(post, path = "/api/projects/{project}/environments/{env}/databases/{node}/sql", tag = "runtime", params(("project" = Uuid, Path), ("env" = String, Path), ("node" = String, Path)), request_body = SqlRequest, responses((status = 200, body = SqlResultDto)))]
pub async fn sql(State(state): State<AppState>, p: Principal, Path((project, env, node)): Path<(Uuid, String, String)>, Json(req): Json<SqlRequest>) -> ApiResult<Json<SqlResultDto>> {
    let ids = guard(&state, &p, project, &env, P::DataWrite).await?;
    let target = match rbac::project_target(&state, project).await? {
        Target::Project { org, team, project } => Target::Environment { org, team, project, env: env.clone() },
        t => t,
    };
    let writable = true;
    let sql = req.sql.trim();
    if sql.is_empty() || sql.len() > 30_000 {
        return Err(ApiError::invalid("sql", "write a statement, at most 30 KB"));
    }
    if sql.starts_with('\\') {
        return Err(ApiError::invalid("sql", "psql meta-commands are not available; write SQL"));
    }
    let started = std::time::Instant::now();
    let out = psql(&state, project, &env, &node_name(&ids, &node), sql, true, writable).await?;
    let took_ms = started.elapsed().as_millis() as u64;
    crate::audit::record(&state.db, &p, crate::audit::Entry::new(Some(target.org().0), "data.sql", "project", project).details(json!({ "env": env, "node": node, "sql": sql.chars().take(2000).collect::<String>() }))).await?;
    let trimmed = out.trim_end();
    let tag = trimmed.lines().last().filter(|l| ["INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE", "GRANT", "REVOKE", "BEGIN", "COMMIT", "ROLLBACK", "SET", "COPY"].iter().any(|k| l.starts_with(k)));
    if let Some(tag) = tag.filter(|_| trimmed.lines().count() == 1) {
        return Ok(Json(SqlResultDto { columns: vec![], rows: json!([]), took_ms, message: Some(tag.to_owned()), writable }));
    }
    let mut table = parse_csv(trimmed);
    if table.is_empty() {
        return Ok(Json(SqlResultDto { columns: vec![], rows: json!([]), took_ms, message: Some("done".into()), writable }));
    }
    let columns = table.remove(0);
    let rows: Vec<Value> = table.into_iter().map(|r| Value::Object(columns.iter().cloned().zip(r.into_iter().map(Value::String)).collect())).collect();
    Ok(Json(SqlResultDto { message: Some(format!("{} row{}", rows.len(), if rows.len() == 1 { "" } else { "s" })), columns, rows: Value::Array(rows), took_ms, writable }))
}

#[cfg(test)]
mod tests {
    use super::{cores, quantity};

    #[test]
    fn parses_kubernetes_quantities() {
        assert_eq!(cores("250m"), Some(0.25));
        assert_eq!(cores("2"), Some(2.0));
        assert!((cores("1500000n").unwrap() - 0.0015).abs() < 1e-12);
        assert_eq!(quantity("25Mi"), Some(25 * 1024 * 1024));
        assert_eq!(quantity("1G"), Some(1_000_000_000));
        assert_eq!(quantity("4096"), Some(4096));
        assert_eq!(quantity("lots"), None);
    }
}
