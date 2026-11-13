use crate::deploy::{Log, RunnerConfig, ensure_runner_image};
use crate::jobs::Ctx;
use anyhow::{Context, Result, anyhow, bail};
use serde_json::{Map, Value};
use std::process::Stdio;
use tessery_db::backups as db;
use time::OffsetDateTime;
use tokio::io::AsyncWriteExt;
use tokio::process::Command;
use uuid::Uuid;

pub const DEFAULT_BUCKET: &str = "tessery-backups";

struct Dump {
    save: &'static str,
    load: &'static str,
    ext: &'static str,
}

fn dump_for(tech: &str) -> Option<Dump> {
    match tech {
        "postgres" | "timescaledb" | "pgvector" => Some(Dump {
            save: r#"pg_dump -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-app}" --clean --if-exists --no-owner | gzip -c"#,
            load: r#"gunzip -c | psql -q -v ON_ERROR_STOP=1 -U "${POSTGRES_USER:-app}" -d "${POSTGRES_DB:-app}""#,
            ext: "sql.gz",
        }),
        "mysql" => Some(Dump {
            save: r#"mysqldump -uapp -p"$MYSQL_PASSWORD" --single-transaction --routines app | gzip -c"#,
            load: r#"gunzip -c | mysql -uapp -p"$MYSQL_PASSWORD" app"#,
            ext: "sql.gz",
        }),
        "mariadb" => Some(Dump {
            save: r#"mariadb-dump -uapp -p"$MARIADB_PASSWORD" --single-transaction --routines app | gzip -c"#,
            load: r#"gunzip -c | mariadb -uapp -p"$MARIADB_PASSWORD" app"#,
            ext: "sql.gz",
        }),
        "mongodb" => Some(Dump {
            save: r#"mongodump --quiet --archive --gzip -u app -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin"#,
            load: r#"mongorestore --quiet --archive --gzip --drop -u app -p "$MONGO_INITDB_ROOT_PASSWORD" --authenticationDatabase admin"#,
            ext: "archive.gz",
        }),
        _ => None,
    }
}

struct Place {
    stack: String,
    server: Option<(String, Vec<(String, String)>)>,
    tech: String,
    policy: Value,
    org: Uuid,
    project_slug: String,
}

async fn locate(ctx: &Ctx, b: &db::Backup) -> Result<Place> {
    let head = tessery_db::delivery::heads(&ctx.db, b.project_id).await?.into_iter().find(|h| h.env_key == b.env_key).ok_or_else(|| anyhow!("nothing runs in {} right now", b.env_key))?;
    let checkpoint = tessery_db::delivery::get_checkpoint(&ctx.db, b.project_id, head.checkpoint_id).await?;
    let repo = ctx.repos.open(b.project_id).await?;
    let plan: Value = serde_json::from_slice(&repo.read_file(&checkpoint.commit_sha, &format!("deploy/{}/plan.json", b.env_key)).await?)?;
    if plan.pointer("/target/kind").and_then(Value::as_str) != Some("docker") {
        bail!("backups only work for environments that run on Docker");
    }
    if plan.pointer("/target/server").is_none() && plan.pointer("/target/host").and_then(Value::as_str).is_some_and(|h| h.starts_with("ssh://")) {
        bail!("add this machine as a server under Organization, Servers to back it up");
    }
    let project = tessery_db::projects::get(&ctx.db, b.project_id).await?;
    let doc = &project.doc;
    let node = doc["nodes"].as_array().into_iter().flatten().find(|n| n["name"] == b.node.as_str()).ok_or_else(|| anyhow!("{} is no longer in the design", b.node))?;
    let env = doc["environments"].as_array().into_iter().flatten().find(|e| e["id"] == b.env_key.as_str()).ok_or_else(|| anyhow!("{} is no longer in the design", b.env_key))?;
    let slug = plan["project"].as_str().unwrap_or_default().to_owned();
    Ok(Place {
        stack: format!("{slug}-{}", b.env_key).to_lowercase().replace('.', "-"),
        server: crate::deploy::server_connection(ctx, b.project_id, &plan["target"]).await?,
        tech: node["techId"].as_str().unwrap_or_default().to_owned(),
        policy: env["backups"].clone(),
        org: project.org_id,
        project_slug: slug,
    })
}

