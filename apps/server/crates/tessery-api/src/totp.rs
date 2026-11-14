use data_encoding::BASE32_NOPAD;
use hmac::{Hmac, KeyInit, Mac};
use rand::Rng;
use sha1::Sha1;
use sha2::{Digest, Sha256};
use subtle::ConstantTimeEq;

pub const STEP_SECONDS: u64 = 30;

pub fn new_secret() -> Vec<u8> {
    let mut b = vec![0u8; 20];
    rand::rng().fill_bytes(&mut b);
    b
}

pub fn encode(secret: &[u8]) -> String {
    BASE32_NOPAD.encode(secret)
}

pub fn decode(secret: &str) -> Option<Vec<u8>> {
    BASE32_NOPAD.decode(secret.trim().to_uppercase().as_bytes()).ok()
}

pub fn now_step() -> u64 {
    (time::OffsetDateTime::now_utc().unix_timestamp().max(0) as u64) / STEP_SECONDS
}

pub fn code_at(secret: &[u8], step: u64) -> u32 {
    let mut mac = <Hmac<Sha1> as KeyInit>::new_from_slice(secret).expect("HMAC takes any key length");
    mac.update(&step.to_be_bytes());
    let h = mac.finalize().into_bytes();
    let off = (h[h.len() - 1] & 0x0f) as usize;
    let bin = u32::from_be_bytes([h[off] & 0x7f, h[off + 1], h[off + 2], h[off + 3]]);
    bin % 1_000_000
}

/// Returns the matching time step when `code` is valid now, allowing one step of clock drift either way.
pub fn check(secret: &[u8], code: &str, now: u64) -> Option<u64> {
    let digits: String = code.chars().filter(|c| !c.is_whitespace()).collect();
    if digits.len() != 6 || !digits.chars().all(|c| c.is_ascii_digit()) {
        return None;
    }
    let mut found = None;
    for step in [now.saturating_sub(1), now, now + 1] {
        let want = format!("{:06}", code_at(secret, step));
        if bool::from(want.as_bytes().ct_eq(digits.as_bytes())) {
            found = Some(step);
        }
    }
    found
}

pub fn otpauth_url(secret: &[u8], account: &str, issuer: &str) -> String {
    let enc = |s: &str| s.bytes().map(|b| if b.is_ascii_alphanumeric() || b"-._~@".contains(&b) { (b as char).to_string() } else { format!("%{b:02X}") }).collect::<String>();
    format!("otpauth://totp/{}:{}?secret={}&issuer={}&algorithm=SHA1&digits=6&period=30", enc(issuer), enc(account), encode(secret), enc(issuer))
}

pub fn qr_svg(data: &str) -> String {
    match qrcode::QrCode::new(data.as_bytes()) {
        Ok(code) => code.render::<qrcode::render::svg::Color>().min_dimensions(200, 200).quiet_zone(true).build(),
        Err(_) => String::new(),
    }
}

pub fn recovery_codes() -> Vec<String> {
    (0..10)
        .map(|_| {
            let mut b = [0u8; 5];
            rand::rng().fill_bytes(&mut b);
            let s = BASE32_NOPAD.encode(&b).to_lowercase();
            format!("{}-{}", &s[..4], &s[4..8])
        })
        .collect()
}

pub fn hash_recovery(code: &str) -> Vec<u8> {
    let normal: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).map(|c| c.to_ascii_lowercase()).collect();
    Sha256::digest(normal.as_bytes()).to_vec()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_rfc_6238_vectors() {
        let secret = b"12345678901234567890";
        assert_eq!(code_at(secret, 59 / 30), 287_082);
        assert_eq!(code_at(secret, 1_111_111_109 / 30), 81_804);
        assert_eq!(code_at(secret, 1_234_567_890 / 30), 5_924);
    }

    #[test]
    fn accepts_one_step_of_drift_only() {
        let secret = new_secret();
        let now = 1_000_000;
        assert_eq!(check(&secret, &format!("{:06}", code_at(&secret, now - 1)), now), Some(now - 1));
        assert_eq!(check(&secret, &format!("{:06}", code_at(&secret, now + 1)), now), Some(now + 1));
        let old = format!("{:06}", code_at(&secret, now - 3));
        assert_ne!(check(&secret, &old, now), Some(now - 3));
        assert_eq!(check(&secret, "12345", now), None);
        assert_eq!(check(&secret, "abcdef", now), None);
    }

    #[test]
    fn recovery_codes_ignore_case_and_dashes() {
        let codes = recovery_codes();
        assert_eq!(codes.len(), 10);
        assert_eq!(hash_recovery(&codes[0]), hash_recovery(&codes[0].to_uppercase().replace('-', " ")));
        assert!(otpauth_url(b"x", "a b@example.com", "Tessery").starts_with("otpauth://totp/Tessery:a%20b@example.com?secret="));
        assert!(qr_svg("otpauth://totp/x").starts_with("<?xml"));
    }
}
