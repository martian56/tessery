use crate::jobs::Ctx;
use anyhow::{Context, Result, anyhow, bail};
use tessery_db::delivery::{self as db, Release};
use rand::Rng;
use serde::Deserialize;
use serde_json::{Value, json};
use std::process::Stdio;
use std::time::Duration;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use uuid::Uuid;

use tessery_core::runner::{DOCKERFILE, SCRIPT};
const DEPLOY_TIMEOUT: Duration = Duration::from_secs(30 * 60);
const MAX_LINE: usize = 4000;

#[derive(Clone, Debug)]
pub struct RunnerConfig {
    pub docker: String,
    pub socket: String,
    pub telemetry_url: Option<String>,
    pub public_url: Option<String>,
}

fn url_var(name: &str) -> Option<String> {
    std::env::var(name).ok().map(|u| u.trim().trim_end_matches('/').to_owned()).filter(|u| !u.is_empty())
}

impl RunnerConfig {
    pub fn from_env() -> Self {
        Self {
            docker: std::env::var("TESSERY_DOCKER_BIN").unwrap_or_else(|_| "docker".into()),
            socket: std::env::var("TESSERY_DOCKER_SOCKET").unwrap_or_else(|_| "/var/run/docker.sock".into()),
            telemetry_url: url_var("TESSERY_TELEMETRY_URL"),
            public_url: url_var("TESSERY_PUBLIC_URL"),
        }
    }

    fn image(&self) -> String {
        tessery_core::runner::image()
    }
}

#[derive(Deserialize)]
struct Plan {
    target: Value,
}

pub(crate) struct Log {
    tx: mpsc::UnboundedSender<String>,
    writer: tokio::task::JoinHandle<()>,
}

impl Log {
    pub(crate) fn start(db: tessery_db::PgPool, release: Option<Uuid>) -> Self {
        let (tx, mut rx) = mpsc::unbounded_channel::<String>();
        let Some(release) = release else {
            let writer = tokio::spawn(async move {
                while let Some(line) = rx.recv().await {
                    tracing::info!(target: "tessery_worker::runner", "{line}");
                }
            });
            return Self { tx, writer };
        };
        let writer = tokio::spawn(async move {
            let mut batch = Vec::new();
            loop {
                let more = tokio::select! {
                    line = rx.recv() => match line {
                        Some(l) => { batch.push(l); true }
                        None => false,
                    },
                    _ = tokio::time::sleep(Duration::from_millis(300)), if !batch.is_empty() => true,
                };
                if batch.len() >= 200 || !more || rx.is_empty() {
                    if let Err(e) = db::append_logs(&db, release, &batch).await {
                        tracing::warn!(error = %e, %release, "could not store deploy log lines");
                    }
                    batch.clear();
                }
                if !more {
                    break;
                }
            }
        });
        Self { tx, writer }
    }

    pub(crate) fn line(&self, s: impl Into<String>) {
        let mut s: String = s.into();
        if s.len() > MAX_LINE {
            let mut cut = MAX_LINE;
            while !s.is_char_boundary(cut) {
                cut -= 1;
            }
            s.truncate(cut);
        }
        let _ = self.tx.send(s);
    }

    fn step(&self, s: &str) {
        self.line(format!("::step::{s}"));
    }

    async fn close(self) {
        drop(self.tx);
        let _ = self.writer.await;
    }
}

pub async fn deploy(ctx: &Ctx, release_id: Uuid) -> Result<()> {
    let release = db::get_release(&ctx.db, release_id).await?;
    if !db::start_deploy(&ctx.db, release_id).await? {
        tracing::info!(%release_id, "release is no longer queued, skipping");
        return Ok(());
    }
    let log = Log::start(ctx.db.clone(), Some(release_id));
    log.step(&format!("Deploying checkpoint {} to {}", release.checkpoint_seq, release.env_key));
    let outcome = match tokio::time::timeout(DEPLOY_TIMEOUT, run(ctx, &release, &log)).await {
        Ok(r) => r,
        Err(_) => {
            let _ = docker(&ctx.runner, &["rm", "-f", &format!("tessery-deploy-{}", release.id)]).await;
            Err(anyhow!("the deploy took longer than 30 minutes"))
        }
    };
    let (error, endpoints) = match outcome {
        Ok(endpoints) => (None, Value::Array(endpoints)),
        Err(e) => {
            log.line(format!("::error::{e:#}"));
            let error = match rollback(ctx, &release, &log).await {
                Some(outcome) => format!("{e:#}; {outcome}"),
                None => format!("{e:#}"),
            };
            (Some(error), json!([]))
        }
    };
    log.close().await;

    let mut tx = ctx.db.begin().await?;
    db::lock_project(&mut tx, release.project_id).await?;
    db::finish_deploy(&mut tx, &release, error.as_deref(), &endpoints).await?;
    tx.commit().await?;
    match &error {
        None => tracing::info!(%release_id, env = %release.env_key, "deploy finished"),
        Some(e) => tracing::warn!(%release_id, env = %release.env_key, error = %e, "deploy failed"),
    }
    if error.is_none() {
        crate::jobs::after_release(ctx, release.project_id).await;
    }
    Ok(())
}

