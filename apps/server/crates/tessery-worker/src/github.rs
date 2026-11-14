use crate::jobs::Ctx;
use anyhow::{Context, Result, anyhow};
use serde_json::json;
use tessery_cloud::github::{self as gh, AppInfo};
use tessery_db::delivery::NewCheckpoint;
use tessery_git::{Adopted, GitError, Remote};
use uuid::Uuid;

pub async fn app(ctx: &Ctx) -> Result<Option<gh::App>> {
    let row = tessery_db::github::app(&ctx.db).await?;
    let (Some(info), Some(cipher)) = (row.app, row.key) else { return Ok(None) };
    let info: AppInfo = serde_json::from_value(info)?;
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker, so the GitHub App key cannot be read"))?;
    let pem = String::from_utf8(key.decrypt(&cipher)?)?;
    Ok(Some(gh::App::new(info.id, &pem).map_err(|e| anyhow!(e))?))
}

/// Imports a new `main` from GitHub as a checkpoint, then pushes Tessery's branches and tags back without forcing.
pub async fn sync(ctx: &Ctx, project: Uuid) -> Result<()> {
    let Some(link) = tessery_db::github::linked(&ctx.db, project).await? else { return Ok(()) };
    let app = app(ctx).await?.ok_or_else(|| anyhow!("the GitHub App is not set up on this instance"))?;
    let token = app.installation_token(link.installation).await.map_err(|e| anyhow!(e))?;
    let remote = Remote { url: format!("https://github.com/{}.git", link.repo), username: Some("x-access-token".into()), token: Some(token) };
    let repo = ctx.repos.ensure(project).await?;

    let imported = import(ctx, project, &link, &repo, &remote).await;
    let import_error = imported.as_ref().err().map(|e| format!("{e:#}"));
    tessery_db::github::record_import(&ctx.db, project, import_error.as_deref()).await?;
    match &imported {
        Ok(Some(seq)) => tracing::info!(%project, repo = %link.repo, seq, "imported a push from GitHub as a checkpoint"),
        Ok(None) => {}
        Err(e) => tracing::warn!(%project, repo = %link.repo, error = %e, "importing from GitHub failed"),
    }

    let (branches, tags) = tessery_db::delivery::ref_targets(&ctx.db, project).await?;
    repo.sync_refs(&branches, &tags).await?;
    let pushed = repo.push_safe(&remote).await;
    let push_error = pushed.as_ref().err().map(|e| match e {
        GitError::Diverged(_) => "GitHub has commits on main that Tessery could not import; see the import error".to_owned(),
        e => e.to_string(),
    });
    tessery_db::delivery::record_push(&ctx.db, project, push_error.as_deref()).await?;
    Ok(())
}

async fn import(ctx: &Ctx, project: Uuid, link: &tessery_db::github::Linked, repo: &tessery_git::Repo, remote: &Remote) -> Result<Option<i32>> {
    let Some(incoming) = repo.fetch_main(remote).await? else { return Ok(None) };
    let author = tessery_git::Author { name: "Tessery".into(), email: "tessery@localhost".into() };
    let (commit, restored) = match repo.adopt(&incoming, &author).await {
        Ok(Adopted::UpToDate) => return Ok(None),
        Ok(Adopted::Moved { commit, restored_deploy }) => (commit, restored_deploy),
        Err(GitError::Diverged(_)) => {
            return Err(anyhow!("main on GitHub and main in Tessery have diverged. Merge Tessery's main into GitHub's main (or the other way) so one contains the other, then push again"));
        }
        Err(e) => return Err(e.into()),
    };
    let created_by = link.linked_by.ok_or_else(|| anyhow!("the person who linked this repository no longer exists; link it again"))?;
    let saved = tessery_db::projects::get(&ctx.db, project).await?;
    let subject = repo.subject(&incoming).await?;
    let name: String = if subject.is_empty() { format!("GitHub {}", &incoming[..7]) } else { subject.chars().take(80).collect() };
    let mut message = format!("Pushed to {} at {}", link.repo, &incoming[..12]);
    if restored {
        message.push_str(". Changes to deploy/ were left out; deploy files come from the design");
    }
    let files = repo.file_count(&commit).await? as i32;
    let mut tx = ctx.db.begin().await?;
    tessery_db::delivery::lock_project(&mut tx, project).await?;
    let id = tessery_db::delivery::insert_checkpoint(
        &mut tx,
        NewCheckpoint { project_id: project, name: &name, message: &message, version: saved.version, commit_sha: &commit, file_count: files, created_by },
    )
    .await?;
    let row = tessery_db::delivery::get_checkpoint(&mut *tx, project, id).await?;
    tessery_db::audit::insert(
        &mut *tx,
        tessery_db::audit::NewEvent {
            org_id: Some(saved.org_id),
            actor_email: Some(format!("github:{}", link.repo)),
            action: "checkpoint.import".into(),
            resource_type: "project".into(),
            resource_id: Some(project.to_string()),
            result: Some(tessery_db::types::AuditResult::Allowed),
            details: json!({ "checkpoint": row.seq, "commit": commit, "pushed": incoming, "restoredDeploy": restored }),
            ..Default::default()
        },
    )
    .await?;
    tx.commit().await.context("saving the imported checkpoint")?;
    Ok(Some(row.seq))
}

/// Reports a release on GitHub as a commit status. Failures are logged, never fatal.
pub async fn report(ctx: &Ctx, project: Uuid, commit: &str, env: &str, release: Uuid, state: &str, description: &str) {
    let outcome = async {
        let Some(link) = tessery_db::github::linked(&ctx.db, project).await? else { return Ok(()) };
        let Some(app) = app(ctx).await? else { return Ok(()) };
        let target = std::env::var("TESSERY_PUBLIC_URL").ok().filter(|u| !u.trim().is_empty()).map(|u| format!("{}/projects/{project}?release={release}", u.trim().trim_end_matches('/')));
        let context = format!("tessery/{env}");
        let status = gh::Status { state, context: &context, description, target_url: target.as_deref() };
        app.status(link.installation, &link.repo, commit, &status).await.map_err(|e| anyhow!(e))
    };
    match tokio::time::timeout(std::time::Duration::from_secs(15), outcome).await {
        Ok(Ok(())) => {}
        Ok(Err(e)) => tracing::warn!(%project, error = %e, "could not report the release to GitHub"),
        Err(_) => tracing::warn!(%project, "reporting the release to GitHub timed out"),
    }
}
