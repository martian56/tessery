use anyhow::{Context, Result, bail};
use sqlx::{AssertSqlSafe, PgPool, Row};
use tessery_core::SecretKey;

/// Every column that holds a value encrypted with the server key: (table, column, what it is).
pub const ENCRYPTED: &[(&str, &str, &str)] = &[
    ("environment_secrets", "cipher", "environment secrets"),
    ("project_remotes", "token_cipher", "git remote tokens"),
    ("servers", "private_key", "server SSH keys"),
    ("integrations", "secret", "provider credentials"),
    ("notification_channels", "target", "notification targets"),
    ("users", "totp_secret", "two-factor secrets"),
    ("instance_settings", "smtp_password", "the SMTP password"),
];

#[derive(Debug, Default, PartialEq, Eq)]
pub struct Count {
    pub what: &'static str,
    pub total: u64,
    pub changed: u64,
}

/// Re-encrypts every stored value with the current key, in one transaction.
/// Values that were written with the previous key count as changed. Nothing is written if any value cannot be read.
pub async fn reencrypt(db: &PgPool, key: &SecretKey) -> Result<Vec<Count>> {
    let mut tx = db.begin().await?;
    let mut report = Vec::new();
    for (table, column, what) in ENCRYPTED {
        let rows = sqlx::query(AssertSqlSafe(format!("SELECT ctid::text AS id, {column} AS value FROM {table} WHERE {column} IS NOT NULL FOR UPDATE")))
            .fetch_all(&mut *tx)
            .await
            .with_context(|| format!("reading {what}"))?;
        let mut count = Count { what, ..Default::default() };
        for row in rows {
            let id: String = row.get("id");
            let value: Vec<u8> = row.get("value");
            let Ok((plain, previous)) = key.decrypt_tracked(&value) else {
                bail!("a value in {what} ({table}.{column}) cannot be read with the current or the previous key; nothing was changed");
            };
            sqlx::query(AssertSqlSafe(format!("UPDATE {table} SET {column} = $1 WHERE ctid = $2::tid")))
                .bind(key.encrypt(&plain))
                .bind(&id)
                .execute(&mut *tx)
                .await
                .with_context(|| format!("writing {what}"))?;
            count.total += 1;
            count.changed += u64::from(previous);
        }
        report.push(count);
    }
    tx.commit().await?;
    Ok(report)
}

pub async fn run_command() -> Result<()> {
    let key = SecretKey::from_env()?.context("TESSERY_SECRET_KEY is not set")?;
    if !key.has_previous() {
        println!("TESSERY_SECRET_KEY_PREVIOUS is not set, so every value is simply re-encrypted with the current key.");
    }
    let url = std::env::var("TESSERY_DATABASE_URL").context("TESSERY_DATABASE_URL is not set")?;
    let db = PgPool::connect(&url).await.context("connecting to Postgres")?;
    let report = reencrypt(&db, &key).await?;
    let changed: u64 = report.iter().map(|c| c.changed).sum();
    for c in &report {
        println!("{:<24} {:>5} stored, {:>5} moved from the previous key", c.what, c.total, c.changed);
    }
    println!("Done. {changed} values moved to the new key.");
    if key.has_previous() {
        println!("Redeploy environments that send telemetry so they get new tokens, then remove TESSERY_SECRET_KEY_PREVIOUS and restart the server and worker.");
    }
    Ok(())
}
