use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::routes::dto::{OK, Ok};
use crate::runtime::{self, Engine};
use crate::state::AppState;
use tessery_core::Permission as P;
use tessery_db::servers::{self as db, NewServer, ServerUpdate};
use axum::Json;
use axum::extract::{Path, Query, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use time::OffsetDateTime;
use utoipa::{IntoParams, ToSchema};
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerUse {
    pub project_id: Uuid,
    pub project: String,
    pub env: String,
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerDto {
    pub id: Uuid,
    pub name: String,
    /// `ssh://user@host` or `ssh://user@host:port`.
    pub address: String,
    /// Add this line to `~/.ssh/authorized_keys` of the SSH user. Empty when the key was pasted in.
    pub public_key: String,
    /// Whether the server's host key is pinned. Tessery pins it on the first successful check.
    pub host_key_pinned: bool,
    /// Result of the last check: `ok`, `error`, and on success `docker`, `os`, `arch`, `cpus`, `memoryBytes`, `diskFreeBytes`, `diskTotalBytes`.
    #[schema(value_type = Option<Object>)]
    pub last_check: Option<Value>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub checked_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    /// Environments that deploy to this server.
    pub used_by: Vec<ServerUse>,
    /// `creating` and `configuring` while Tessery sets up a new machine, then `ready`, or `failed`.
    pub status: String,
    pub status_detail: String,
    /// Set when Tessery created the machine through a connected cloud account.
    pub provider: Option<String>,
    pub region: Option<String>,
    pub size: Option<String>,
    pub integration_id: Option<Uuid>,
    /// Whether removing the server can also delete the machine at the provider.
    pub managed: bool,
}

impl ServerDto {
    fn new(s: db::Server, used_by: Vec<ServerUse>) -> Self {
        Self {
            id: s.id,
            name: s.name,
            address: s.address,
            public_key: s.public_key,
            host_key_pinned: !s.known_hosts.trim().is_empty(),
            last_check: s.last_check,
            checked_at: s.checked_at,
            created_at: s.created_at,
            used_by,
            managed: s.resource_id.is_some() && s.integration_id.is_some(),
            status: s.status,
            status_detail: s.status_detail,
            provider: s.provider,
            region: s.region,
            size: s.size,
            integration_id: s.integration_id,
        }
    }
}

async fn uses(state: &AppState, org: Uuid, viewer: Option<&Principal>) -> ApiResult<Vec<(Uuid, ServerUse)>> {
    let mut out = Vec::new();
    for p in db::project_docs(&state.db, org).await? {
        if let Some(viewer) = viewer
            && !rbac::can(state, viewer, &rbac::project_target(state, p.id).await?, P::ProjectRead).await?
        {
            continue;
        }
        for env in p.doc["environments"].as_array().into_iter().flatten() {
            let Some(server) = env.pointer("/target/server").and_then(Value::as_str).and_then(|s| s.parse::<Uuid>().ok()) else { continue };
            out.push((server, ServerUse { project_id: p.id, project: p.name.clone(), env: env["name"].as_str().or(env["id"].as_str()).unwrap_or_default().to_owned() }));
        }
    }
    Ok(out)
}

async fn running_on(state: &AppState, org: Uuid, server: Uuid) -> ApiResult<Vec<String>> {
    let mut out = Vec::new();
    for p in db::project_docs(&state.db, org).await? {
        let Ok(repo) = state.repos.open(p.id).await else { continue };
        for head in tessery_db::delivery::heads(&state.db, p.id).await? {
            let checkpoint = tessery_db::delivery::get_checkpoint(&state.db, p.id, head.checkpoint_id).await?;
            let Ok(raw) = repo.read_file(&checkpoint.commit_sha, &format!("deploy/{}/plan.json", head.env_key)).await else { continue };
            let plan: Value = serde_json::from_slice(&raw).unwrap_or_default();
            if plan.pointer("/target/server").and_then(Value::as_str) == Some(server.to_string().as_str()) {
                out.push(format!("{} / {}", p.name, head.env_key));
            }
        }
    }
    Ok(out)
}

fn used_by(all: &mut Vec<(Uuid, ServerUse)>, id: Uuid) -> Vec<ServerUse> {
    let (mine, rest): (Vec<_>, Vec<_>) = std::mem::take(all).into_iter().partition(|(s, _)| *s == id);
    *all = rest;
    mine.into_iter().map(|(_, u)| u).collect()
}

fn valid_address(a: &str) -> bool {
    let Some(rest) = a.strip_prefix("ssh://") else { return false };
    let Some((user, host)) = rest.split_once('@') else { return false };
    let (host, port) = host.rsplit_once(':').map_or((host, None), |(h, p)| (h, Some(p)));
    let word = |s: &str| !s.is_empty() && s.chars().all(|c| c.is_ascii_alphanumeric() || "._-".contains(c));
    word(user) && word(host) && port.is_none_or(|p| p.parse::<u16>().is_ok_and(|n| n > 0))
}

fn check_input(name: Option<&str>, address: Option<&str>) -> ApiResult<()> {
    if name.is_some_and(|n| n.trim().is_empty() || n.trim().chars().count() > 80) {
        return Err(ApiError::invalid("name", "must be 1 to 80 characters"));
    }
    if address.is_some_and(|a| !valid_address(a.trim())) {
        return Err(ApiError::invalid("address", "use ssh://user@host or ssh://user@host:port"));
    }
    Ok(())
}

fn key(state: &AppState) -> ApiResult<&tessery_core::SecretKey> {
    state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY on the server to store server keys".into()))
}

fn generate_key(name: &str) -> ApiResult<(String, String)> {
    let mut private = ssh_key::PrivateKey::random(&mut ssh_key::rand_core::OsRng, ssh_key::Algorithm::Ed25519).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    private.set_comment(format!("tessery {name}"));
    let pem = private.to_openssh(ssh_key::LineEnding::LF).map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    let public = private.public_key().to_openssh().map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    Ok((pem.to_string(), public))
}

fn parse_key(pem: &str) -> ApiResult<String> {
    let k = ssh_key::PrivateKey::from_openssh(pem.trim()).map_err(|_| ApiError::invalid("privateKey", "must be an unencrypted OpenSSH private key"))?;
    if k.is_encrypted() {
        return Err(ApiError::invalid("privateKey", "remove the passphrase first; Tessery stores the key encrypted itself"));
    }
    k.public_key().to_openssh().map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))
}

