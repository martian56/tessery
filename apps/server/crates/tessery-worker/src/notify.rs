use crate::jobs::Ctx;
use anyhow::{Result, anyhow};
use serde_json::Value;
use tessery_notify::{Delivery, Event, SmtpSettings};
use uuid::Uuid;

pub fn env_name(doc: &Value, env: &str) -> String {
    doc["environments"].as_array().into_iter().flatten().find(|e| e["id"] == env).and_then(|e| e["name"].as_str()).unwrap_or(env).to_owned()
}

async fn smtp(ctx: &Ctx) -> Result<Option<(SmtpSettings, Option<String>)>> {
    let row = tessery_db::settings::smtp(&ctx.db).await?;
    let Some(raw) = row.smtp else { return Ok(None) };
    let settings: SmtpSettings = serde_json::from_value(raw)?;
    let password = match (row.smtp_password, ctx.secret_key.as_ref()) {
        (Some(cipher), Some(key)) => Some(String::from_utf8(key.decrypt(&cipher)?)?),
        _ => None,
    };
    Ok(Some((settings, password)))
}

pub async fn send(ctx: &Ctx, project: Uuid, env: &str, event: &str, title: &str, detail: &str) -> Result<()> {
    let channels = tessery_db::notifications::subscribed(&ctx.db, project, event, env).await?;
    if channels.is_empty() {
        return Ok(());
    }
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker, so notification targets cannot be read"))?;
    let saved = tessery_db::projects::get(&ctx.db, project).await?;
    let link = std::env::var("TESSERY_PUBLIC_URL").ok().filter(|u| !u.trim().is_empty()).map(|u| format!("{}/projects/{project}", u.trim().trim_end_matches('/')));
    let e = Event { kind: event.to_owned(), project: saved.name.clone(), env: env.to_owned(), title: title.to_owned(), detail: detail.to_owned(), link };
    let mail = if channels.iter().any(|c| c.kind == "email") { smtp(ctx).await? } else { None };
    for c in channels {
        let outcome = match key.decrypt(&c.target).map_err(|e| e.to_string()).and_then(|t| String::from_utf8(t).map_err(|e| e.to_string())) {
            Ok(target) => tessery_notify::deliver(&Delivery { kind: &c.kind, target: &target, smtp: mail.as_ref().map(|(s, p)| (s, p.as_deref())) }, &e).await,
            Err(err) => Err(format!("the saved target cannot be read: {err}")),
        };
        if let Err(err) = &outcome {
            tracing::warn!(channel = %c.id, error = %err, "a notification was not delivered");
        }
        tessery_db::notifications::record(&ctx.db, c.id, outcome.err().as_deref()).await?;
    }
    Ok(())
}

pub async fn send_quietly(ctx: &Ctx, project: Uuid, env: &str, event: &str, title: &str, detail: &str) {
    if let Err(e) = send(ctx, project, env, event, title, detail).await {
        tracing::warn!(error = %e, %project, event, "notifications failed");
    }
}
