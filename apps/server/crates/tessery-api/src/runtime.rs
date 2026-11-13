use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use serde_json::Value;
use std::process::Stdio;
use std::time::Duration;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

pub struct Engine {
    pub url: Option<String>,
    pub ssh_key: Option<String>,
    pub known_hosts: Option<String>,
}

pub enum Where {
    Docker { stack: String, host: Engine },
    Kubernetes { namespace: String, kubeconfig: String },
}

pub struct Running {
    pub place: Where,
    pub plan: Value,
}

fn docker_bin() -> String {
    std::env::var("TESSERY_DOCKER_BIN").unwrap_or_else(|_| "docker".into())
}

pub async fn locate(state: &AppState, project: Uuid, env: &str) -> ApiResult<Running> {
    let head = tessery_db::delivery::heads(&state.db, project).await?.into_iter().find(|h| h.env_key == env).ok_or_else(|| ApiError::Conflict(format!("nothing is deployed to {env} yet")))?;
    let checkpoint = tessery_db::delivery::get_checkpoint(&state.db, project, head.checkpoint_id).await?;
    let repo = state.repos.open(project).await.map_err(|e| ApiError::Internal(e.into()))?;
    let raw = repo.read_file(&checkpoint.commit_sha, &format!("deploy/{env}/plan.json")).await.map_err(|_| ApiError::Conflict(format!("{env} runs a checkpoint without a deploy plan")))?;
    let plan: Value = serde_json::from_slice(&raw).map_err(|e| ApiError::Internal(e.into()))?;
    let kind = plan.pointer("/target/kind").and_then(Value::as_str).unwrap_or("git");
    let place = match kind {
        "docker" => {
            let project_slug = plan["project"].as_str().unwrap_or_default();
            let stack = format!("{project_slug}-{env}").to_lowercase().replace('.', "-");
            let url = plan.pointer("/target/host").and_then(Value::as_str).filter(|h| !h.is_empty()).map(str::to_owned);
            let server = plan.pointer("/target/server").and_then(Value::as_str).and_then(|s| s.parse::<Uuid>().ok());
            let mut host = Engine { url, ssh_key: None, known_hosts: None };
            if let Some(server) = server {
                host = crate::routes::servers::engine_for(state, project, server).await?;
            } else if host.url.as_deref().is_some_and(|u| u.starts_with("ssh://")) {
                host.ssh_key = Some(secret(state, project, env, "SSH_PRIVATE_KEY").await?.ok_or_else(|| ApiError::Conflict(format!("{env} has no SSH_PRIVATE_KEY secret")))?);
                host.known_hosts = secret(state, project, env, "SSH_KNOWN_HOSTS").await?;
            }
            Where::Docker { stack, host }
        }
        "kubernetes" => {
            let kubeconfig = secret(state, project, env, "KUBECONFIG").await?.ok_or_else(|| ApiError::Conflict(format!("{env} has no KUBECONFIG secret")))?;
            Where::Kubernetes { namespace: plan["namespace"].as_str().unwrap_or_default().to_owned(), kubeconfig }
        }
        other => return Err(ApiError::Conflict(format!("{env} deploys with `{other}`, so Tessery cannot look inside it"))),
    };
    Ok(Running { place, plan })
}

async fn secret(state: &AppState, project: Uuid, env: &str, name: &str) -> ApiResult<Option<String>> {
    let Some(s) = tessery_db::delivery::secrets(&state.db, project, env).await?.into_iter().find(|s| s.name == name) else { return Ok(None) };
    let key = state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("TESSERY_SECRET_KEY is not set".into()))?;
    let plain = key.decrypt(&s.cipher).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Some(String::from_utf8(plain).map_err(|e| ApiError::Internal(e.into()))?))
}

pub struct Output {
    pub ok: bool,
    pub stdout: String,
    pub stderr: String,
}

async fn exec(program: &str, args: &[String], envs: &[(&str, &str)], stdin: Option<&[u8]>, timeout: Duration) -> ApiResult<Output> {
    let mut cmd = Command::new(program);
    cmd.args(args).stdin(if stdin.is_some() { Stdio::piped() } else { Stdio::null() }).stdout(Stdio::piped()).stderr(Stdio::piped()).kill_on_drop(true);
    for (k, v) in envs {
        cmd.env(k, v);
    }
    let mut child = cmd.spawn().map_err(|e| ApiError::Internal(anyhow::anyhow!("could not run {program}: {e}")))?;
    if let (Some(input), Some(mut pipe)) = (stdin, child.stdin.take()) {
        pipe.write_all(input).await.map_err(|e| ApiError::Internal(e.into()))?;
        drop(pipe);
    }
    let out = tokio::time::timeout(timeout, child.wait_with_output()).await.map_err(|_| ApiError::Conflict("the environment did not answer in time".into()))?.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Output { ok: out.status.success(), stdout: String::from_utf8_lossy(&out.stdout).into_owned(), stderr: String::from_utf8_lossy(&out.stderr).into_owned() })
}


