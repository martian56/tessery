use crate::routes::runtime::collect;
use crate::state::AppState;
use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::time::Duration;
use tessery_db::metrics::{self as db, Rule, Sample};
use tessery_mq::Job;
use time::OffsetDateTime;
use uuid::Uuid;

pub const INTERVAL: Duration = Duration::from_secs(30);
/// A round is cut off well before the lease runs out, so two replicas never sample or alert at the same time.
const ROUND_LIMIT: Duration = Duration::from_secs(90);
const LEASE_SECONDS: u64 = 120;
const LEASE: &str = "tessery:metrics:sampler";

pub async fn run(state: AppState) {
    let mut tick = tokio::time::interval(INTERVAL);
    tick.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
    let me = Uuid::now_v7().to_string();
    let mut rounds: u64 = 0;
    loop {
        tick.tick().await;
        let mut redis = state.redis.clone();
        let mine: Option<String> = redis::cmd("SET").arg(LEASE).arg(&me).arg("NX").arg("EX").arg(LEASE_SECONDS).query_async(&mut redis).await.unwrap_or(None);
        if mine.is_none() {
            continue;
        }
        if tokio::time::timeout(ROUND_LIMIT, round(&state, rounds)).await.is_err() {
            tracing::warn!("a metrics round took longer than 90 seconds and was cut short");
        }
        let release: Result<i32, _> = redis::Script::new("if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end").key(LEASE).arg(&me).invoke_async(&mut redis).await;
        if let Err(e) = release {
            tracing::warn!(error = %e, "could not release the metrics lease; it expires on its own");
        }
        rounds += 1;
    }
}

async fn round(state: &AppState, rounds: u64) {
    match db::deployed(&state.db).await {
        Ok(envs) => {
            let mut set = tokio::task::JoinSet::new();
            for (project, env) in envs {
                let state = state.clone();
                set.spawn(async move { sample(&state, project, &env).await });
            }
            while set.join_next().await.is_some() {}
        }
        Err(e) => tracing::warn!(error = %e, "could not list deployed environments for metrics"),
    }
    if rounds.is_multiple_of(120) {
        match db::prune(&state.db).await {
            Ok(n) if n > 0 => tracing::info!(removed = n, "pruned old metric samples"),
            Ok(_) => {}
            Err(e) => tracing::warn!(error = %e, "pruning metric samples failed"),
        }
    }
}

async fn sample(state: &AppState, project: Uuid, env: &str) {
    let Ok(Ok(status)) = tokio::time::timeout(Duration::from_secs(25), collect(state, project, env, &HashMap::new())).await else { return };
    let at = OffsetDateTime::now_utc().replace_millisecond(0).unwrap_or_else(|_| OffsetDateTime::now_utc());
    let samples: Vec<Sample> = status
        .nodes
        .iter()
        .flat_map(|n| {
            n.instances.iter().map(|i| Sample {
                node: n.name.clone(),
                instance: i.id.clone(),
                at,
                state: i.state.clone(),
                healthy: i.healthy,
                cpu_percent: i.cpu_percent,
                memory_bytes: i.memory_bytes.map(|b| b as i64),
                memory_limit_bytes: i.memory_limit_bytes.map(|b| b as i64),
                restarts: i.restarts.map(|r| r as i64),
            })
        })
        .collect();
    if let Err(e) = db::insert(&state.db, project, env, &samples).await {
        tracing::warn!(error = %e, %project, env, "storing metric samples failed");
        return;
    }
    if let Err(e) = evaluate(state, project, env, at).await {
        tracing::warn!(error = %e, %project, env, "checking alert rules failed");
    }
}

pub async fn evaluate(state: &AppState, project: Uuid, env: &str, now: OffsetDateTime) -> anyhow::Result<()> {
    let rules = db::rules(&state.db, project, env).await?;
    let Some(longest) = rules.iter().map(|r| r.minutes).max() else { return Ok(()) };
    let samples = db::since(&state.db, project, env, now - time::Duration::minutes(longest.into()) - BOUNDARY).await?;
    for r in rules {
        let breaches = breaching(&r, &samples, now);
        let known = measured(&r, &samples, now);
        let started: Vec<(&String, &f64)> = breaches.iter().filter(|(n, _)| !r.firing_nodes.contains(n)).collect();
        let cleared: Vec<&String> = r.firing_nodes.iter().filter(|n| !breaches.contains_key(*n) && known.contains(*n)).collect();
        if started.is_empty() && cleared.is_empty() {
            continue;
        }
        let mut sent = true;
        for (node, value) in &started {
            sent &= notify(state, project, env, "alert.firing", describe(&r, node), now_text(&r, **value)).await;
        }
        for node in &cleared {
            sent &= notify(state, project, env, "alert.resolved", format!("Cleared: {}", describe(&r, node)), String::new()).await;
        }
        if !sent {
            continue;
        }
        let still: Vec<String> = r.firing_nodes.iter().filter(|n| !cleared.contains(n)).cloned().chain(started.iter().map(|(n, _)| (*n).clone())).collect();
        db::set_firing(&state.db, r.id, &still, !started.is_empty()).await?;
    }
    Ok(())
}

