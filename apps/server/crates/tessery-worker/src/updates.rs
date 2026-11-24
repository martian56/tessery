//! Installs new Tessery releases on their own when an instance admin turned automatic updates on.

use std::time::{Duration, Instant};
use tessery_db::audit::NewEvent;
use tessery_update::Updater;

/// How often the latest release is looked up while inside the update window.
const CHECK_EVERY: Duration = Duration::from_secs(15 * 60);

pub struct AutoUpdates {
    updater: Updater,
    current: String,
    releases_url: String,
    last_check: Option<Instant>,
}

impl AutoUpdates {
    pub fn from_env() -> Self {
        Self { updater: Updater::from_env(), current: tessery_update::current_version(), releases_url: tessery_update::releases_url_from_env(), last_check: None }
    }

    /// Starts the updater when automatic updates are on, the current UTC hour is inside the window and a newer
    /// release exists. Runs every minute but asks GitHub at most every fifteen minutes.
    pub async fn tick(&mut self, db: &sqlx::PgPool) -> anyhow::Result<()> {
        if !self.updater.enabled() || !tessery_update::is_version(&self.current) {
            return Ok(());
        }
        let auto = tessery_db::settings::auto_update(db).await?;
        let hour = time::OffsetDateTime::now_utc().hour();
        if !auto.enabled || !tessery_update::in_window(hour, auto.from_hour as u8, auto.to_hour as u8) {
            return Ok(());
        }
        if self.last_check.is_some_and(|t| t.elapsed() < CHECK_EVERY) {
            return Ok(());
        }
        self.last_check = Some(Instant::now());
        let Some(latest) = tessery_update::fetch_latest(&self.releases_url).await else { return Ok(()) };
        if !tessery_update::is_newer(&latest.version, &self.current) {
            return Ok(());
        }
        match self.updater.start(&latest.version).await {
            Ok(()) => {}
            Err(tessery_update::UpdateError::AlreadyRunning) => return Ok(()),
            Err(e) => return Err(e.into()),
        }
        tracing::info!(from = %self.current, to = %latest.version, "started an automatic update");
        tessery_db::updates::record(db, &self.current, &latest.version, "update", None).await?;
        tessery_db::audit::insert(
            db,
            NewEvent {
                org_id: None,
                actor_id: None,
                actor_email: None,
                action: "system.update".into(),
                resource_type: "instance".into(),
                resource_id: Some("instance".into()),
                result: Some(tessery_db::types::AuditResult::Allowed),
                ip: None,
                user_agent: None,
                details: serde_json::json!({ "from": self.current, "to": latest.version, "trigger": "automatic" }),
            },
        )
        .await?;
        Ok(())
    }
}
