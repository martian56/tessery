pub mod audit;
pub mod bindings;
pub mod delivery;
pub mod error;
pub mod orgs;
pub mod projects;
pub mod roles;
pub mod servers;
pub mod settings;
pub mod teams;
pub mod telemetry;
pub mod tokens;
pub mod types;
pub mod users;

pub use error::{DbError, DbResult};
pub use sqlx::{PgPool, Postgres, Transaction};

use sqlx::postgres::PgPoolOptions;
use std::time::Duration;

pub static MIGRATOR: sqlx::migrate::Migrator = sqlx::migrate!("./migrations");

pub async fn connect(url: &str, max_connections: u32) -> Result<PgPool, sqlx::Error> {
    PgPoolOptions::new()
        .max_connections(max_connections)
        .acquire_timeout(Duration::from_secs(5))
        .connect(url)
        .await
}

pub async fn migrate(pool: &PgPool) -> Result<(), sqlx::migrate::MigrateError> {
    MIGRATOR.run(pool).await
}
