mod backups;
mod deploy;
mod dns;
mod github;
mod jobs;
mod notify;
mod provision;

use anyhow::Context;
use tessery_mq::Mq;
use std::time::Duration;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env().unwrap_or_else(|_| EnvFilter::new("info,sqlx=warn")),
        )
        .init();
    let db_url = std::env::var("TESSERY_DATABASE_URL").context("TESSERY_DATABASE_URL is required")?;
    let amqp_url = std::env::var("TESSERY_AMQP_URL").context("TESSERY_AMQP_URL is required")?;
    let db = tessery_db::connect(&db_url, 5)
        .await
        .context("connecting to Postgres")?;
    tessery_db::migrate(&db).await.context("running migrations")?;
    let mq = Mq::connect(&amqp_url, "tessery-worker")
        .await
        .context("connecting to RabbitMQ")?;
    let secret_key = tessery_core::SecretKey::from_env()?;
    let data_dir = std::env::var("TESSERY_DATA_DIR").unwrap_or_else(|_| "./data".to_owned());
    let ctx = std::sync::Arc::new(jobs::Ctx { db: db.clone(), repos: tessery_git::Repos::new(data_dir), secret_key, runner: deploy::RunnerConfig::from_env() });
    for id in tessery_db::delivery::fail_interrupted(&db).await? {
        tracing::warn!(release_id = %id, "marked a deploy interrupted by the last shutdown as failed");
    }
    tracing::info!("tessery-worker started");

    let sweeper = {
        let db = db.clone();
        let mq = mq.clone();
        tokio::spawn(async move {
            let mut tick = tokio::time::interval(Duration::from_secs(60));
            loop {
                tick.tick().await;
                if let Err(e) = jobs::sweep_expired_grants(&db).await {
                    tracing::error!(error = %e, "sweeping expired grants failed");
                }
                if let Err(e) = backups::schedule(&db, &mq).await {
                    tracing::error!(error = %e, "scheduling backups failed");
                }
            }
        })
    };

    let consume = mq.consume("tessery-worker", 4, |env| {
        let ctx = ctx.clone();
        async move {
            tracing::info!(job_id = %env.id, job = %env.job.summary(), "running job");
            jobs::run(&ctx, env.job).await
        }
    });

    tokio::select! {
        r = consume => r.context("consumer stopped")?,
        _ = tokio::signal::ctrl_c() => tracing::info!("shutting down"),
    }
    sweeper.abort();
    Ok(())
}