async fn run(ctx: &Ctx, r: &Release, log: &Log) -> Result<Vec<Value>> {
    let cfg = &ctx.runner;
    let repo = ctx.repos.open(r.project_id).await.context("opening the project repository")?;
    let plan_raw = repo
        .read_file(&r.commit_sha, &format!("deploy/{}/plan.json", r.env_key))
        .await
        .map_err(|_| anyhow!("checkpoint {} has no deploy plan for {}; create a new checkpoint", r.checkpoint_seq, r.env_key))?;
    let plan: Plan = serde_json::from_slice(&plan_raw).context("reading the deploy plan")?;
    let kind = plan.target.get("kind").and_then(Value::as_str).unwrap_or("git");

    let required = tessery_core::runner::required_secrets(&serde_json::from_slice(&plan_raw).context("reading the deploy plan")?);
    let mut values = resolve_secrets(ctx, r, &required).await?;
    let server = server_connection(ctx, r.project_id, &plan.target).await?;
    if let Some((_, extra)) = &server {
        values.retain(|(k, _)| k != "SSH_PRIVATE_KEY" && k != "SSH_KNOWN_HOSTS");
        values.extend(extra.iter().cloned());
    }
    let host_env = server.as_ref().map(|(address, _)| format!("TESSERY_DOCKER_HOST={address}")).unwrap_or_else(|| "TESSERY_DOCKER_HOST=".into());
    let remote = server
        .as_ref()
        .map(|(address, _)| address.as_str())
        .or_else(|| plan.target.get("host").and_then(Value::as_str))
        .filter(|h| kind == "docker" && h.starts_with("ssh://"));
    let base = if remote.is_some() { ctx.runner.public_url.as_deref() } else { ctx.runner.telemetry_url.as_deref() };
    match (base, remote) {
        (Some(url), _) if ctx.secret_key.is_some() => log.line(format!("Traces go to {url}")),
        (None, Some(host)) => log.line(format!("Traces are off: services on {host} need TESSERY_PUBLIC_URL to reach Tessery")),
        _ => log.line("Traces are off: set TESSERY_TELEMETRY_URL and TESSERY_SECRET_KEY on the worker to collect them"),
    }
    values.extend(telemetry(ctx, base, r.project_id, &r.env_key));
    if kind == "docker" {
        let plan_value: Value = serde_json::from_slice(&plan_raw).unwrap_or_default();
        if let Err(e) = crate::dns::publish(ctx, r.project_id, &r.env_key, &plan_value, remote, log).await {
            log.line(format!("DNS: {e:#}"));
        }
    }
    ensure_runner_image(cfg, log).await?;

    let name = format!("tessery-deploy-{}", r.id);
    let tag = &r.commit_sha[..12.min(r.commit_sha.len())];
    let _ = docker(cfg, &["rm", "-f", &name]).await;
    let volume = format!("{}:/var/run/docker.sock", cfg.socket);
    docker(
        cfg,
        &[
            "create", "--name", &name, "--label", "tessery.release", "-v", &volume,
            "-e", &format!("TESSERY_ENV={}", r.env_key), "-e", &format!("TESSERY_TAG={tag}"), "-e", &format!("TESSERY_RELEASE={}", r.id), "-e", &host_env,
            &cfg.image(), "sh", "/work/.tessery/run.sh",
        ],
    )
    .await
    .context("creating the runner container")?;
    let result = async {
        log.step("Copying checkpoint files");
        let files = repo.archive(&r.commit_sha).await?;
        copy_in(cfg, &name, &files).await?;
        copy_in(cfg, &name, &private_files(&values, kind)?).await?;
        stream(cfg, &name, log).await
    }
    .await;
    let _ = docker(cfg, &["rm", "-f", &name]).await;
    result
}