#[utoipa::path(get, path = "/api/orgs/{org}/servers", tag = "servers", params(("org" = Uuid, Path)), responses((status = 200, body = [ServerDto])))]
pub async fn list(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>) -> ApiResult<Json<Vec<ServerDto>>> {
    rbac::require(&state, &p, &org_target(org), P::ServerRead).await?;
    let mut all = uses(&state, org, Some(&p)).await?;
    Ok(Json(db::list(&state.db, org).await?.into_iter().map(|s| { let u = used_by(&mut all, s.id); ServerDto::new(s, u) }).collect()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewServerInput {
    pub name: String,
    pub address: String,
    /// An unencrypted OpenSSH private key. Leave it out and Tessery generates one; add the returned public key to the server.
    pub private_key: Option<String>,
}

#[utoipa::path(post, path = "/api/orgs/{org}/servers", tag = "servers", params(("org" = Uuid, Path)), request_body = NewServerInput, responses((status = 201, body = ServerDto)))]
pub async fn create(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>, Json(req): Json<NewServerInput>) -> ApiResult<(StatusCode, Json<ServerDto>)> {
    let target = org_target(org);
    let d = rbac::require(&state, &p, &target, P::ServerManage).await?;
    check_input(Some(&req.name), Some(&req.address))?;
    let name = req.name.trim();
    let (pem, public) = match req.private_key.as_deref().map(str::trim).filter(|k| !k.is_empty()) {
        Some(pem) => (pem.to_owned(), parse_key(pem)?),
        None => generate_key(name)?,
    };
    let cipher = key(&state)?.encrypt(pem.as_bytes());
    let pasted = req.private_key.as_deref().is_some_and(|k| !k.trim().is_empty());
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let s = db::create(&mut *tx, NewServer { org_id: org, name, address: req.address.trim(), private_key: &cipher, public_key: if pasted { "" } else { &public }, known_hosts: "", created_by: p.user.id }).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "server.create", "server", s.id).decision(d).details(json!({ "name": name, "address": s.address, "generatedKey": !pasted }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok((StatusCode::CREATED, Json(ServerDto::new(s, Vec::new()))))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ServerPatch {
    pub name: Option<String>,
    pub address: Option<String>,
    /// Replace the key with this unencrypted OpenSSH private key.
    pub private_key: Option<String>,
    /// Generate a new key pair. The old public key stops working once removed from the server.
    #[serde(default)]
    pub new_key: bool,
    /// Forget the pinned host key, for example after reinstalling the server.
    #[serde(default)]
    pub forget_host_key: bool,
}

#[utoipa::path(patch, path = "/api/orgs/{org}/servers/{server}", tag = "servers", params(("org" = Uuid, Path), ("server" = Uuid, Path)), request_body = ServerPatch, responses((status = 200, body = ServerDto)))]
pub async fn update(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>, Json(req): Json<ServerPatch>) -> ApiResult<Json<ServerDto>> {
    let d = rbac::require(&state, &p, &org_target(org), P::ServerManage).await?;
    check_input(req.name.as_deref(), req.address.as_deref())?;
    let current = db::get(&state.db, org, id).await?;
    let new_key = match (req.private_key.as_deref().map(str::trim).filter(|k| !k.is_empty()), req.new_key) {
        (Some(pem), _) => Some((pem.to_owned(), String::new(), parse_key(pem)?)),
        (None, true) => { let (pem, public) = generate_key(req.name.as_deref().unwrap_or(&current.name))?; Some((pem, public.clone(), public)) }
        (None, false) => None,
    };
    let cipher = match &new_key { Some((pem, ..)) => Some(key(&state)?.encrypt(pem.as_bytes())), None => None };
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let s = db::update(&mut *tx, org, id, ServerUpdate {
        name: req.name.as_deref().map(str::trim),
        address: req.address.as_deref().map(str::trim).filter(|a| *a != current.address),
        private_key: cipher.as_deref(),
        public_key: new_key.as_ref().map(|(_, shown, _)| shown.as_str()),
        known_hosts: (req.forget_host_key || req.address.as_deref().is_some_and(|a| a.trim() != current.address)).then_some(""),
    }).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "server.update", "server", id).decision(d).details(json!({ "name": s.name, "address": s.address, "newKey": new_key.is_some(), "forgetHostKey": req.forget_host_key }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    let mut all = uses(&state, org, Some(&p)).await?;
    let u = used_by(&mut all, id);
    Ok(Json(ServerDto::new(s, u)))
}

#[derive(Deserialize, IntoParams)]
#[into_params(parameter_in = Query)]
#[serde(rename_all = "camelCase")]
pub struct DeleteQuery {
    /// Also delete the machine at the provider, which stops its billing. Only for servers Tessery created.
    #[serde(default)]
    pub delete_machine: bool,
}

#[utoipa::path(delete, path = "/api/orgs/{org}/servers/{server}", tag = "servers", params(("org" = Uuid, Path), ("server" = Uuid, Path), DeleteQuery), responses((status = 200, body = Ok), (status = 409)))]
pub async fn delete(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>, Query(q): Query<DeleteQuery>) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::ServerManage).await?;
    let mut all = uses(&state, org, None).await?;
    let u = used_by(&mut all, id);
    if !u.is_empty() {
        let list: Vec<String> = u.iter().map(|x| format!("{} / {}", x.project, x.env)).collect();
        return Err(ApiError::Conflict(format!("these environments still deploy to this server: {}", list.join(", "))));
    }
    let running = running_on(&state, org, id).await?;
    if !running.is_empty() {
        return Err(ApiError::Conflict(format!("these environments still run on this server; stop them first: {}", running.join(", "))));
    }
    let current = db::get(&state.db, org, id).await?;
    let deleted_machine = match (q.delete_machine, current.integration_id, current.resource_id.as_deref()) {
        (true, Some(integration), Some(resource)) => {
            let (provider, f) = crate::routes::integrations::fields(&state, org, integration).await?;
            tessery_cloud::delete_machine(&provider, &f, &state.config.provider_apis, resource).await.map_err(|e| ApiError::Conflict(format!("the machine was not deleted: {e}")))?;
            true
        }
        (true, ..) => return Err(ApiError::Conflict("Tessery did not create this machine or its cloud account was disconnected; delete it at the provider".into())),
        _ => false,
    };
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let s = db::get(&mut *tx, org, id).await?;
    db::delete(&mut *tx, org, id).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "server.delete", "server", id).decision(d).details(json!({ "name": s.name, "address": s.address, "deletedMachine": deleted_machine }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(OK))
}

#[utoipa::path(post, path = "/api/orgs/{org}/servers/{server}/check", tag = "servers", params(("org" = Uuid, Path), ("server" = Uuid, Path)), responses((status = 200, body = ServerDto)))]
pub async fn check(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>) -> ApiResult<Json<ServerDto>> {
    rbac::require(&state, &p, &org_target(org), P::ServerManage).await?;
    let creds = db::credentials(&state.db, org, id).await?;
    let pem = String::from_utf8(key(&state)?.decrypt(&creds.private_key).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?;
    let host = Engine { url: Some(creds.address.clone()), ssh_key: Some(pem), known_hosts: Some(creds.known_hosts.clone()).filter(|k| !k.trim().is_empty()) };
    let (result, pin) = match runtime::remote_script(&host, tessery_core::runner::SERVER_CHECK, &[], None, Duration::from_secs(120)).await {
        Ok(out) if out.ok => {
            let mut v = tessery_core::runner::parse_check(&out.stdout);
            let known = v.as_object_mut().and_then(|o| o.remove("knownHosts")).and_then(|k| k.as_str().map(str::to_owned)).filter(|k| !k.is_empty());
            (v, known)
        }
        Ok(out) => (json!({ "ok": false, "error": tessery_core::runner::explain_ssh(&out.stderr) }), None),
        Err(ApiError::Conflict(e)) => (json!({ "ok": false, "error": e }), None),
        Err(e) => return Err(e),
    };
    db::record_check(&state.db, id, &creds, &result, pin.as_deref()).await?;
    let s = db::get(&state.db, org, id).await?;
    let mut all = uses(&state, org, Some(&p)).await?;
    let u = used_by(&mut all, id);
    Ok(Json(ServerDto::new(s, u)))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct ProvisionInput {
    /// A connected Hetzner or DigitalOcean account.
    pub integration_id: Uuid,
    pub name: String,
    pub region: String,
    pub size: String,
}

/// Creates a machine at the provider and sets it up as a server: Docker, a `deploy` user with Tessery's key, and a firewall for SSH, HTTP and HTTPS.
/// The provider bills the machine from now on. The server shows `creating`, then `configuring`, then `ready`.
#[utoipa::path(post, path = "/api/orgs/{org}/servers/provision", tag = "servers", params(("org" = Uuid, Path)), request_body = ProvisionInput, responses((status = 201, body = ServerDto)))]
pub async fn provision(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>, Json(req): Json<ProvisionInput>) -> ApiResult<(StatusCode, Json<ServerDto>)> {
    let d = rbac::require(&state, &p, &org_target(org), P::ServerManage).await?;
    check_input(Some(&req.name), None)?;
    let name = req.name.trim();
    let (provider, f) = crate::routes::integrations::fields(&state, org, req.integration_id).await?;
    let account = tessery_db::integrations::get(&state.db, org, req.integration_id).await?;
    if !tessery_cloud::allows(account.last_check.as_ref(), "servers") {
        return Err(ApiError::invalid("integrationId", format!("{} can only read; connect it with a token that can create servers", account.name)));
    }
    if !tessery_cloud::CAN_CREATE.contains(&provider.as_str()) {
        return Err(ApiError::invalid("integrationId", "Tessery can create servers on Hetzner and DigitalOcean"));
    }
    let (pem, public) = generate_key(name)?;
    let machine = tessery_cloud::NewMachine { name, region: req.region.trim(), size: req.size.trim(), public_key: &public };
    let resource = tessery_cloud::create_machine(&provider, &f, &state.config.provider_apis, &machine).await.map_err(|e| ApiError::invalid("size", e))?;
    let cipher = key(&state)?.encrypt(pem.as_bytes());
    let new = db::NewMachineServer { org_id: org, name, private_key: &cipher, public_key: &public, integration_id: req.integration_id, provider: &provider, region: machine.region, size: machine.size, resource_id: &resource, created_by: p.user.id };
    let created = db::create_machine(&state.db, new).await;
    let s = match created {
        Result::Ok(s) => s,
        Err(e) => {
            let _ = tessery_cloud::delete_machine(&provider, &f, &state.config.provider_apis, &resource).await;
            return Err(e.into());
        }
    };
    audit::record(&state.db, &p, Entry::new(Some(org), "server.provision", "server", s.id).decision(d).details(json!({ "name": name, "provider": provider, "region": machine.region, "size": machine.size, "machine": resource }))).await?;
    state.mq.publish(tessery_mq::Job::ProvisionServer { server_id: s.id }).await.map_err(|e| ApiError::Internal(anyhow::anyhow!(e)))?;
    Ok((StatusCode::CREATED, Json(ServerDto::new(s, Vec::new()))))
}

pub async fn connection_for(state: &AppState, project: Uuid, server: Uuid) -> ApiResult<tessery_mq::ServerConnection> {
    let org = db::org_of_project(&state.db, project).await?;
    let c = db::credentials(&state.db, org, server).await.map_err(|_| ApiError::Conflict("the server this environment runs on was removed".into()))?;
    Ok(tessery_mq::ServerConnection { address: c.address, private_key: c.private_key, known_hosts: c.known_hosts })
}

pub async fn engine_for(state: &AppState, project: Uuid, server: Uuid) -> ApiResult<Engine> {
    let org = db::org_of_project(&state.db, project).await?;
    let creds = db::credentials(&state.db, org, server).await.map_err(|_| ApiError::Conflict("the server this environment deploys to was removed; pick another one".into()))?;
    let pem = String::from_utf8(key(state)?.decrypt(&creds.private_key).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Engine { url: Some(creds.address), ssh_key: Some(pem), known_hosts: Some(creds.known_hosts).filter(|k| !k.trim().is_empty()) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_only_ssh_addresses() {
        assert!(valid_address("ssh://deploy@203.0.113.7"));
        assert!(valid_address("ssh://root@vps.example.com:2222"));
        assert!(!valid_address("deploy@203.0.113.7"));
        assert!(!valid_address("ssh://203.0.113.7"));
        assert!(!valid_address("ssh://a@b:0"));
        assert!(!valid_address("ssh://a@b; rm -rf /"));
    }

    #[test]
    fn reads_a_check_and_explains_failures() {
        let v = tessery_core::runner::parse_check("{\"ServerVersion\":\"28.1\",\"NCPU\":2,\"MemTotal\":4096,\"Architecture\":\"x86_64\",\"OperatingSystem\":\"Ubuntu\"}\n::disk::\n/dev/sda1 40000000 10000000 30000000 25% /\n::known::\n[h]:22 ssh-ed25519 AAA\n");
        assert_eq!(v["docker"], "28.1");
        assert_eq!(v["diskFreeBytes"], 30000000u64 * 1024);
        assert_eq!(v["knownHosts"], "[h]:22 ssh-ed25519 AAA");
        assert!(tessery_core::runner::SERVER_CHECK.contains("disk=$(docker run"), "a failed disk probe fails the check");
        assert!(tessery_core::runner::explain_ssh("deploy@h: Permission denied (publickey).").starts_with("The server refused the key"));
    }

    #[test]
    fn generated_keys_parse_back() {
        let (pem, public) = generate_key("vps").unwrap();
        assert_eq!(parse_key(&pem).unwrap().split_whitespace().nth(1), public.split_whitespace().nth(1));
        assert!(public.starts_with("ssh-ed25519 "));
    }
}
