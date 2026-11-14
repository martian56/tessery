use base64::Engine;
use base64::engine::general_purpose::{STANDARD, URL_SAFE_NO_PAD};
use ring::hmac;
use ring::rand::SystemRandom;
use ring::signature::{RSA_PKCS1_SHA256, RsaKeyPair};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;

const API: &str = "https://api.github.com";

/// The GitHub App this Tessery instance acts as.
#[derive(Clone)]
pub struct App {
    pub id: u64,
    key: std::sync::Arc<RsaKeyPair>,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AppInfo {
    pub id: u64,
    pub slug: String,
    pub name: String,
    pub html_url: String,
    pub owner: String,
}

/// What GitHub hands back once an admin creates the app from the manifest.
pub struct Created {
    pub info: AppInfo,
    pub pem: String,
    pub webhook_secret: String,
}

/// A commit status: `pending`, `success`, `failure` or `error`, under a context such as `tessery/prod`.
pub struct Status<'a> {
    pub state: &'a str,
    pub context: &'a str,
    pub description: &'a str,
    pub target_url: Option<&'a str>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Repo {
    pub full_name: String,
    pub private: bool,
    pub default_branch: String,
    pub installation: i64,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(20)).user_agent("tessery").build().expect("an HTTP client")
}

fn pem_der(pem: &str) -> Result<Vec<u8>, String> {
    let body: String = pem.lines().filter(|l| !l.starts_with("-----")).map(str::trim).collect();
    STANDARD.decode(body).map_err(|_| "the GitHub App private key is not valid PEM".to_owned())
}

async fn check(r: reqwest::Response, what: &str) -> Result<Value, String> {
    let status = r.status();
    let body: Value = r.json().await.unwrap_or(Value::Null);
    if status.is_success() {
        Ok(body)
    } else {
        Err(format!("GitHub refused to {what}: {} {}", status.as_u16(), body["message"].as_str().unwrap_or_default()))
    }
}

impl App {
    pub fn new(id: u64, pem: &str) -> Result<Self, String> {
        let der = pem_der(pem)?;
        let key = RsaKeyPair::from_der(&der).or_else(|_| RsaKeyPair::from_pkcs8(&der)).map_err(|_| "the GitHub App private key could not be read".to_owned())?;
        Ok(Self { id, key: std::sync::Arc::new(key) })
    }