/// Queues one alert notification. The firing state is only saved once every notification of a change is queued,
/// so a queue outage repeats the change on the next round instead of losing it.
async fn notify(state: &AppState, project: Uuid, env: &str, event: &str, title: String, detail: String) -> bool {
    let job = Job::Notify { project_id: project, env: env.to_owned(), event: event.to_owned(), title, detail, release_id: None };
    match state.mq.publish(job).await {
        Ok(_) => true,
        Err(e) => {
            tracing::warn!(error = %e, "could not queue an alert notification; trying again next round");
            false
        }
    }
}

pub fn describe(r: &Rule, node: &str) -> String {
    match r.metric.as_str() {
        "cpu" => format!("{node} CPU above {}% for {} min", r.threshold, r.minutes),
        "memory" => format!("{node} memory above {}% for {} min", r.threshold, r.minutes),
        "restarts" => format!("{node} restarted at least {} times in {} min", r.threshold, r.minutes),
        _ => format!("{node} unhealthy for {} min", r.minutes),
    }
}

fn now_text(r: &Rule, value: f64) -> String {
    match r.metric.as_str() {
        "cpu" | "memory" => format!("Lowest in the window: {value:.0}%."),
        "restarts" => format!("{value:.0} restarts in the window."),
        _ => String::new(),
    }
}

/// Nodes with enough data in the window to say whether the rule holds. A node missing here is unknown, not recovered.
pub fn measured(r: &Rule, samples: &[Sample], now: OffsetDateTime) -> BTreeSet<String> {
    let from = now - time::Duration::minutes(r.minutes.into());
    let mut by_node: BTreeMap<&str, Vec<&Sample>> = BTreeMap::new();
    for s in samples.iter().filter(|s| s.at >= from - BOUNDARY && s.at <= now && (r.node.is_empty() || s.node == r.node)) {
        by_node.entry(&s.node).or_default().push(s);
    }
    by_node
        .into_iter()
        .filter(|(_, rows)| match r.metric.as_str() {
            "restarts" => rows.iter().any(|s| s.restarts.is_some()),
            _ => {
                let ticks: BTreeSet<OffsetDateTime> = rows.iter().map(|s| s.at).collect();
                covers(&ticks, from, now)
                    && match r.metric.as_str() {
                        "cpu" => rows.iter().all(|s| s.cpu_percent.is_some() || s.state != "running"),
                        "memory" => rows.iter().all(|s| s.state != "running" || (s.memory_bytes.is_some() && s.memory_limit_bytes.is_some())),
                        _ => true,
                    }
            }
        })
        .map(|(n, _)| n.to_owned())
        .collect()
}

/// How far before the window a sample may be and still mark its start, a little more than one round.
const BOUNDARY: time::Duration = time::Duration::seconds(40);

/// True when a sample marks the start of the window, a recent one marks its end and no gap between them is longer
/// than two and a half rounds.
fn covers(ticks: &BTreeSet<OffsetDateTime>, from: OffsetDateTime, now: OffsetDateTime) -> bool {
    let (Some(first), Some(last)) = (ticks.first(), ticks.last()) else { return false };
    let no_gaps = ticks.iter().zip(ticks.iter().skip(1)).all(|(a, b)| *b - *a <= time::Duration::seconds(75));
    ticks.len() >= 2 && *first <= from && *last >= now - time::Duration::seconds(45) && no_gaps
}

