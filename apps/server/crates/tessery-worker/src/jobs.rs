use anyhow::Result;
use tessery_db::PgPool;
use tessery_db::audit::{Event, Filter, NewEvent};
use tessery_db::types::AuditResult;
use tessery_mq::Job;
use serde_json::json;
use uuid::Uuid;

const EXPORT_PAGE: i64 = 1000;
const EXPORT_MAX_ROWS: usize = 200_000;

pub struct Ctx {
    pub db: PgPool,
    pub repos: tessery_git::Repos,
    pub secret_key: Option<tessery_core::SecretKey>,
    pub runner: crate::deploy::RunnerConfig,
}

pub async fn run(ctx: &Ctx, job: Job) -> Result<()> {
    match job {
        Job::AuditExport { export_id } => audit_export(&ctx.db, export_id).await,
        Job::SweepExpiredGrants => sweep_expired_grants(&ctx.db).await,
        Job::PushRemote { project_id } => push_remote(ctx, project_id).await,
        Job::Deploy { release_id } => crate::deploy::deploy(ctx, release_id).await,
        Job::Teardown { project_id, env, plan, kubeconfig, mut connection, server, destroy } => {
            if let Some(k) = kubeconfig {
                connection.push(("KUBECONFIG".into(), k));
            }
            let r = crate::deploy::teardown(ctx, project_id, &env, &plan, &connection, server.as_ref(), destroy).await;
            match &r {
                Ok(()) => tracing::info!(%project_id, env, destroy, "environment torn down"),
                Err(e) => tracing::warn!(%project_id, env, error = %e, "teardown failed"),
            }
            r
        }
    }
}

pub async fn after_release(ctx: &Ctx, project: Uuid) {
    let synced = async {
        let (branches, tags) = tessery_db::delivery::ref_targets(&ctx.db, project).await?;
        ctx.repos.open(project).await?.sync_refs(&branches, &tags).await?;
        anyhow::Ok(())
    }
    .await;
    if let Err(e) = synced {
        tracing::error!(error = %e, %project, "git refs are behind the database; the next push will retry");
    }
    match tessery_db::delivery::get_remote(&ctx.db, project).await {
        Ok(Some(r)) if r.auto_push => {
            if let Err(e) = push_remote(ctx, project).await {
                tracing::warn!(error = %e, %project, "push after release failed");
            }
        }
        Ok(_) => {}
        Err(e) => tracing::warn!(error = %e, %project, "could not read the project remote"),
    }
}

async fn push_remote(ctx: &Ctx, project: Uuid) -> Result<()> {
    let Some(remote) = tessery_db::delivery::get_remote(&ctx.db, project).await? else {
        tracing::info!(%project, "remote was removed before the push ran");
        return Ok(());
    };
    let outcome = async {
        let repo = ctx.repos.open(project).await?;
        let (branches, tags) = tessery_db::delivery::ref_targets(&ctx.db, project).await?;
        repo.sync_refs(&branches, &tags).await?;
        let token = match (&remote.token_cipher, &ctx.secret_key) {
            (None, _) => None,
            (Some(c), Some(key)) => Some(String::from_utf8(key.decrypt(c)?)?),
            (Some(_), None) => anyhow::bail!("TESSERY_SECRET_KEY is not set on the worker, so the stored token cannot be read"),
        };
        let username = Some(remote.username.clone()).filter(|u| !u.is_empty());
        repo.push(&tessery_git::Remote { url: remote.url.clone(), username, token }).await?;
        anyhow::Ok(())
    }
    .await;
    let error = outcome.as_ref().err().map(|e| e.to_string());
    tessery_db::delivery::record_push(&ctx.db, project, error.as_deref()).await?;
    match error {
        Some(e) => tracing::warn!(%project, error = %e, "push to remote failed"),
        None => tracing::info!(%project, url = %remote.url, "pushed to remote"),
    }
    Ok(())
}

async fn audit_export(db: &PgPool, id: Uuid) -> Result<()> {
    let Some(export) = tessery_db::audit::claim_export(db, id).await? else {
        tracing::info!(export_id = %id, "export already claimed or finished, skipping");
        return Ok(());
    };
    match build_export(
        db,
        export.org_id,
        &export.format,
        serde_json::from_value(export.filters).unwrap_or_default(),
    )
    .await
    {
        Ok((rows, content)) => tessery_db::audit::finish_export(db, id, rows as i32, &content).await?,
        Err(e) => {
            tessery_db::audit::fail_export(db, id, &e.to_string()).await?;
            return Err(e);
        }
    }
    Ok(())
}

async fn build_export(
    db: &PgPool,
    org: Uuid,
    format: &str,
    filter: Filter,
) -> Result<(usize, String)> {
    let mut events: Vec<Event> = Vec::new();
    let mut before = None;
    loop {
        let page = tessery_db::audit::list(db, org, &filter, before, EXPORT_PAGE).await?;
        let done = (page.len() as i64) < EXPORT_PAGE;
        before = page.last().map(|e| e.id);
        events.extend(page);
        if done || events.len() >= EXPORT_MAX_ROWS {
            break;
        }
    }
    events.truncate(EXPORT_MAX_ROWS);
    let content = match format {
        "csv" => to_csv(&events),
        _ => serde_json::to_string_pretty(&events)?,
    };
    Ok((events.len(), content))
}

fn csv_field(s: &str) -> String {
    if s.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", s.replace('"', "\"\""))
    } else {
        s.to_owned()
    }
}

fn to_csv(events: &[Event]) -> String {
    let mut out =
        String::from("id,at,actor_email,action,resource_type,resource_id,result,ip,details\n");
    for e in events {
        let at =
            e.at.format(&time::format_description::well_known::Rfc3339)
                .unwrap_or_default();
        let result = serde_json::to_value(e.result)
            .ok()
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        let row = [
            e.id.to_string(),
            at,
            e.actor_email.clone().unwrap_or_default(),
            e.action.clone(),
            e.resource_type.clone(),
            e.resource_id.clone().unwrap_or_default(),
            result,
            e.ip.clone().unwrap_or_default(),
            e.details.to_string(),
        ];
        out.push_str(
            &row.iter()
                .map(|f| csv_field(f))
                .collect::<Vec<_>>()
                .join(","),
        );
        out.push('\n');
    }
    out
}

pub async fn sweep_expired_grants(db: &PgPool) -> Result<()> {
    let mut tx = db.begin().await?;
    let removed = tessery_db::bindings::delete_expired(&mut *tx).await?;
    for b in &removed {
        tessery_db::audit::insert(
            &mut *tx,
            NewEvent {
                org_id: Some(b.org_id),
                action: "access.expire".into(),
                resource_type: "binding".into(),
                resource_id: Some(b.id.to_string()),
                result: Some(AuditResult::Allowed),
                actor_email: Some("system".into()),
                details: json!({ "role": b.role_key, "subjectKind": b.subject_kind, "subjectId": b.subject_id }),
                ..Default::default()
            },
        )
        .await?;
    }
    tx.commit().await?;
    if !removed.is_empty() {
        tracing::info!(count = removed.len(), "removed expired access grants");
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::csv_field;

    #[test]
    fn csv_escapes_special_characters() {
        assert_eq!(csv_field("plain"), "plain");
        assert_eq!(csv_field("a,b"), "\"a,b\"");
        assert_eq!(csv_field("say \"hi\""), "\"say \"\"hi\"\"\"");
    }
}
