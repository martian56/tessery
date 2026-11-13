use serde::Deserialize;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use std::path::PathBuf;
use std::process::Stdio;
use std::sync::Arc;
use std::sync::atomic::{AtomicU64, AtomicUsize, Ordering};
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, ChildStdout, Command};
use tokio::sync::Mutex;

#[derive(Debug, thiserror::Error)]
pub enum EngineError {
    #[error("{0}")]
    Rejected(String),
    #[error("engine process failed: {0}")]
    Process(String),
    #[error("engine did not answer within {0:?}")]
    Timeout(Duration),
    #[error("engine reply was not understood: {0}")]
    Protocol(String),
}

pub type Result<T> = std::result::Result<T, EngineError>;

#[derive(Debug, Clone)]
pub struct EngineConfig {
    pub node: PathBuf,
    pub script: PathBuf,
    pub processes: usize,
    pub timeout: Duration,
}

struct Proc {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

#[derive(Clone)]
pub struct Engine {
    inner: Arc<Inner>,
}

struct Inner {
    config: EngineConfig,
    slots: Vec<Mutex<Option<Proc>>>,
    next: AtomicUsize,
    ids: AtomicU64,
}

impl std::fmt::Debug for Engine {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("Engine").field("script", &self.inner.config.script).finish()
    }
}

#[derive(Deserialize)]
struct Reply {
    id: Option<u64>,
    result: Option<Value>,
    error: Option<String>,
}

impl Engine {
    pub fn new(config: EngineConfig) -> Result<Self> {
        if !config.script.is_file() {
            return Err(EngineError::Process(format!(
                "engine script {} not found; build it with `npm run build:engine` in packages/core",
                config.script.display()
            )));
        }
        let slots = (0..config.processes.max(1)).map(|_| Mutex::new(None)).collect();
        Ok(Self { inner: Arc::new(Inner { config, slots, next: AtomicUsize::new(0), ids: AtomicU64::new(1) }) })
    }

    async fn spawn(&self) -> Result<Proc> {
        let mut child = Command::new(&self.inner.config.node)
            .arg(&self.inner.config.script)
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::inherit())
            .kill_on_drop(true)
            .spawn()
            .map_err(|e| EngineError::Process(format!("could not start {}: {e}", self.inner.config.node.display())))?;
        let stdin = child.stdin.take().ok_or_else(|| EngineError::Process("no stdin".into()))?;
        let stdout = BufReader::new(child.stdout.take().ok_or_else(|| EngineError::Process("no stdout".into()))?);
        Ok(Proc { child, stdin, stdout })
    }

    pub async fn call(&self, method: &str, params: Value) -> Result<Value> {
        let slots = &self.inner.slots;
        let start = self.inner.next.fetch_add(1, Ordering::Relaxed);
        let mut guard = None;
        for i in 0..slots.len() {
            if let Ok(g) = slots[(start + i) % slots.len()].try_lock() {
                guard = Some(g);
                break;
            }
        }
        let mut guard = match guard {
            Some(g) => g,
            None => slots[start % slots.len()].lock().await,
        };
        if guard.is_none() {
            *guard = Some(self.spawn().await?);
        }
        let id = self.inner.ids.fetch_add(1, Ordering::Relaxed);
        let line = serde_json::to_string(&json!({ "id": id, "method": method, "params": params })).map_err(|e| EngineError::Protocol(e.to_string()))? + "\n";
        let proc = guard.as_mut().expect("process was just spawned");
        let timeout = self.inner.config.timeout;
        let exchange = async {
            proc.stdin.write_all(line.as_bytes()).await?;
            proc.stdin.flush().await?;
            let mut out = String::new();
            let n = proc.stdout.read_line(&mut out).await?;
            Ok::<_, std::io::Error>((n, out))
        };
        let outcome = tokio::time::timeout(timeout, exchange).await;
        let reply = match outcome {
            Err(_) => Err(EngineError::Timeout(timeout)),
            Ok(Err(e)) => Err(EngineError::Process(e.to_string())),
            Ok(Ok((0, _))) => Err(EngineError::Process("engine exited".into())),
            Ok(Ok((_, out))) => serde_json::from_str::<Reply>(&out).map_err(|e| EngineError::Protocol(e.to_string())),
        };
        let reply = match reply {
            Ok(r) if r.id == Some(id) => r,
            Ok(_) => return Err(self.discard(&mut guard, EngineError::Protocol("reply id did not match the request".into()))),
            Err(e) => return Err(self.discard(&mut guard, e)),
        };
        match (reply.result, reply.error) {
            (_, Some(err)) => Err(EngineError::Rejected(err)),
            (Some(v), None) => Ok(v),
            (None, None) => Err(EngineError::Protocol("reply had neither result nor error".into())),
        }
    }

    fn discard(&self, slot: &mut Option<Proc>, e: EngineError) -> EngineError {
        if let Some(mut p) = slot.take() {
            let _ = p.child.start_kill();
        }
        tracing::warn!(error = %e, "engine process replaced");
        e
    }

    async fn typed<T: DeserializeOwned>(&self, method: &str, params: Value) -> Result<T> {
        serde_json::from_value(self.call(method, params).await?).map_err(|e| EngineError::Protocol(e.to_string()))
    }

    pub async fn ping(&self) -> Result<u32> {
        #[derive(Deserialize)]
        struct Pong {
            version: u32,
        }
        Ok(self.typed::<Pong>("ping", json!({})).await?.version)
    }

    pub async fn generate(&self, doc: &Value, migrations: Option<&Value>) -> Result<BTreeMap<String, String>> {
        #[derive(Deserialize)]
        struct Out {
            files: BTreeMap<String, String>,
        }
        Ok(self.typed::<Out>("generate", json!({ "doc": doc, "migrations": migrations })).await?.files)
    }

    pub async fn apply(&self, doc: &Value, ops: &[Value]) -> Result<Applied> {
        self.typed("apply", json!({ "doc": doc, "ops": ops })).await
    }

    pub async fn validate(&self, doc: &Value, env: Option<&str>) -> Result<Value> {
        self.call("validate", json!({ "doc": doc, "env": env })).await
    }

    pub async fn describe(&self) -> Result<Value> {
        self.call("describe", json!({})).await
    }

    pub async fn catalog(&self) -> Result<Value> {
        self.call("catalog", json!({})).await
    }

    pub async fn templates(&self) -> Result<Value> {
        self.call("templates", json!({})).await
    }

    pub async fn template(&self, id: &str, name: Option<&str>) -> Result<Value> {
        #[derive(Deserialize)]
        struct Out {
            doc: Value,
        }
        Ok(self.typed::<Out>("template", json!({ "id": id, "name": name })).await?.doc)
    }
}