async fn rollback(ctx: &Ctx, failed: &Release, log: &Log) -> Option<String> {
    let repo = ctx.repos.open(failed.project_id).await.ok()?;
    let raw = repo.read_file(&failed.commit_sha, &format!("deploy/{}/plan.json", failed.env_key)).await.ok()?;
    let plan: Value = serde_json::from_slice(&raw).ok()?;
    if plan.get("autoRollback").and_then(Value::as_bool) != Some(true) {
        return None;
    }
    let head = db::heads(&ctx.db, failed.project_id).await.ok()?.into_iter().find(|h| h.env_key == failed.env_key)?;
    if head.checkpoint_id == failed.checkpoint_id {
        return None;
    }
    let previous = db::get_checkpoint(&ctx.db, failed.project_id, head.checkpoint_id).await.ok()?;
    log.step(&format!("Rolling back to checkpoint {}", previous.seq));
    let mut target = failed.clone();
    target.checkpoint_id = previous.id;
    target.checkpoint_seq = previous.seq;
    target.commit_sha = previous.commit_sha;
    Some(match run(ctx, &target, log).await {
        Ok(_) => format!("rolled back to checkpoint {}", previous.seq),
        Err(e) => {
            log.line(format!("::error::{e:#}"));
            format!("rolling back to checkpoint {} also failed: {e:#}", previous.seq)
        }
    })
}

pub struct TeardownRequest<'a> {
    pub project: Uuid,
    pub env: &'a str,
    pub plan: &'a Value,
    pub connection: &'a [(String, Vec<u8>)],
    pub saved: Option<&'a tessery_mq::ServerConnection>,
    pub org: Option<Uuid>,
    pub destroy: bool,
}

pub async fn teardown(ctx: &Ctx, req: TeardownRequest<'_>) -> Result<()> {
    let TeardownRequest { project, env, plan, connection, saved, org, destroy } = req;
    let kind = plan.pointer("/target/kind").and_then(Value::as_str).unwrap_or("git");
    if kind == "git" {
        return Ok(());
    }
    let cfg = &ctx.runner;
    let log = Log::start(ctx.db.clone(), None);
    if destroy {
        let org = match org {
            Some(o) => Some(o),
            None => tessery_db::servers::org_of_project(&ctx.db, project).await.ok(),
        };
        if let Some(org) = org
            && let Err(e) = crate::dns::unpublish(ctx, org, project, env, &log).await
        {
            tracing::warn!(%project, env, error = %e, "removing DNS records failed");
        }
    }
    let mut values = Vec::new();
    for (name, cipher) in connection {
        let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker"))?;
        values.push((name.clone(), String::from_utf8(key.decrypt(cipher)?)?));
    }
    let server = match saved {
        Some(s) => Some(decrypt_server(ctx, s)?),
        None => server_connection(ctx, project, &plan.get("target").cloned().unwrap_or(Value::Null)).await?,
    };
    let host_env = match server {
        Some((address, extra)) => {
            values.retain(|(k, _)| k != "SSH_PRIVATE_KEY" && k != "SSH_KNOWN_HOSTS");
            values.extend(extra);
            format!("TESSERY_DOCKER_HOST={address}")
        }
        None => "TESSERY_DOCKER_HOST=".into(),
    };
    ensure_runner_image(cfg, &log).await?;
    let name = format!("tessery-teardown-{project}-{env}");
    let _ = docker(cfg, &["rm", "-f", &name]).await;
    let volume = format!("{}:/var/run/docker.sock", cfg.socket);
    let action = if destroy { "TESSERY_ACTION=destroy" } else { "TESSERY_ACTION=stop" };
    docker(cfg, &["create", "--name", &name, "-v", &volume, "-e", action, "-e", &format!("TESSERY_ENV={env}"), "-e", "TESSERY_TAG=none", "-e", &host_env, &cfg.image(), "sh", "/work/.tessery/run.sh"]).await?;
    let result = async {
        let mut b = tar::Builder::new(Vec::new());
        let body = serde_json::to_vec(plan)?;
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(0o644);
        h.set_cksum();
        b.append_data(&mut h, format!("deploy/{env}/plan.json"), body.as_slice())?;
        copy_in(cfg, &name, &b.into_inner()?).await?;
        copy_in(cfg, &name, &private_files(&values, kind)?).await?;
        stream(cfg, &name, &log).await
    }
    .await;
    let _ = docker(cfg, &["rm", "-f", &name]).await;
    log.close().await;
    result.map(drop)
}