async fn storage(ctx: &Ctx, place: &Place) -> Result<(tessery_cloud::S3, String)> {
    let key = ctx.secret_key.as_ref().ok_or_else(|| anyhow!("TESSERY_SECRET_KEY is not set on the worker"))?;
    let id: Uuid = place.policy["integration"].as_str().ok_or_else(|| anyhow!("choose where backups go in the environment settings"))?.parse()?;
    let (provider, cipher) = tessery_db::integrations::secret(&ctx.db, place.org, id).await.context("the backup storage account was disconnected")?;
    if provider != "cloudflare" {
        bail!("backups go to Cloudflare R2 for now; {provider} is not supported yet");
    }
    let fields: Map<String, Value> = serde_json::from_slice(&key.decrypt(&cipher)?)?;
    let s3 = tessery_cloud::S3::r2(&fields, &tessery_cloud::endpoints_from_env()).ok_or_else(|| anyhow!("add R2 access keys to the Cloudflare account to store backups"))?;
    let bucket = place.policy["bucket"].as_str().filter(|b| !b.is_empty()).unwrap_or(DEFAULT_BUCKET).to_owned();
    Ok((s3, bucket))
}

async fn exec(cfg: &RunnerConfig, place: &Place, node: &str, command: &str, input: Option<Vec<u8>>) -> Result<Vec<u8>> {
    use base64::Engine as _;
    let b64 = |s: &str| base64::engine::general_purpose::STANDARD.encode(s.replace("\r\n", "\n").trim_end().to_owned() + "\n");
    let (address, key, known) = match &place.server {
        Some((address, values)) => {
            let get = |k: &str| values.iter().find(|(n, _)| n == k).map(|(_, v)| b64(v)).unwrap_or_default();
            (address.clone(), get("SSH_PRIVATE_KEY"), get("SSH_KNOWN_HOSTS"))
        }
        None => (String::new(), String::new(), String::new()),
    };
    let script = format!(
        "{}cid=$(docker ps -q --filter label=com.docker.compose.project=\"$STACK\" --filter label=com.docker.compose.service=\"$NODE\" | head -n1); [ -n \"$cid\" ] || {{ echo \"$NODE is not running\" >&2; exit 3; }}; exec docker exec -i \"$cid\" sh -c \"$COMMAND\"",
        if address.is_empty() { "" } else { tessery_core::runner::SSH_SETUP }
    );
    let volume = format!("{}:/var/run/docker.sock", cfg.socket);
    let mut child = Command::new(&cfg.docker)
        .args(["run", "--rm", "-i", "-v", &volume, "-e", "SSH_KEY_B64", "-e", "KNOWN_B64", "-e", "REMOTE_DOCKER_HOST", "-e", "STACK", "-e", "NODE", "-e", "COMMAND", &tessery_core::runner::image(), "sh", "-c", &script])
        .env("SSH_KEY_B64", key)
        .env("KNOWN_B64", known)
        .env("REMOTE_DOCKER_HOST", &address)
        .env("STACK", &place.stack)
        .env("NODE", node)
        .env("COMMAND", command)
        .stdin(if input.is_some() { Stdio::piped() } else { Stdio::null() })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .context("running docker")?;
    if let (Some(data), Some(mut pipe)) = (input, child.stdin.take()) {
        tokio::spawn(async move {
            let _ = pipe.write_all(&data).await;
        });
    }
    let out = child.wait_with_output().await?;
    if !out.status.success() {
        let err = String::from_utf8_lossy(&out.stderr);
        bail!("{}", err.lines().rev().find(|l| !l.trim().is_empty()).unwrap_or("the command failed").trim());
    }
    Ok(out.stdout)
}

pub async fn backup(ctx: &Ctx, id: Uuid) -> Result<()> {
    let b = db::get(&ctx.db, id).await?;
    db::set_status(&ctx.db, id, "running", "").await?;
    match run_backup(ctx, &b).await {
        Ok(()) => tracing::info!(backup = %id, node = %b.node, "backup done"),
        Err(e) => {
            tracing::warn!(backup = %id, error = %e, "backup failed");
            db::set_status(&ctx.db, id, "failed", &format!("{e:#}")).await?;
        }
    }
    Ok(())
}