#[derive(Debug, Deserialize)]
pub struct Applied {
    pub doc: Value,
    pub results: Vec<Value>,
}

#[cfg(test)]
mod tests {
    use super::*;

    fn engine() -> Option<Engine> {
        let script = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../packages/core/dist/tessery-engine.mjs");
        if !script.is_file() {
            eprintln!("skipping: build the engine with `npm run build:engine` in packages/core");
            return None;
        }
        Some(Engine::new(EngineConfig { node: "node".into(), script, processes: 2, timeout: Duration::from_secs(20) }).unwrap())
    }

    #[tokio::test]
    async fn generates_edits_and_reports_errors() {
        let Some(engine) = engine() else { return };
        assert_eq!(engine.ping().await.unwrap(), 1);

        let doc = engine.template("blank", Some("demo")).await.unwrap();
        assert_eq!(doc["name"], "demo");
        let applied = engine
            .apply(&doc, &[json!({ "op": "addNode", "args": { "techId": "service", "x": 0, "y": 0, "name": "api", "config": { "language": "Go" } } })])
            .await
            .unwrap();
        assert_eq!(applied.doc["nodes"].as_array().unwrap().len(), 1);
        assert!(applied.results[0].is_string(), "addNode returns the new node id");

        let files = engine.generate(&applied.doc, None).await.unwrap();
        assert!(files.contains_key("services/api/go.mod"), "{:?}", files.keys().collect::<Vec<_>>());

        let err = engine.apply(&doc, &[json!({ "op": "dropDatabase" })]).await.unwrap_err();
        assert!(matches!(err, EngineError::Rejected(m) if m.contains("unknown operation")));

        let mut calls = tokio::task::JoinSet::new();
        for _ in 0..8 {
            let e = engine.clone();
            calls.spawn(async move { e.generate(&doc_with_service(), None).await });
        }
        while let Some(r) = calls.join_next().await {
            assert!(r.unwrap().unwrap().contains_key("services/api/go.mod"), "concurrent calls share the pool");
        }
    }

    fn doc_with_service() -> Value {
        json!({
            "id": "p1", "name": "demo", "description": "", "icon": "o", "edges": [], "apis": {}, "databases": {}, "pages": [], "environments": [],
            "observability": { "metrics": "prometheus", "logs": "loki", "traces": "tempo", "sampling": 1, "slos": [], "alerts": [] },
            "nodes": [{ "id": "n1", "techId": "service", "name": "api", "x": 0, "y": 0, "replicas": 1, "config": { "language": "Go", "port": 8080 }, "placement": { "providerId": "aws", "mode": "managed" } }]
        })
    }
}
