use anyhow::{Context, Result};
use std::net::SocketAddr;
use std::path::PathBuf;
use std::time::Duration;

#[derive(Debug, Clone)]
pub struct Config {
    pub bind: SocketAddr,
    pub database_url: String,
    pub db_max_connections: u32,
    pub redis_url: String,
    pub amqp_url: String,
    pub web_dir: Option<PathBuf>,
    pub cookie_secure: bool,
    pub session_ttl: Duration,
    pub log_json: bool,
    pub trust_proxy: bool,
    pub notify_allow_private: bool,
    pub data_dir: PathBuf,
    pub secret_key: Option<tessery_core::SecretKey>,
    pub engine: tessery_engine::EngineConfig,
    pub oidc: Option<crate::routes::sso::OidcConfig>,
    pub provider_apis: std::collections::BTreeMap<String, String>,
}

impl Config {
    pub fn from_env() -> Result<Self> {
        Ok(Self {
            bind: var("TESSERY_BIND", "127.0.0.1:8080")
                .parse()
                .context("TESSERY_BIND must be host:port")?,
            database_url: required("TESSERY_DATABASE_URL")?,
            db_max_connections: var("TESSERY_DB_MAX_CONNECTIONS", "20")
                .parse()
                .context("TESSERY_DB_MAX_CONNECTIONS must be a number")?,
            redis_url: required("TESSERY_REDIS_URL")?,
            amqp_url: required("TESSERY_AMQP_URL")?,
            web_dir: std::env::var("TESSERY_WEB_DIR")
                .ok()
                .filter(|s| !s.is_empty())
                .map(PathBuf::from),
            cookie_secure: flag("TESSERY_COOKIE_SECURE", true),
            session_ttl: Duration::from_secs(
                var("TESSERY_SESSION_TTL_HOURS", "168")
                    .parse::<u64>()
                    .context("TESSERY_SESSION_TTL_HOURS must be a number")?
                    * 3600,
            ),
            log_json: flag("TESSERY_LOG_JSON", false),
            trust_proxy: flag("TESSERY_TRUST_PROXY", false),
            notify_allow_private: flag("TESSERY_NOTIFY_ALLOW_PRIVATE", false),
            data_dir: PathBuf::from(var("TESSERY_DATA_DIR", "./data")),
            oidc: crate::routes::sso::OidcConfig::from_env(),
            provider_apis: tessery_cloud::endpoints_from_env(),
            engine: tessery_engine::EngineConfig {
                node: PathBuf::from(var("TESSERY_NODE_BIN", "node")),
                script: engine_script(),
                processes: var("TESSERY_ENGINE_PROCESSES", "2").parse().context("TESSERY_ENGINE_PROCESSES must be a number")?,
                timeout: Duration::from_secs(30),
            },
            secret_key: tessery_core::SecretKey::from_env()?,
        })
    }
}

fn engine_script() -> PathBuf {
    if let Ok(p) = std::env::var("TESSERY_ENGINE_SCRIPT") {
        return PathBuf::from(p);
    }
    let candidates = ["/usr/local/lib/tessery/tessery-engine.mjs", "../../packages/core/dist/tessery-engine.mjs", "packages/core/dist/tessery-engine.mjs"];
    candidates
        .iter()
        .map(PathBuf::from)
        .find(|p| p.is_file())
        .unwrap_or_else(|| PathBuf::from(candidates[1]))
}

fn var(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_owned())
}

fn required(key: &str) -> Result<String> {
    std::env::var(key).with_context(|| format!("{key} is required"))
}

fn flag(key: &str, default: bool) -> bool {
    std::env::var(key)
        .map(|v| matches!(v.to_ascii_lowercase().as_str(), "1" | "true" | "yes" | "on"))
        .unwrap_or(default)
}
