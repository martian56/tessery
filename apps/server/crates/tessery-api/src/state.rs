use crate::config::Config;
use tessery_db::PgPool;
use tessery_engine::Engine;
use tessery_git::Repos;
use tessery_mq::Mq;
use redis::aio::ConnectionManager;
use std::sync::Arc;

#[derive(Clone)]
pub struct AppState {
    pub db: PgPool,
    pub redis: ConnectionManager,
    pub mq: Mq,
    pub repos: Repos,
    pub engine: Engine,
    pub config: Arc<Config>,
}
