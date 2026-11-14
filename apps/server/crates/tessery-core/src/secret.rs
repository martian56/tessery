use aes_gcm::aead::{Aead, AeadCore, KeyInit, OsRng};
use aes_gcm::{Aes256Gcm, Key, Nonce};
use base64::Engine;

const NONCE_LEN: usize = 12;

#[derive(Debug, thiserror::Error)]
pub enum SecretError {
    #[error("TESSERY_SECRET_KEY must be 32 bytes, given as 64 hex characters or base64")]
    BadKey,
    #[error("stored secret could not be decrypted; was TESSERY_SECRET_KEY changed?")]
    Decrypt,
    #[error("TESSERY_SECRET_KEY_PREVIOUS is set but TESSERY_SECRET_KEY is not")]
    PreviousWithoutCurrent,
}

/// The key that encrypts stored secrets. During a rotation it also holds the previous key, which is only used to read.
#[derive(Clone)]
pub struct SecretKey {
    current: Key<Aes256Gcm>,
    previous: Option<Key<Aes256Gcm>>,
}

impl std::fmt::Debug for SecretKey {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("SecretKey(..)")
    }
}

impl SecretKey {
    pub fn parse(s: &str) -> Result<Self, SecretError> {
        let s = s.trim();
        let bytes = if s.len() == 64 && s.chars().all(|c| c.is_ascii_hexdigit()) {
            (0..32).map(|i| u8::from_str_radix(&s[i * 2..i * 2 + 2], 16)).collect::<Result<Vec<_>, _>>().map_err(|_| SecretError::BadKey)?
        } else {
            base64::engine::general_purpose::STANDARD.decode(s).map_err(|_| SecretError::BadKey)?
        };
        let bytes: [u8; 32] = bytes.try_into().map_err(|_| SecretError::BadKey)?;
        Ok(Self { current: Key::<Aes256Gcm>::from(bytes), previous: None })
    }

    /// Reads `TESSERY_SECRET_KEY` and, while rotating, `TESSERY_SECRET_KEY_PREVIOUS`.
    pub fn from_env() -> Result<Option<Self>, SecretError> {
        let var = |name: &str| std::env::var(name).ok().filter(|s| !s.trim().is_empty());
        match (var("TESSERY_SECRET_KEY"), var("TESSERY_SECRET_KEY_PREVIOUS")) {
            (Some(k), Some(p)) => Ok(Some(Self::parse(&k)?.with_previous(Self::parse(&p)?))),
            (Some(k), None) => Ok(Some(Self::parse(&k)?)),
            (None, Some(_)) => Err(SecretError::PreviousWithoutCurrent),
            (None, None) => Ok(None),
        }
    }

    pub fn with_previous(mut self, previous: SecretKey) -> Self {
        self.previous = Some(previous.current);
        self
    }

    pub fn has_previous(&self) -> bool {
        self.previous.is_some()
    }

    pub fn encrypt(&self, plain: &[u8]) -> Vec<u8> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let mut out = nonce.to_vec();
        out.extend(Aes256Gcm::new(&self.current).encrypt(&nonce, plain).expect("AES-GCM encryption does not fail for in-memory buffers"));
        out
    }

    pub fn decrypt(&self, stored: &[u8]) -> Result<Vec<u8>, SecretError> {
        self.decrypt_tracked(stored).map(|(plain, _)| plain)
    }

    /// Decrypts and says whether the previous key was needed, so a rotation knows what it changed.
    pub fn decrypt_tracked(&self, stored: &[u8]) -> Result<(Vec<u8>, bool), SecretError> {
        if stored.len() < NONCE_LEN {
            return Err(SecretError::Decrypt);
        }
        let (nonce, body) = stored.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| SecretError::Decrypt)?;
        let open = |k: &Key<Aes256Gcm>| Aes256Gcm::new(k).decrypt(&Nonce::from(nonce), body).ok();
        if let Some(plain) = open(&self.current) {
            return Ok((plain, false));
        }
        self.previous.as_ref().and_then(open).map(|plain| (plain, true)).ok_or(SecretError::Decrypt)
    }

    pub fn derive(&self, purpose: &str) -> String {
        derive_with(&self.current, purpose)
    }

    /// The value `derive` gave under the previous key, accepted until clients are updated.
    pub fn derive_previous(&self, purpose: &str) -> Option<String> {
        self.previous.as_ref().map(|k| derive_with(k, purpose))
    }
}

fn derive_with(key: &Key<Aes256Gcm>, purpose: &str) -> String {
    use sha2::{Digest, Sha256};
    let key: &[u8] = key;
    let mut block = [0u8; 64];
    block[..key.len()].copy_from_slice(key);
    let pad = |b: u8| block.map(|k| k ^ b);
    let inner = Sha256::new().chain_update(pad(0x36)).chain_update(purpose.as_bytes()).finalize();
    let outer = Sha256::new().chain_update(pad(0x5c)).chain_update(inner).finalize();
    hex::encode(outer)
}

#[cfg(test)]
mod tests {
    use super::*;

    const HEX: &str = "000102030405060708090a0b0c0d0e0f101112131415161718191a1b1c1d1e1f";

    #[test]
    fn round_trips_and_detects_tampering() {
        let key = SecretKey::parse(HEX).unwrap();
        let a = key.encrypt(b"ghp_token");
        let b = key.encrypt(b"ghp_token");
        assert_ne!(a, b, "nonces are random");
        assert_eq!(key.decrypt(&a).unwrap(), b"ghp_token");
        let mut bad = a.clone();
        *bad.last_mut().unwrap() ^= 1;
        assert!(key.decrypt(&bad).is_err());
        let other = SecretKey::parse(&"ab".repeat(32)).unwrap();
        assert!(other.decrypt(&a).is_err());
    }

    #[test]
    fn derived_tokens_are_standard_hmac_sha256() {
        let key = SecretKey::parse(HEX).unwrap();
        assert_eq!(key.derive("otlp:p:dev"), "d2adecd9f38666178e1b16a3b115b0f0abdcc14a84edcd226c9152d776c92766");
        assert_ne!(key.derive("otlp:p:prod"), key.derive("otlp:p:dev"));
    }

    #[test]
    fn accepts_hex_or_base64_of_32_bytes() {
        assert!(SecretKey::parse(HEX).is_ok());
        assert!(SecretKey::parse("AAECAwQFBgcICQoLDA0ODxAREhMUFRYXGBkaGxwdHh8=").is_ok());
        assert!(SecretKey::parse("short").is_err());
    }

    #[test]
    fn reads_with_the_previous_key_while_rotating() {
        let old = SecretKey::parse(HEX).unwrap();
        let new = SecretKey::parse(&"ab".repeat(32)).unwrap();
        let stored = old.encrypt(b"db password");
        assert!(new.decrypt(&stored).is_err());
        let rotating = new.clone().with_previous(old.clone());
        assert_eq!(rotating.decrypt_tracked(&stored).unwrap(), (b"db password".to_vec(), true));
        let again = rotating.encrypt(b"db password");
        assert_eq!(new.decrypt_tracked(&again).unwrap(), (b"db password".to_vec(), false));
        assert_eq!(rotating.derive_previous("otlp:p:dev").as_deref(), Some(old.derive("otlp:p:dev").as_str()));
        assert_eq!(rotating.derive("otlp:p:dev"), new.derive("otlp:p:dev"));
    }
}
