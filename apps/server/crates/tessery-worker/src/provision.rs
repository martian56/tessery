use crate::deploy::{Log, RunnerConfig, ensure_runner_image};
use crate::jobs::Ctx;
use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Map, Value};
use std::process::Stdio;
use std::time::{Duration, Instant};
use tessery_cloud::MachineState;
use tessery_db::servers;
use tokio::process::Command;
use uuid::Uuid;

const START_TIMEOUT: Duration = Duration::from_secs(600);
const SETUP_TIMEOUT: Duration = Duration::from_secs(900);

pub async fn provision(ctx: &Ctx, server_id: Uuid) -> Result<()> {
    let (server, _) = servers::by_id(&ctx.db, server_id).await?;
    if server.status == "ready" {
        return Ok(());
    }
    if let Err(e) = run(ctx, server_id).await {
        tracing::warn!(%server_id, error = %e, "creating a server failed");
        servers::set_status(&ctx.db, server_id, "failed", &format!("{e:#}")).await?;
    }
    Ok(())
}

async fn run(ctx: &Ctx, server_id: Uuid) -> Result<()> {
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker"))?;
    let (server, creds) = servers::by_id(&ctx.db, server_id).await?;
    let integration = server.integration_id.ok_or_else(|| anyhow!("the cloud account used to create this server was disconnected"))?;
    let resource = server.resource_id.clone().ok_or_else(|| anyhow!("the server has no machine at the provider"))?;
    let (provider, cipher) = tessery_db::integrations::secret(&ctx.db, server.org_id, integration).await.context("reading the cloud account")?;
    let fields: Map<String, Value> = serde_json::from_slice(&key.decrypt(&cipher)?).context("reading the cloud account")?;
    let apis = tessery_cloud::endpoints_from_env();

    let started = Instant::now();
    let ip = loop {
        match tessery_cloud::machine_state(&provider, &fields, &apis, &resource).await.map_err(|e| anyhow!(e))? {
            MachineState::Running { ip } => break ip,
            MachineState::Gone => bail!("the machine was deleted at the provider before it started"),
            MachineState::Starting => {}
        }
        if started.elapsed() > START_TIMEOUT {
            bail!("the provider did not start the machine within 10 minutes");
        }
        tokio::time::sleep(Duration::from_secs(5)).await;
    };

    let address = format!("ssh://deploy@{ip}");
    servers::set_address(&ctx.db, server_id, &address).await?;
    servers::set_status(&ctx.db, server_id, "configuring", &format!("Running at {ip}. Installing Docker, which takes a few minutes")).await?;

    let pem = String::from_utf8(key.decrypt(&creds.private_key)?).context("the server key is not UTF-8")?;
    ensure_runner_image(&ctx.runner, &Log::start(ctx.db.clone(), None)).await?;
    let started = Instant::now();
    let mut last: String;
    loop {
        match remote_check(&ctx.runner, &address, &pem).await? {
            Ok(stdout) => {
                let mut check = tessery_core::runner::parse_check(&stdout);
                let pin = check.as_object_mut().and_then(|o| o.remove("knownHosts")).and_then(|k| k.as_str().map(str::to_owned)).filter(|k| !k.is_empty());
                let used = servers::Credentials { address: address.clone(), private_key: creds.private_key.clone(), known_hosts: String::new() };
                servers::record_check(&ctx.db, server_id, &used, &check, pin.as_deref()).await?;
                servers::set_status(&ctx.db, server_id, "ready", "").await?;
                tracing::info!(%server_id, %address, "server is ready");
                return Ok(());
            }
            Err(stderr) => last = tessery_core::runner::explain_ssh(&stderr),
        }
        if started.elapsed() > SETUP_TIMEOUT {
            bail!("the machine runs at {ip}, but Docker was not ready within 15 minutes: {last}");
        }
        tokio::time::sleep(Duration::from_secs(10)).await;
    }
}

async fn remote_check(cfg: &RunnerConfig, address: &str, pem: &str) -> Result<std::result::Result<String, String>> {
    use base64::Engine as _;
    let key = base64::engine::general_purpose::STANDARD.encode(pem.replace("\r\n", "\n").trim_end().to_owned() + "\n");
    let script = format!("{}{}", tessery_core::runner::SSH_SETUP, tessery_core::runner::SERVER_CHECK);
    let out = Command::new(&cfg.docker)
        .args(["run", "--rm", "-e", "SSH_KEY_B64", "-e", "KNOWN_B64", "-e", "REMOTE_DOCKER_HOST", &tessery_core::runner::image(), "sh", "-c", &script])
        .env("SSH_KEY_B64", key)
        .env("KNOWN_B64", "")
        .env("REMOTE_DOCKER_HOST", address)
        .stdin(Stdio::null())
        .output()
        .await
        .context("running docker; is Docker installed and running?")?;
    Ok(if out.status.success() { Ok(String::from_utf8_lossy(&out.stdout).into_owned()) } else { Err(String::from_utf8_lossy(&out.stderr).into_owned()) })
}