async fn run_backup(ctx: &Ctx, b: &db::Backup) -> Result<()> {
    let place = locate(ctx, b).await?;
    let dump = dump_for(&place.tech).ok_or_else(|| anyhow!("{} backups are not supported yet", place.tech))?;
    let (s3, bucket) = storage(ctx, &place).await?;
    ensure_runner_image(&ctx.runner, &Log::start(ctx.db.clone(), None)).await?;
    let data = exec(&ctx.runner, &place, &b.node, dump.save, None).await?;
    if data.len() < 20 {
        bail!("the dump came back empty");
    }
    s3.ensure_bucket(&bucket).await.map_err(|e| anyhow!(e))?;
    let now = OffsetDateTime::now_utc();
    let stamp = format!("{:04}-{:02}-{:02}T{:02}-{:02}-{:02}Z", now.year(), now.month() as u8, now.day(), now.hour(), now.minute(), now.second());
    let key = format!("{}/{}/{}/{stamp}.{}", place.project_slug, b.env_key, b.node, dump.ext);
    s3.put(&bucket, &key, &data).await.map_err(|e| anyhow!(e))?;
    db::finish(&ctx.db, b.id, &bucket, &key, data.len() as i64).await?;
    let keep = place.policy["keep"].as_u64().unwrap_or(7).max(1) as usize;
    for old in db::done_for_node(&ctx.db, b.project_id, &b.env_key, &b.node).await?.into_iter().skip(keep) {
        if s3.delete(&old.bucket, &old.object_key).await.is_ok() {
            db::forget(&ctx.db, old.id).await?;
        }
    }
    Ok(())
}

pub async fn restore(ctx: &Ctx, id: Uuid) -> Result<()> {
    let b = db::get(&ctx.db, id).await?;
    db::set_status(&ctx.db, id, "restoring", "").await?;
    let result = async {
        let place = locate(ctx, &b).await?;
        let dump = dump_for(&place.tech).ok_or_else(|| anyhow!("{} restores are not supported yet", place.tech))?;
        let (s3, _) = storage(ctx, &place).await?;
        let data = s3.get(&b.bucket, &b.object_key).await.map_err(|e| anyhow!(e))?;
        ensure_runner_image(&ctx.runner, &Log::start(ctx.db.clone(), None)).await?;
        exec(&ctx.runner, &place, &b.node, dump.load, Some(data)).await?;
        anyhow::Ok(())
    }
    .await;
    match result {
        Ok(()) => db::set_status(&ctx.db, id, "restored", "").await?,
        Err(e) => {
            tracing::warn!(backup = %id, error = %e, "restore failed");
            db::set_status(&ctx.db, id, "done", &format!("restore failed: {e:#}")).await?
        }
    }
    Ok(())
}

fn due(every: &str, last: Option<OffsetDateTime>) -> bool {
    let gap = match every {
        "hourly" => time::Duration::hours(1),
        "weekly" => time::Duration::days(7),
        _ => time::Duration::days(1),
    };
    last.is_none_or(|t| OffsetDateTime::now_utc() - t >= gap)
}

pub async fn schedule(db_pool: &tessery_db::PgPool, mq: &tessery_mq::Mq) -> Result<()> {
    for p in db::projects_with_backups(db_pool).await? {
        let heads = tessery_db::delivery::heads(db_pool, p.id).await?;
        for env in p.doc["environments"].as_array().into_iter().flatten() {
            let Some(every) = env.pointer("/backups/every").and_then(Value::as_str) else { continue };
            let Some(key) = env["id"].as_str() else { continue };
            if !heads.iter().any(|h| h.env_key == key) || !due(every, db::last_started(db_pool, p.id, key).await?) {
                continue;
            }
            for node in p.doc["nodes"].as_array().into_iter().flatten().filter(|n| n["techId"].as_str().and_then(dump_for).is_some()) {
                let b = db::create(db_pool, p.id, key, node["name"].as_str().unwrap_or_default(), "scheduled", None).await?;
                mq.publish(tessery_mq::Job::Backup { backup_id: b.id }).await.map_err(|e| anyhow!(e))?;
            }
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn knows_how_to_dump_each_supported_store() {
        assert!(dump_for("postgres").unwrap().save.starts_with("pg_dump"));
        assert_eq!(dump_for("mongodb").unwrap().ext, "archive.gz");
        assert!(dump_for("redis").is_none());
    }

    #[test]
    fn schedules_by_the_policy() {
        let now = OffsetDateTime::now_utc();
        assert!(due("daily", None));
        assert!(!due("daily", Some(now - time::Duration::hours(3))));
        assert!(due("hourly", Some(now - time::Duration::minutes(61))));
        assert!(!due("weekly", Some(now - time::Duration::days(6))));
    }
}