    /// A short-lived token that authenticates as the app itself.
    pub fn jwt(&self) -> String {
        let now = time::OffsetDateTime::now_utc().unix_timestamp();
        let header = URL_SAFE_NO_PAD.encode(br#"{"alg":"RS256","typ":"JWT"}"#);
        let claims = URL_SAFE_NO_PAD.encode(json!({ "iat": now - 60, "exp": now + 540, "iss": self.id.to_string() }).to_string());
        let input = format!("{header}.{claims}");
        let mut sig = vec![0u8; self.key.public().modulus_len()];
        self.key.sign(&RSA_PKCS1_SHA256, &SystemRandom::new(), input.as_bytes(), &mut sig).expect("RSA signing does not fail with a valid key");
        format!("{input}.{}", URL_SAFE_NO_PAD.encode(sig))
    }

    pub async fn installation_token(&self, installation: i64) -> Result<String, String> {
        let r = client().post(format!("{API}/app/installations/{installation}/access_tokens")).bearer_auth(self.jwt()).header("accept", "application/vnd.github+json").send().await.map_err(|e| format!("could not reach GitHub: {}", e.without_url()))?;
        let v = check(r, "issue an installation token").await?;
        v["token"].as_str().map(str::to_owned).ok_or_else(|| "GitHub returned no token".into())
    }

    /// Every repository the app was installed on, across all installations.
    pub async fn repos(&self) -> Result<Vec<Repo>, String> {
        let r = client().get(format!("{API}/app/installations?per_page=100")).bearer_auth(self.jwt()).header("accept", "application/vnd.github+json").send().await.map_err(|e| format!("could not reach GitHub: {}", e.without_url()))?;
        let installs = check(r, "list installations").await?;
        let mut out = Vec::new();
        for inst in installs.as_array().into_iter().flatten() {
            let Some(id) = inst["id"].as_i64() else { continue };
            let token = self.installation_token(id).await?;
            for page in 1..=10 {
                let r = client().get(format!("{API}/installation/repositories?per_page=100&page={page}")).bearer_auth(&token).header("accept", "application/vnd.github+json").send().await.map_err(|e| format!("could not reach GitHub: {}", e.without_url()))?;
                let v = check(r, "list repositories").await?;
                let repos = v["repositories"].as_array().cloned().unwrap_or_default();
                out.extend(repos.iter().filter_map(|r| Some(Repo { full_name: r["full_name"].as_str()?.to_owned(), private: r["private"].as_bool().unwrap_or(true), default_branch: r["default_branch"].as_str().unwrap_or("main").to_owned(), installation: id })));
                if repos.len() < 100 {
                    break;
                }
            }
        }
        out.sort_by_key(|r| r.full_name.to_lowercase());
        Ok(out)
    }

    /// Sets a commit status, shown next to the commit on GitHub.
    pub async fn status(&self, installation: i64, repo: &str, sha: &str, s: &Status<'_>) -> Result<(), String> {
        let token = self.installation_token(installation).await?;
        let mut body = json!({ "state": s.state, "context": s.context, "description": s.description.chars().take(140).collect::<String>() });
        if let Some(url) = s.target_url {
            body["target_url"] = json!(url);
        }
        let r = client().post(format!("{API}/repos/{repo}/statuses/{sha}")).bearer_auth(token).header("accept", "application/vnd.github+json").json(&body).send().await.map_err(|e| format!("could not reach GitHub: {}", e.without_url()))?;
        check(r, "set a commit status").await.map(drop)
    }
}

/// The manifest an admin posts to GitHub to create the app in one step.
pub fn manifest(name: &str, public_url: &str) -> Value {
    json!({
        "name": name,
        "url": public_url,
        "hook_attributes": { "url": format!("{public_url}/api/github/webhook"), "active": true },
        "redirect_url": format!("{public_url}/api/github/manifest"),
        "setup_url": format!("{public_url}/admin/github"),
        "public": false,
        "default_permissions": { "contents": "write", "statuses": "write", "metadata": "read" },
        "default_events": ["push"],
    })
}

/// Trades the code GitHub redirects back with for the new app's id and keys.
pub async fn convert_manifest(code: &str) -> Result<Created, String> {
    let code: String = code.chars().filter(|c| c.is_ascii_alphanumeric()).collect();
    let r = client().post(format!("{API}/app-manifests/{code}/conversions")).header("accept", "application/vnd.github+json").send().await.map_err(|e| format!("could not reach GitHub: {}", e.without_url()))?;
    let v = check(r, "create the app").await?;
    let get = |k: &str| v[k].as_str().map(str::to_owned).ok_or_else(|| format!("GitHub did not return {k}"));
    Ok(Created {
        info: AppInfo { id: v["id"].as_u64().ok_or("GitHub did not return an id")?, slug: get("slug")?, name: get("name")?, html_url: get("html_url")?, owner: v["owner"]["login"].as_str().unwrap_or_default().to_owned() },
        pem: get("pem")?,
        webhook_secret: get("webhook_secret")?,
    })
}

/// Checks `X-Hub-Signature-256` in constant time.
pub fn verify_webhook(secret: &[u8], body: &[u8], signature: &str) -> bool {
    let Some(sig) = signature.strip_prefix("sha256=").and_then(|h| hex::decode(h).ok()) else { return false };
    hmac::verify(&hmac::Key::new(hmac::HMAC_SHA256, secret), body, &sig).is_ok()
}

pub fn sign_webhook(secret: &[u8], body: &[u8]) -> String {
    format!("sha256={}", hex::encode(hmac::sign(&hmac::Key::new(hmac::HMAC_SHA256, secret), body).as_ref()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn webhook_signatures_match_github() {
        let body = br#"{"zen":"Keep it logically awesome."}"#;
        let sig = sign_webhook(b"It's a Secret to Everybody", body);
        assert!(verify_webhook(b"It's a Secret to Everybody", body, &sig));
        assert!(!verify_webhook(b"another secret", body, &sig));
        assert!(!verify_webhook(b"It's a Secret to Everybody", b"tampered", &sig));
        assert!(!verify_webhook(b"It's a Secret to Everybody", body, "sha1=abc"));
        assert_eq!(sign_webhook(b"It's a Secret to Everybody", b"Hello, World!"), "sha256=757107ea0eb2509fc211221cce984b8a37570b6d7586c22c46f4379c8b043e17");
    }

    #[test]
    fn manifest_points_back_at_this_instance() {
        let m = manifest("Tessery (example)", "https://tessery.example.com");
        assert_eq!(m["hook_attributes"]["url"], "https://tessery.example.com/api/github/webhook");
        assert_eq!(m["default_permissions"]["contents"], "write");
        assert_eq!(m["default_events"], json!(["push"]));
    }
}