pub async fn ensure_runner() -> ApiResult<()> {
    let image = tessery_core::runner::image();
    if exec(&docker_bin(), &["image".into(), "inspect".into(), image.clone()], &[], None, Duration::from_secs(20)).await?.ok {
        return Ok(());
    }
    let dir = std::env::temp_dir().join(format!("tessery-runner-{}", std::process::id()));
    std::fs::create_dir_all(&dir).map_err(|e| ApiError::Internal(e.into()))?;
    std::fs::write(dir.join("Dockerfile"), tessery_core::runner::DOCKERFILE).map_err(|e| ApiError::Internal(e.into()))?;
    let out = exec(&docker_bin(), &["build".into(), "-q".into(), "-t".into(), image, dir.to_string_lossy().into_owned()], &[], None, Duration::from_secs(600)).await;
    let _ = std::fs::remove_dir_all(&dir);
    let out = out?;
    if !out.ok {
        return Err(ApiError::Conflict(format!("could not build the runner image: {}", out.stderr.trim())));
    }
    Ok(())
}

pub async fn remote_script(host: &Engine, script: &str, args: &[String], stdin: Option<&[u8]>, timeout: Duration) -> ApiResult<Output> {
    use base64::Engine as _;
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.encode(s.replace("\r\n", "\n").trim_end().to_owned() + "\n");
    let key = host.ssh_key.as_deref().map(b64).unwrap_or_default();
    let known = host.known_hosts.as_deref().filter(|k| !k.trim().is_empty()).map(b64).unwrap_or_default();
    let url = host.url.clone().unwrap_or_default();
    ensure_runner().await?;
    let mut full: Vec<String> = ["run", "--rm", "-i", "-e", "SSH_KEY_B64", "-e", "KNOWN_B64", "-e", "REMOTE_DOCKER_HOST"].map(str::to_owned).to_vec();
    full.push(tessery_core::runner::image());
    full.extend(["sh".to_owned(), "-c".to_owned(), format!("{}{script}", tessery_core::runner::SSH_SETUP), "remote".to_owned()]);
    full.extend(args.iter().cloned());
    exec(&docker_bin(), &full, &[("SSH_KEY_B64", &key), ("KNOWN_B64", &known), ("REMOTE_DOCKER_HOST", &url)], stdin, timeout).await
}

pub async fn docker(host: &Engine, args: &[String], stdin: Option<&[u8]>) -> ApiResult<Output> {
    if host.ssh_key.is_none() {
        let envs: Vec<(&str, &str)> = host.url.as_deref().map(|h| vec![("DOCKER_HOST", h)]).unwrap_or_default();
        return exec(&docker_bin(), args, &envs, stdin, Duration::from_secs(30)).await;
    }
    remote_script(host, "exec docker \"$@\"", args, stdin, Duration::from_secs(45)).await
}

pub async fn kubectl(kubeconfig: &str, args: &[String], stdin: Option<&[u8]>) -> ApiResult<Output> {
    use base64::Engine;
    let encoded = base64::engine::general_purpose::STANDARD.encode(kubeconfig);
    let mut full: Vec<String> = vec!["run".into(), "--rm".into(), "-i".into(), "-e".into(), "KUBECONFIG_B64".into(), tessery_core::runner::image()];
    full.extend(["sh", "-c", "echo \"$KUBECONFIG_B64\" | base64 -d > /tmp/kubeconfig && KUBECONFIG=/tmp/kubeconfig exec kubectl \"$@\"", "kubectl"].map(str::to_owned));
    full.extend(args.iter().cloned());
    exec(&docker_bin(), &full, &[("KUBECONFIG_B64", &encoded)], stdin, Duration::from_secs(45)).await
}

pub async fn containers(stack: &str, host: &Engine, service: Option<&str>) -> ApiResult<Vec<Value>> {
    let mut args: Vec<String> = vec!["ps".into(), "-a".into(), "--no-trunc".into(), "--filter".into(), format!("label=com.docker.compose.project={stack}"), "--format".into(), "{{json .}}".into()];
    if let Some(s) = service {
        args.splice(2..2, ["--filter".to_owned(), format!("label=com.docker.compose.service={s}")]);
    }
    let out = docker(host, &args, None).await?;
    if !out.ok {
        return Err(ApiError::Conflict(format!("docker: {}", out.stderr.trim())));
    }
    Ok(out.stdout.lines().filter_map(|l| serde_json::from_str(l).ok()).collect())
}

pub fn label(c: &Value, key: &str) -> Option<String> {
    c["Labels"].as_str()?.split(',').find_map(|kv| kv.strip_prefix(&format!("{key}=")).map(str::to_owned))
}
