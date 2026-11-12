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
        Some("docker") if target["host"].as_str().is_some_and(|h| h.starts_with("ssh://")) => {
            out.push(RequiredSecret { name: "SSH_PRIVATE_KEY".into(), generate: false })
        }
        _ => {}
    }
    out
}

pub fn missing_secrets<'a>(required: &'a [RequiredSecret], stored: &[String]) -> Vec<&'a str> {
    required.iter().filter(|r| !r.generate && !stored.contains(&r.name)).map(|r| r.name.as_str()).collect()
}

#[cfg(test)]
mod tests {
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
        let k8s = required_secrets(&json!({ "target": { "kind": "kubernetes" } }));
        assert_eq!(missing_secrets(&k8s, &[]), ["KUBECONFIG"]);
    }
}
