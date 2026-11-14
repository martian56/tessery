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

pub async fn send(ctx: &Ctx, project: Uuid, env: &str, release: Option<Uuid>, event: &str, title: &str, detail: &str) -> Result<()> {
    let channels = tessery_db::notifications::subscribed(&ctx.db, project, event, env).await?;
    if channels.is_empty() {
        return Ok(());
    }
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker, so notification targets cannot be read"))?;
    let saved = tessery_db::projects::get(&ctx.db, project).await?;
    let link = std::env::var("TESSERY_PUBLIC_URL").ok().filter(|u| !u.trim().is_empty()).map(|u| match release {
        Some(r) => format!("{}/projects/{project}?release={r}", u.trim().trim_end_matches('/')),
        None => format!("{}/projects/{project}", u.trim().trim_end_matches('/')),
    });
    let e = Event { kind: event.to_owned(), project: saved.name.clone(), env: env.to_owned(), title: title.to_owned(), detail: detail.to_owned(), link };
    let mail = if channels.iter().any(|c| c.kind == "email") {
        smtp(ctx).await.map_err(|e| format!("the email settings cannot be read: {e}")).and_then(|m| m.ok_or_else(|| "email is not set up on this instance".to_owned()))
    } else {
        Err("email is not set up on this instance".to_owned())
    };
    let allow_private = std::env::var("TESSERY_NOTIFY_ALLOW_PRIVATE").is_ok_and(|v| matches!(v.as_str(), "1" | "true" | "yes"));
    for c in channels {
        let outcome = match key.decrypt(&c.target).map_err(|e| e.to_string()).and_then(|t| String::from_utf8(t).map_err(|e| e.to_string())) {
            Ok(target) => {
                let smtp = match &mail {
                    Ok((s, p)) => Ok((s, p.as_deref())),
                    Err(err) => Err(err.as_str()),
                };
                tessery_notify::deliver(&Delivery { kind: &c.kind, target: &target, smtp, allow_private }, &e).await
            }
            Err(err) => Err(format!("the saved target cannot be read: {err}")),
        };
        if let Err(err) = &outcome {
            tracing::warn!(channel = %c.id, error = %err, "a notification was not delivered");
        }
        tessery_db::notifications::record(&ctx.db, c.id, outcome.err().as_deref()).await?;
    }
    Ok(())
}

pub async fn send_quietly(ctx: &Ctx, project: Uuid, env: &str, release: Option<Uuid>, event: &str, title: &str, detail: &str) {
    if let Err(e) = send(ctx, project, env, release, event, title, detail).await {
        tracing::warn!(error = %e, %project, event, "notifications failed");
    }
}
