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