async fn server_connection(ctx: &Ctx, project: Uuid, target: &Value) -> Result<Option<(String, Vec<(String, String)>)>> {
    let Some(id) = target.get("server").and_then(Value::as_str) else { return Ok(None) };
    let id: Uuid = id.parse().context("the environment names an invalid server id")?;
    let org = tessery_db::servers::org_of_project(&ctx.db, project).await?;
    let creds = tessery_db::servers::credentials(&ctx.db, org, id)
        .await
        .map_err(|_| anyhow!("the server this environment deploys to was removed; pick another one in the environment settings"))?;
    decrypt_server(ctx, &tessery_mq::ServerConnection { address: creds.address, private_key: creds.private_key, known_hosts: creds.known_hosts }).map(Some)
}

fn decrypt_server(ctx: &Ctx, s: &tessery_mq::ServerConnection) -> Result<(String, Vec<(String, String)>)> {
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker, so server keys cannot be read"))?;
    let pem = String::from_utf8(key.decrypt(&s.private_key)?).context("a stored server key is not UTF-8")?;
    let mut values = vec![("SSH_PRIVATE_KEY".to_owned(), pem)];
    if !s.known_hosts.trim().is_empty() {
        values.push(("SSH_KNOWN_HOSTS".to_owned(), s.known_hosts.clone()));
    }
    Ok((s.address.clone(), values))
}

fn telemetry(ctx: &Ctx, base: Option<&str>, project: Uuid, env: &str) -> [(String, String); 2] {
    let on = base.zip(ctx.secret_key.as_ref());
    let endpoint = on.map(|(url, _)| format!("{url}/api/otlp/{project}/{env}")).unwrap_or_default();
    let headers = on.map(|(_, key)| format!("authorization=Bearer {}", tessery_core::runner::telemetry_token(key, project, env))).unwrap_or_default();
    [("TESSERY_OTLP_ENDPOINT".into(), endpoint), ("TESSERY_OTLP_HEADERS".into(), headers)]
}

async fn resolve_secrets(ctx: &Ctx, r: &Release, needed: &[tessery_core::runner::RequiredSecret]) -> Result<Vec<(String, String)>> {
    if needed.is_empty() {
        return Ok(Vec::new());
    }
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker, so environment secrets cannot be read"))?;
    let stored = db::secrets(&ctx.db, r.project_id, &r.env_key).await?;
    for secret in needed {
        if secret.generate && !stored.iter().any(|s| s.name == secret.name) {
            let cipher = key.encrypt(password().as_bytes());
            db::insert_generated_secret(&ctx.db, r.project_id, &r.env_key, &secret.name, &cipher).await?;
        }
    }
    let stored = db::secrets(&ctx.db, r.project_id, &r.env_key).await?;
    let names: Vec<String> = stored.iter().map(|s| s.name.clone()).collect();
    let missing = tessery_core::runner::missing_secrets(needed, &names);
    if !missing.is_empty() {
        bail!("set these secrets for {} first: {}", r.env_key, missing.join(", "));
    }
    stored
        .into_iter()
        .map(|s| Ok((s.name, String::from_utf8(key.decrypt(&s.cipher)?).context("a stored secret is not UTF-8")?)))
        .collect()
}

fn password() -> String {
    const CHARS: &[u8] = b"ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
    let mut bytes = [0u8; 32];
    rand::rng().fill_bytes(&mut bytes);
    bytes.iter().map(|b| CHARS[*b as usize % CHARS.len()] as char).collect()
}

