use serde_json::{Value, json};
pub const DOCKERFILE: &str = include_str!("../runner/Dockerfile");
pub const SCRIPT: &str = include_str!("../runner/run.sh");

pub fn image() -> String {
    use sha2::{Digest, Sha256};
    let hash = Sha256::digest(DOCKERFILE.as_bytes());
    format!("tessery-runner:{}", hex::encode(&hash[..6]))
}

pub const CONNECTION_FILES: &[(&str, &str)] = &[("KUBECONFIG", "kubeconfig"), ("SSH_PRIVATE_KEY", "ssh_key"), ("SSH_KNOWN_HOSTS", "known_hosts")];

pub fn is_connection_secret(name: &str) -> bool {
    CONNECTION_FILES.iter().any(|(n, _)| *n == name)
}

pub fn telemetry_token(key: &crate::SecretKey, project: uuid::Uuid, env: &str) -> String {
    key.derive(&format!("otlp:{project}:{env}"))
}

/// Tokens the server accepts: the current one, and during a key rotation the one apps deployed before it still send.
pub fn telemetry_tokens(key: &crate::SecretKey, project: uuid::Uuid, env: &str) -> Vec<String> {
    let purpose = format!("otlp:{project}:{env}");
    std::iter::once(key.derive(&purpose)).chain(key.derive_previous(&purpose)).collect()
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RequiredSecret {
    pub name: String,
    pub generate: bool,
}

pub fn required_secrets(plan: &serde_json::Value) -> Vec<RequiredSecret> {
    let mut out: Vec<RequiredSecret> = plan["secrets"]
        .as_array()
        .into_iter()
        .flatten()
        .filter_map(|s| Some(RequiredSecret { name: s["name"].as_str()?.to_owned(), generate: s["generate"].as_bool().unwrap_or(false) }))
        .collect();
    let target = &plan["target"];
    match target["kind"].as_str() {
        Some("kubernetes") => out.push(RequiredSecret { name: "KUBECONFIG".into(), generate: false }),
        Some("docker") if target["server"].is_null() && target["host"].as_str().is_some_and(|h| h.starts_with("ssh://")) => {
            out.push(RequiredSecret { name: "SSH_PRIVATE_KEY".into(), generate: false })
        }
        _ => {}
    }
    out
}

pub fn missing_secrets<'a>(required: &'a [RequiredSecret], stored: &[String]) -> Vec<&'a str> {
    required.iter().filter(|r| !r.generate && !stored.contains(&r.name)).map(|r| r.name.as_str()).collect()
}

pub const SSH_SETUP: &str = concat!(
    "mkdir -p ~/.ssh && echo \"$SSH_KEY_B64\" | base64 -d > ~/.ssh/id_tessery && chmod 600 ~/.ssh/id_tessery && ",
    "if [ -n \"$KNOWN_B64\" ]; then echo \"$KNOWN_B64\" | base64 -d > ~/.ssh/known_hosts; c=yes; else c=accept-new; fi && ",
    "printf 'Host *\\n  IdentityFile ~/.ssh/id_tessery\\n  IdentitiesOnly yes\\n  StrictHostKeyChecking %s\\n  ConnectTimeout 15\\n' $c > ~/.ssh/config && ",
    "export DOCKER_HOST=\"$REMOTE_DOCKER_HOST\" && "
);

pub const SERVER_CHECK: &str = r#"set -e
docker info --format '{{json .}}'
echo '::disk::'
disk=$(docker run --rm busybox:1.37 df -Pk /)
echo "$disk" | tail -n 1
echo '::known::'
cat ~/.ssh/known_hosts 2>/dev/null || true"#;

pub fn parse_check(stdout: &str) -> Value {
    let (info, rest) = stdout.split_once("::disk::").unwrap_or((stdout, ""));
    let (disk, known) = rest.split_once("::known::").unwrap_or((rest, ""));
    let info: Value = serde_json::from_str(info.trim()).unwrap_or(Value::Null);
    let cols: Vec<u64> = disk.split_whitespace().filter_map(|c| c.parse().ok()).collect();
    json!({
        "ok": true,
        "docker": info["ServerVersion"],
        "os": info["OperatingSystem"],
        "arch": info["Architecture"],
        "cpus": info["NCPU"],
        "memoryBytes": info["MemTotal"],
        "diskTotalBytes": cols.first().map(|k| k * 1024),
        "diskFreeBytes": cols.get(2).map(|k| k * 1024),
        "knownHosts": known.trim(),
    })
}

pub fn explain_ssh(stderr: &str) -> String {
    let e = stderr.trim();
    let hint = if e.contains("Permission denied") {
        "The server refused the key. Add the public key to ~/.ssh/authorized_keys of that user."
    } else if e.contains("Host key verification failed") || e.contains("REMOTE HOST IDENTIFICATION HAS CHANGED") {
        "The server's host key changed since Tessery pinned it. If you reinstalled the server, forget the host key and check again."
    } else if e.contains("Connection refused") || e.contains("timed out") || e.contains("No route to host") || e.contains("Could not resolve") {
        "Tessery could not reach the server. Check the address, the port and the firewall."
    } else if e.contains("permission denied while trying to connect to the Docker daemon") || e.contains("docker.sock") {
        "Connected, but this user may not run Docker. Add it to the docker group: sudo usermod -aG docker <user>."
    } else if e.contains("command not found") || e.contains("docker: not found") {
        "Connected, but Docker is not installed on the server. Install it with: curl -fsSL https://get.docker.com | sh"
    } else {
        ""
    };
    let last = e.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("the check failed").trim();
    if hint.is_empty() { last.to_owned() } else { format!("{hint} ({last})") }
}

#[cfg(test)]
mod tests {

    #[test]
    fn apps_deployed_before_a_key_rotation_keep_sending_telemetry() {
        let old = crate::SecretKey::parse(&"1".repeat(64)).unwrap();
        let new = crate::SecretKey::parse(&"2".repeat(64)).unwrap();
        let project = uuid::Uuid::nil();
        let before = telemetry_token(&old, project, "prod");
        let rotating = new.clone().with_previous(old);
        assert!(telemetry_tokens(&rotating, project, "prod").contains(&before));
        assert_eq!(telemetry_tokens(&new, project, "prod"), vec![telemetry_token(&new, project, "prod")]);
    }

    use super::*;
    use serde_json::json;

    #[test]
    fn lists_what_a_plan_needs_and_what_is_missing() {
        let plan = json!({
            "target": { "kind": "docker", "host": "ssh://deploy@203.0.113.7" },
            "secrets": [{ "name": "DB_PASSWORD", "generate": true }, { "name": "PAYMENTS_URL", "generate": false }]
        });
        let required = required_secrets(&plan);
        assert_eq!(required.iter().map(|r| r.name.as_str()).collect::<Vec<_>>(), ["DB_PASSWORD", "PAYMENTS_URL", "SSH_PRIVATE_KEY"]);
        assert_eq!(missing_secrets(&required, &["PAYMENTS_URL".into()]), ["SSH_PRIVATE_KEY"]);
        let on_server = required_secrets(&json!({ "target": { "kind": "docker", "host": "ssh://deploy@203.0.113.7", "server": "01a1d5ca-a628-79bc-adf1-a98e48cb28f3" } }));
        assert!(on_server.is_empty(), "a saved server brings its own key");
        let k8s = required_secrets(&json!({ "target": { "kind": "kubernetes" } }));
        assert_eq!(missing_secrets(&k8s, &[]), ["KUBECONFIG"]);
    }
}
