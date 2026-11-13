use lettre::message::header::ContentType;
use lettre::transport::smtp::authentication::Credentials;
use lettre::{AsyncSmtpTransport, AsyncTransport, Message, Tokio1Executor};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::time::Duration;
use utoipa::ToSchema;

#[derive(Serialize, Deserialize, ToSchema, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct SmtpSettings {
    pub host: String,
    pub port: u16,
    #[serde(default)]
    pub username: String,
    /// The sender, such as `Tessery <tessery@example.com>`.
    pub from: String,
    /// `starttls` (port 587), `tls` (port 465) or `none` (only for a local relay).
    pub security: String,
}

fn transport(s: &SmtpSettings, password: Option<&str>) -> Result<AsyncSmtpTransport<Tokio1Executor>, String> {
    let builder = match s.security.as_str() {
        "tls" => AsyncSmtpTransport::<Tokio1Executor>::relay(&s.host).map_err(|e| e.to_string())?,
        "starttls" => AsyncSmtpTransport::<Tokio1Executor>::starttls_relay(&s.host).map_err(|e| e.to_string())?,
        _ => AsyncSmtpTransport::<Tokio1Executor>::builder_dangerous(&s.host),
    };
    let builder = builder.port(s.port).timeout(Some(Duration::from_secs(15)));
    let builder = if s.username.is_empty() { builder } else { builder.credentials(Credentials::new(s.username.clone(), password.unwrap_or_default().to_owned())) };
    Ok(builder.build())
}

pub async fn send_email(s: &SmtpSettings, password: Option<&str>, to: &str, subject: &str, body: &str) -> Result<(), String> {
    let message = Message::builder()
        .from(s.from.parse().map_err(|e| format!("the sender address is not valid: {e}"))?)
        .to(to.parse().map_err(|e| format!("{to} is not a valid address: {e}"))?)
        .subject(subject)
        .header(ContentType::TEXT_PLAIN)
        .body(body.to_owned())
        .map_err(|e| e.to_string())?;
    transport(s, password)?.send(message).await.map(drop).map_err(|e| format!("the mail server refused the message: {e}"))
}

pub fn valid_sender(from: &str) -> bool {
    from.parse::<lettre::message::Mailbox>().is_ok()
}

pub const EVENTS: &[(&str, &str)] = &[
    ("release.started", "A release starts"),
    ("release.succeeded", "A release goes live"),
    ("release.failed", "A release fails or rolls back"),
    ("approval.requested", "A release waits for approval"),
    ("backup.failed", "A database backup fails"),
];

pub const KINDS: &[&str] = &["email", "slack", "discord", "telegram", "webhook"];

#[derive(Serialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    pub kind: String,
    pub project: String,
    pub env: String,
    pub title: String,
    pub detail: String,
    pub link: Option<String>,
}

impl Event {
    pub fn text(&self) -> String {
        let mut out = format!("{}: {}", self.project, self.title);
        if !self.detail.is_empty() {
            out.push_str(&format!("\n{}", self.detail));
        }
        if let Some(link) = &self.link {
            out.push_str(&format!("\n{link}"));
        }
        out
    }
}

pub struct Delivery<'a> {
    pub kind: &'a str,
    pub target: &'a str,
    pub smtp: Option<(&'a SmtpSettings, Option<&'a str>)>,
}

fn client() -> reqwest::Client {
    reqwest::Client::builder().timeout(Duration::from_secs(15)).user_agent("tessery").build().expect("an HTTP client")
}

async fn post(url: &str, body: Value) -> Result<(), String> {
    let r = client().post(url).json(&body).send().await.map_err(|e| format!("could not reach {}: {e}", host_of(url)))?;
    if r.status().is_success() { Ok(()) } else { Err(format!("{} answered {}", host_of(url), r.status().as_u16())) }
}

fn host_of(url: &str) -> &str {
    url.split("://").nth(1).and_then(|r| r.split('/').next()).unwrap_or(url)
}

pub fn payload(kind: &str, target: &str, e: &Event) -> Result<(String, Value), String> {
    match kind {
        "slack" => Ok((target.to_owned(), json!({ "text": e.text() }))),
        "discord" => Ok((target.to_owned(), json!({ "content": e.text() }))),
        "telegram" => {
            let (token, chat) = target.split_once(':').and_then(|(bot, rest)| rest.rsplit_once('@').map(|(secret, chat)| (format!("{bot}:{secret}"), chat))).ok_or("use bot-token@chat-id")?;
            Ok((format!("https://api.telegram.org/bot{token}/sendMessage"), json!({ "chat_id": chat, "text": e.text(), "disable_web_page_preview": true })))
        }
        "webhook" => Ok((target.to_owned(), json!({ "event": e.kind, "project": e.project, "env": e.env, "title": e.title, "detail": e.detail, "link": e.link }))),
        other => Err(format!("unknown channel {other}")),
    }
}

pub async fn deliver(d: &Delivery<'_>, e: &Event) -> Result<(), String> {
    if d.kind == "email" {
        let (smtp, password) = d.smtp.ok_or("email is not set up on this instance")?;
        for to in d.target.split(',').map(str::trim).filter(|t| !t.is_empty()) {
            send_email(smtp, password, to, &format!("[{}] {}", e.project, e.title), &format!("{}\n", e.text())).await?;
        }
        return Ok(());
    }
    let (url, body) = payload(d.kind, d.target, e)?;
    post(&url, body).await
}

pub fn check_target(kind: &str, target: &str) -> Result<(), String> {
    let t = target.trim();
    match kind {
        "email" if t.split(',').map(str::trim).filter(|x| !x.is_empty()).all(|x| x.parse::<lettre::message::Mailbox>().is_ok()) && !t.is_empty() => Ok(()),
        "email" => Err("use one or more email addresses separated by commas".into()),
        "slack" | "discord" | "webhook" if t.starts_with("https://") || t.starts_with("http://") => Ok(()),
        "slack" | "discord" | "webhook" => Err("use the full webhook URL".into()),
        "telegram" if t.contains(':') && t.contains('@') => Ok(()),
        "telegram" => Err("use bot-token@chat-id, for example 123456:ABC-DEF@-1001234567890".into()),
        other => Err(format!("unknown channel {other}")),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn event() -> Event {
        Event { kind: "release.failed".into(), project: "shop".into(), env: "prod".into(), title: "Release to Production failed".into(), detail: "web did not become healthy".into(), link: Some("https://t.example/projects/1".into()) }
    }

    #[test]
    fn shapes_each_channel_payload() {
        let e = event();
        assert_eq!(payload("slack", "https://hooks.slack.com/x", &e).unwrap().1["text"], e.text());
        assert_eq!(payload("discord", "https://discord.com/api/webhooks/1/a", &e).unwrap().1["content"], e.text());
        let (url, body) = payload("telegram", "123:ABC@-100555", &e).unwrap();
        assert_eq!(url, "https://api.telegram.org/bot123:ABC/sendMessage");
        assert_eq!(body["chat_id"], "-100555");
        assert_eq!(payload("webhook", "https://x.example/hook", &e).unwrap().1["event"], "release.failed");
        assert!(e.text().starts_with("shop: Release to Production failed\n"));
    }

    #[test]
    fn checks_targets_before_saving() {
        assert!(check_target("email", "ops@example.com, dev@example.com").is_ok());
        assert!(check_target("email", "not an address").is_err());
        assert!(check_target("slack", "hooks.slack.com/x").is_err());
        assert!(check_target("telegram", "123:ABC@-100555").is_ok());
    }
}
