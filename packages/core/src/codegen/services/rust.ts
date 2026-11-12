import { type Files, type ServiceModel, comment, envExample, ident, readme, snake, stepLines } from './model'

const fn = (name: string) => snake(name).replace(/[^a-z0-9_]/g, '_')

function pick(m: ServiceModel): { s: 'axum' | 'actix'; note?: string } {
  if (m.frameworkId === 'actix') return { s: 'actix' }
  if (m.kind === 'api' && ['tonic', 'async-graphql'].includes(m.frameworkId)) {
    return { s: 'axum', note: `${m.framework} code is not generated yet. The ${m.style === 'grpc' ? 'proto' : 'schema'} is included; HTTP routes and health use Axum.` }
  }
  return { s: 'axum' }
}

function config(m: ServiceModel): string {
  return `use std::collections::HashMap;

/// Runtime configuration, read once from the environment.
pub struct Config {
    pub port: u16,
    pub dependencies: HashMap<&'static str, String>,
}

impl Config {
    pub fn from_env() -> Self {
        let var = |k: &str, d: &str| std::env::var(k).unwrap_or_else(|_| d.to_owned());
        Self {
            port: var("PORT", "${m.port}").parse().expect("PORT must be a number"),
            dependencies: HashMap::from([
${m.deps.map((d) => `                ("${d.env}", var("${d.env}", "${d.url}")),`).join('\n')}
            ]),
        }
    }
}
`
}

function axumMain(m: ServiceModel): string {
  const methods = [...new Set(['get', ...m.routes.map((r) => r.method.toLowerCase())])].sort().join(', ')
  return `mod config;

use axum::{Json, Router, http::StatusCode, routing::{${methods}}};
use serde_json::{Value, json};

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let cfg = config::Config::from_env();
    tracing::info!(dependencies = cfg.dependencies.len(), "starting ${m.name}");

    let app = Router::new()
        .route("/healthz", get(|| async { Json(json!({ "status": "ok" })) }))
${m.routes.map((r) => `        .route("${r.path}",${r.method.toLowerCase()}(${fn(r.name)}))`).join('\n')};

    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await.expect("bind");
    tracing::info!(port = cfg.port, "listening");
    axum::serve(listener, app).with_graceful_shutdown(async { let _ = tokio::signal::ctrl_c().await; }).await.expect("server");
}

fn not_implemented(operation: &str) -> (StatusCode, Json<Value>) {
    (StatusCode::NOT_IMPLEMENTED, Json(json!({ "error": "not_implemented", "operation": operation })))
}
${m.routes.map((r) => `
${comment(stepLines(r.op), '///')}
async fn ${fn(r.name)}() -> (StatusCode, Json<Value>) {
    not_implemented("${r.name}")
}`).join('\n')}
`
}

function actixMain(m: ServiceModel): string {
  return `mod config;

use actix_web::{App, HttpResponse, HttpServer, web};
use serde_json::json;

#[actix_web::main]
async fn main() -> std::io::Result<()> {
    tracing_subscriber::fmt().init();
    let cfg = config::Config::from_env();
    tracing::info!(port = cfg.port, dependencies = cfg.dependencies.len(), "starting ${m.name}");
    HttpServer::new(|| {
        App::new()
            .route("/healthz", web::get().to(|| async { HttpResponse::Ok().json(json!({ "status": "ok" })) }))
${m.routes.map((r) => `            .route("${r.path}", web::${r.method.toLowerCase()}().to(${fn(r.name)}))`).join('\n')}
    })
    .bind(("0.0.0.0", cfg.port))?
    .run()
    .await
}
${m.routes.map((r) => `
${comment(stepLines(r.op), '///')}
async fn ${fn(r.name)}() -> HttpResponse {
    HttpResponse::NotImplemented().json(json!({ "error": "not_implemented", "operation": "${r.name}" }))
}`).join('\n')}
`
}

function workerMain(m: ServiceModel): string {
  if (m.kind === 'cron') return `mod config;

/// Runs once per schedule (${m.schedule}); the platform starts the container on that schedule.
fn main() {
    let cfg = config::Config::from_env();
    println!("${m.name} started with {} dependencies", cfg.dependencies.len());
}
`
  return `mod config;

use std::time::Duration;

/// Consumes work from: ${m.sources.join(', ') || 'nothing connected yet'}. Replace next_job with the client for that source.
async fn next_job() -> Option<String> {
    tokio::time::sleep(Duration::from_secs(1)).await;
    None
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().init();
    let cfg = config::Config::from_env();
    let workers: usize = std::env::var("CONCURRENCY").ok().and_then(|v| v.parse().ok()).unwrap_or(${m.concurrency});
    for _ in 0..workers.max(1) {
        tokio::spawn(async {
            loop {
                if let Some(job) = next_job().await {
                    tracing::info!(%job, "received job");
                }
            }
        });
    }
    let health = axum::Router::new().route("/healthz", axum::routing::get(|| async { r#"{"status":"ok"}"# }));
    let listener = tokio::net::TcpListener::bind(("0.0.0.0", cfg.port)).await.expect("bind");
    axum::serve(listener, health).await.expect("server");
}
`
}

export function rustService(m: ServiceModel): Files {
  const { s, note } = pick(m)
  const crate = ident(m.name).replace(/_/g, '-').toLowerCase()
  const f: Files = {}
  f[`${m.dir}/src/config.rs`] = config(m)
  f[`${m.dir}/src/main.rs`] = m.kind !== 'api' ? workerMain(m) : s === 'actix' ? actixMain(m) : axumMain(m)
  const web = s === 'actix' && m.kind === 'api' ? 'actix-web = "4"\n' : 'axum = "0.8"\n'
  const runtime = m.kind === 'cron' ? '' : `tokio = { version = "1", features = ["macros", "rt-multi-thread", "net", "signal", "time"] }\n${web}`
  f[`${m.dir}/Cargo.toml`] = `[package]
name = "${crate}"
version = "0.1.0"
edition = "2024"

[dependencies]
${runtime}serde_json = "1"
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }

[profile.release]
strip = true
`
  f[`${m.dir}/Dockerfile`] = `FROM rust:1-slim-trixie AS build
WORKDIR /src
COPY . .
RUN cargo build --release && cp target/release/${crate} /app

FROM debian:trixie-slim
RUN useradd --system --uid 10001 app
COPY --from=build /app /usr/local/bin/app
USER app
EXPOSE ${m.port}
ENTRYPOINT ["/usr/local/bin/app"]
`
  f[`${m.dir}/.dockerignore`] = 'target\n'
  f[`${m.dir}/.env.example`] = envExample(m)
  f[`${m.dir}/README.md`] = readme(m, 'cargo run', note ? [note] : [])
  return f
}
