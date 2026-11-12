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
}

#[derive(Clone)]
pub struct SecretKey(Key<Aes256Gcm>);

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
        Ok(Self(Key::<Aes256Gcm>::from(bytes)))
    }

    pub fn encrypt(&self, plain: &[u8]) -> Vec<u8> {
        let nonce = Aes256Gcm::generate_nonce(&mut OsRng);
        let mut out = nonce.to_vec();
        out.extend(Aes256Gcm::new(&self.0).encrypt(&nonce, plain).expect("AES-GCM encryption does not fail for in-memory buffers"));
        out
    }

    pub fn decrypt(&self, stored: &[u8]) -> Result<Vec<u8>, SecretError> {
        if stored.len() < NONCE_LEN {
            return Err(SecretError::Decrypt);
        }
        let (nonce, body) = stored.split_at(NONCE_LEN);
        let nonce: [u8; NONCE_LEN] = nonce.try_into().map_err(|_| SecretError::Decrypt)?;
        Aes256Gcm::new(&self.0).decrypt(&Nonce::from(nonce), body).map_err(|_| SecretError::Decrypt)
    }

    pub fn derive(&self, purpose: &str) -> String {
        use sha2::{Digest, Sha256};
        let key: &[u8] = &self.0;
        let mut block = [0u8; 64];
        block[..key.len()].copy_from_slice(key);
        let pad = |b: u8| block.map(|k| k ^ b);
        let inner = Sha256::new().chain_update(pad(0x36)).chain_update(purpose.as_bytes()).finalize();
        let outer = Sha256::new().chain_update(pad(0x5c)).chain_update(inner).finalize();
        hex::encode(outer)
    }
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
}