pub fn breaching(r: &Rule, samples: &[Sample], now: OffsetDateTime) -> BTreeMap<String, f64> {
    let from = now - time::Duration::minutes(r.minutes.into());
    let mut by_node: BTreeMap<&str, Vec<&Sample>> = BTreeMap::new();
    for s in samples.iter().filter(|s| s.at >= from - BOUNDARY && s.at <= now && (r.node.is_empty() || s.node == r.node)) {
        by_node.entry(&s.node).or_default().push(s);
    }
    let mut out = BTreeMap::new();
    for (node, rows) in by_node {
        if r.metric == "restarts" {
            let mut per: HashMap<&str, (i64, i64)> = HashMap::new();
            for s in rows.iter().filter(|s| s.restarts.is_some()) {
                let n = s.restarts.unwrap_or_default();
                let e = per.entry(&s.instance).or_insert((n, n));
                e.0 = e.0.min(n);
                e.1 = e.1.max(n);
            }
            let total: i64 = per.values().map(|(lo, hi)| hi - lo).sum();
            if total > 0 && total as f64 >= r.threshold {
                out.insert(node.to_owned(), total as f64);
            }
            continue;
        }
        let mut ticks: BTreeMap<OffsetDateTime, Vec<&Sample>> = BTreeMap::new();
        for s in rows {
            ticks.entry(s.at).or_default().push(s);
        }
        let times: BTreeSet<OffsetDateTime> = ticks.keys().copied().collect();
        if !covers(&times, from, now) {
            continue;
        }
        let values: Vec<Option<f64>> = ticks
            .values()
            .map(|t| match r.metric.as_str() {
                "cpu" => Some(t.iter().filter_map(|s| s.cpu_percent).sum()),
                "memory" => {
                    let used: i64 = t.iter().filter_map(|s| s.memory_bytes).sum();
                    let limit: i64 = t.iter().filter_map(|s| s.memory_limit_bytes).sum();
                    (limit > 0).then(|| used as f64 * 100.0 / limit as f64)
                }
                _ => Some(if t.iter().any(|s| s.healthy == Some(false) || s.state != "running") { 1.0 } else { 0.0 }),
            })
            .collect();
        if values.iter().any(Option::is_none) {
            continue;
        }
        let low = values.iter().flatten().copied().fold(f64::INFINITY, f64::min);
        let breached = if r.metric == "unhealthy" { low >= 1.0 } else { low > r.threshold };
        if breached {
            out.insert(node.to_owned(), low);
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    fn rule(metric: &str, threshold: f64, minutes: i32) -> Rule {
        let now = OffsetDateTime::now_utc();
        Rule { id: Uuid::nil(), project_id: Uuid::nil(), env_key: "prod".into(), node: String::new(), metric: metric.into(), threshold, minutes, firing_nodes: vec![], fired_at: None, created_at: now }
    }

    fn at(now: OffsetDateTime, secs_ago: i64, node: &str, cpu: f64, mem: i64, restarts: i64, state: &str) -> Sample {
        Sample { node: node.into(), instance: format!("{node}-1"), at: now - time::Duration::seconds(secs_ago), state: state.into(), healthy: None, cpu_percent: Some(cpu), memory_bytes: Some(mem), memory_limit_bytes: Some(100), restarts: Some(restarts) }
    }

    #[test]
    fn memory_must_stay_high_for_the_whole_window() {
        let now = OffsetDateTime::now_utc();
        let high: Vec<Sample> = (0..11).map(|i| at(now, i * 30, "web", 1.0, 95, 0, "running")).collect();
        assert_eq!(breaching(&rule("memory", 90.0, 5), &high, now).get("web"), Some(&95.0));
        let mut dipped = high.clone();
        dipped[4].memory_bytes = Some(50);
        assert!(breaching(&rule("memory", 90.0, 5), &dipped, now).is_empty());
        let short: Vec<Sample> = (0..3).map(|i| at(now, i * 30, "web", 1.0, 95, 0, "running")).collect();
        assert!(breaching(&rule("memory", 90.0, 5), &short, now).is_empty(), "two minutes of data cannot prove five");
        let ends: Vec<Sample> = [0, 270].iter().map(|s| at(now, *s, "web", 1.0, 95, 0, "running")).collect();
        assert!(breaching(&rule("memory", 90.0, 5), &ends, now).is_empty(), "two samples far apart do not prove the minutes between them");
        let one_minute: Vec<Sample> = [0, 30].iter().map(|s| at(now, *s, "web", 1.0, 95, 0, "running")).collect();
        assert!(breaching(&rule("memory", 90.0, 1), &one_minute, now).is_empty(), "half a minute does not prove a minute");
    }

    #[test]
    fn missing_measurements_are_unknown_not_recovered() {
        let now = OffsetDateTime::now_utc();
        let r = rule("memory", 90.0, 5);
        let mut blind: Vec<Sample> = (0..11).map(|i| at(now, i * 30, "web", 1.0, 95, 0, "running")).collect();
        for s in &mut blind {
            s.memory_limit_bytes = None;
        }
        assert!(breaching(&r, &blind, now).is_empty());
        assert!(!measured(&r, &blind, now).contains("web"), "a firing alert stays firing while stats are unavailable");
        let calm: Vec<Sample> = (0..11).map(|i| at(now, i * 30, "web", 1.0, 20, 0, "running")).collect();
        assert!(measured(&r, &calm, now).contains("web"), "real low readings do clear it");
    }

    #[test]
    fn a_container_that_keeps_restarting_fires() {
        let now = OffsetDateTime::now_utc();
        let looping: Vec<Sample> = (0..6).map(|i| at(now, i * 30, "api", 0.0, 10, 9 - i, "restarting")).collect();
        assert_eq!(breaching(&rule("restarts", 3.0, 5), &looping, now).get("api"), Some(&5.0));
        let calm: Vec<Sample> = (0..6).map(|i| at(now, i * 30, "api", 0.0, 10, 2, "running")).collect();
        assert!(breaching(&rule("restarts", 1.0, 5), &calm, now).is_empty());
    }

    #[test]
    fn cpu_and_health_are_per_node() {
        let now = OffsetDateTime::now_utc();
        let mut rows: Vec<Sample> = (0..5).map(|i| at(now, i * 30, "web", 95.0, 10, 0, "running")).collect();
        rows.extend((0..5).map(|i| at(now, i * 30, "db", 5.0, 10, 0, "exited")));
        let cpu = breaching(&rule("cpu", 80.0, 2), &rows, now);
        assert!(cpu.contains_key("web") && !cpu.contains_key("db"));
        let sick = breaching(&rule("unhealthy", 0.0, 2), &rows, now);
        assert!(sick.contains_key("db") && !sick.contains_key("web"));
    }
}