fn private_files(values: &[(String, String)], kind: &str) -> Result<Vec<u8>> {
    let mut raw = String::new();
    let mut quoted = String::new();
    let mut files = Vec::new();
    for (k, v) in values {
        if let Some((_, file)) = tessery_core::runner::CONNECTION_FILES.iter().find(|(n, _)| n == k) {
            if (*file == "kubeconfig") == (kind == "kubernetes") {
                let mut body = v.replace("\r\n", "\n");
                if !body.ends_with('\n') {
                    body.push('\n');
                }
                files.push((format!(".tessery/{file}"), body));
            }
            continue;
        }
        if v.contains('\n') {
            bail!("secret {k} spans several lines; only KUBECONFIG, SSH_PRIVATE_KEY and SSH_KNOWN_HOSTS may");
        }
        raw.push_str(&format!("{k}={v}\n"));
        quoted.push_str(&format!("{k}='{}'\n", v.replace('\'', "'\\''")));
    }
    let mut b = tar::Builder::new(Vec::new());
    let mut add = |path: &str, body: &[u8], mode: u32| -> std::io::Result<()> {
        let mut h = tar::Header::new_gnu();
        h.set_size(body.len() as u64);
        h.set_mode(mode);
        h.set_cksum();
        b.append_data(&mut h, path, body)
    };
    add(".tessery/run.sh", SCRIPT.replace("\r\n", "\n").as_bytes(), 0o755)?;
    add(".tessery/secrets.env", raw.as_bytes(), 0o600)?;
    add(".tessery/compose.env", quoted.as_bytes(), 0o600)?;
    for (path, body) in &files {
        add(path, body.as_bytes(), 0o600)?;
    }
    Ok(b.into_inner()?)
}

pub(crate) async fn ensure_runner_image(cfg: &RunnerConfig, log: &Log) -> Result<()> {
    let image = cfg.image();
    if docker(cfg, &["image", "inspect", &image]).await.is_ok() {
        return Ok(());
    }
    log.step(&format!("Building the runner image {image} (first deploy only)"));
    let mut child = Command::new(&cfg.docker)
        .args(["build", "--progress=plain", "-t", &image, "-"])
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()
        .context("starting docker; is Docker installed and running?")?;
    let mut stdin = child.stdin.take().expect("piped");
    stdin.write_all(DOCKERFILE.as_bytes()).await?;
    drop(stdin);
    let status = pump(child, log).await?;
    if !status.success() {
        bail!("building the runner image failed");
    }
    Ok(())
}

async fn copy_in(cfg: &RunnerConfig, container: &str, tar: &[u8]) -> Result<()> {
    let mut child = Command::new(&cfg.docker)
        .args(["cp", "-", &format!("{container}:/work")])
        .stdin(Stdio::piped())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let mut stdin = child.stdin.take().expect("piped");
    stdin.write_all(tar).await?;
    drop(stdin);
    let out = child.wait_with_output().await?;
    if !out.status.success() {
        bail!("copying files into the runner failed: {}", String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(())
}

async fn stream(cfg: &RunnerConfig, container: &str, log: &Log) -> Result<Vec<Value>> {
    let child = Command::new(&cfg.docker)
        .args(["start", "-a", container])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true)
        .spawn()?;
    let endpoints = std::sync::Mutex::new(Vec::new());
    let status = pump_with(child, log, |line| {
        if let Some(e) = line.strip_prefix("::endpoint::") {
            if let Ok(v) = serde_json::from_str::<Value>(e) {
                endpoints.lock().expect("not poisoned").push(v);
            }
            return false;
        }
        true
    })
    .await?;
    if !status.success() {
        bail!("the runner exited with {}", status.code().map_or("a signal".into(), |c| format!("code {c}")));
    }
    Ok(endpoints.into_inner().expect("not poisoned"))
}

async fn pump(child: tokio::process::Child, log: &Log) -> Result<std::process::ExitStatus> {
    pump_with(child, log, |_| true).await
}

async fn pump_with(mut child: tokio::process::Child, log: &Log, keep: impl Fn(&str) -> bool) -> Result<std::process::ExitStatus> {
    let mut out = BufReader::new(child.stdout.take().expect("piped")).lines();
    let mut err = BufReader::new(child.stderr.take().expect("piped")).lines();
    let (mut out_done, mut err_done) = (false, false);
    while !(out_done && err_done) {
        tokio::select! {
            l = out.next_line(), if !out_done => match l? { Some(l) => if keep(&l) { log.line(l) }, None => out_done = true },
            l = err.next_line(), if !err_done => match l? { Some(l) => if keep(&l) { log.line(l) }, None => err_done = true },
        }
    }
    Ok(child.wait().await?)
}

async fn docker(cfg: &RunnerConfig, args: &[&str]) -> Result<String> {
    let out = Command::new(&cfg.docker).args(args).stdin(Stdio::null()).output().await.context("running docker; is Docker installed and running?")?;
    if !out.status.success() {
        bail!("docker {} failed: {}", args.first().unwrap_or(&""), String::from_utf8_lossy(&out.stderr).trim());
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}
