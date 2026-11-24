use serde::{Deserialize, Serialize};
use std::time::Duration;

/// A published Tessery release.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Release {
    pub version: String,
    pub name: String,
    /// The release notes, in Markdown.
    pub notes: String,
    pub url: String,
    pub published_at: Option<String>,
    pub prerelease: bool,
}

#[derive(Deserialize)]
struct Raw {
    tag_name: String,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    body: Option<String>,
    #[serde(default)]
    html_url: String,
    #[serde(default)]
    published_at: Option<String>,
    #[serde(default)]
    prerelease: bool,
    #[serde(default)]
    draft: bool,
}

impl Raw {
    fn into_release(self) -> Option<Release> {
        let version = self.tag_name.trim_start_matches('v').to_owned();
        if self.draft || !crate::is_version(&version) {
            return None;
        }
        Some(Release {
            name: self.name.filter(|n| !n.trim().is_empty()).unwrap_or_else(|| self.tag_name.clone()),
            version,
            notes: self.body.unwrap_or_default(),
            url: self.html_url,
            published_at: self.published_at,
            prerelease: self.prerelease,
        })
    }
}

async fn get(url: &str) -> Option<reqwest::Response> {
    let res = reqwest::Client::new()
        .get(url)
        .header("user-agent", "tessery")
        .header("accept", "application/vnd.github+json")
        .timeout(Duration::from_secs(5))
        .send()
        .await
        .map_err(|e| tracing::debug!(error = %e, url, "release lookup failed"))
        .ok()?;
    res.status().is_success().then_some(res)
}

/// The newest published release, or `None` when there is none or GitHub can't be reached.
pub async fn fetch_latest(latest_url: &str) -> Option<Release> {
    get(latest_url).await?.json::<Raw>().await.ok()?.into_release()
}

/// The most recent published releases, newest first, or `None` when GitHub can't be reached.
pub async fn fetch_releases(latest_url: &str) -> Option<Vec<Release>> {
    let list = format!("{}?per_page=30", latest_url.trim_end_matches("/latest"));
    let raw: Vec<Raw> = get(&list).await?.json().await.ok()?;
    Some(raw.into_iter().filter_map(Raw::into_release).collect())
}
