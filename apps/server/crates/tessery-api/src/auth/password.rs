use crate::error::{ApiError, ApiResult};
use argon2::Argon2;
use argon2::password_hash::phc::PasswordHash;
use argon2::password_hash::{PasswordHasher, PasswordVerifier};

pub const MIN_LENGTH: usize = 10;

static DUMMY_HASH: std::sync::OnceLock<String> = std::sync::OnceLock::new();

fn dummy_hash() -> &'static str {
    DUMMY_HASH.get_or_init(|| {
        Argon2::default()
            .hash_password(b"tessery-timing-equalizer")
            .map(|h| h.to_string())
            .unwrap_or_default()
    })
}

pub fn validate(password: &str) -> ApiResult<()> {
    if password.chars().count() < MIN_LENGTH {
        return Err(ApiError::invalid(
            "password",
            format!("must be at least {MIN_LENGTH} characters"),
        ));
    }
    if password.len() > 1024 {
        return Err(ApiError::invalid("password", "is too long"));
    }
    Ok(())
}

pub async fn hash(password: String) -> ApiResult<String> {
    tokio::task::spawn_blocking(move || {
        Argon2::default()
            .hash_password(password.as_bytes())
            .map(|h| h.to_string())
            .map_err(|e| anyhow::anyhow!("hashing failed: {e}"))
    })
    .await
    .map_err(|e| anyhow::anyhow!(e))?
    .map_err(ApiError::Internal)
}

pub async fn verify(password: String, stored: Option<String>) -> bool {
    tokio::task::spawn_blocking(move || {
        let known = stored.is_some();
        let hash = stored.unwrap_or_else(|| dummy_hash().to_owned());
        let Ok(parsed) = PasswordHash::new(&hash) else {
            return false;
        };
        Argon2::default()
            .verify_password(password.as_bytes(), &parsed)
            .is_ok()
            && known
    })
    .await
    .unwrap_or(false)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn hashes_and_verifies() {
        let h = hash("correct horse battery".into()).await.unwrap();
        assert!(h.starts_with("$argon2id$"));
        assert!(verify("correct horse battery".into(), Some(h.clone())).await);
        assert!(!verify("wrong password!!".into(), Some(h)).await);
        assert!(!verify("anything at all".into(), None).await);
    }

    #[test]
    fn enforces_minimum_length() {
        assert!(validate("short").is_err());
        assert!(validate("long enough pw").is_ok());
    }
}
