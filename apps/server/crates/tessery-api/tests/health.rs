mod common;

use tessery_core::heartbeat::{WORKER_HEARTBEAT_KEY, WORKER_HEARTBEAT_TTL_SECS};

/// A Redis database of its own, so a development worker beating into database 0 can't refresh the key between the
/// test's steps, and the test's cleanup doesn't delete that worker's heartbeat.
const ISOLATED_DB: u8 = 15;

fn redis_url() -> String {
    let base = std::env::var("TESSERY_TEST_REDIS_URL").unwrap_or_else(|_| "redis://127.0.0.1:16379".to_owned());
    format!("{}/{ISOLATED_DB}", base.trim_end_matches('/'))
}

async fn redis() -> redis::aio::MultiplexedConnection {
    redis::Client::open(redis_url().as_str())
        .expect("parse the Redis URL")
        .get_multiplexed_async_connection()
        .await
        .expect("connect to test Redis; is `docker compose up -d` running?")
}

#[tokio::test]
async fn health_follows_the_worker_heartbeat() {
    let app = common::spawn_with(|c| c.redis_url = redis_url()).await;
    let mut conn = redis().await;

    let _: () = redis::cmd("DEL").arg(WORKER_HEARTBEAT_KEY).query_async(&mut conn).await.unwrap();
    let res = app.session().get("/api/health").await;
    assert_eq!(res.status(), reqwest::StatusCode::SERVICE_UNAVAILABLE);
    let body: serde_json::Value = res.json().await.unwrap();
    assert_eq!(body["worker"], false);
    assert_eq!(body["status"], "degraded");

    let _: () = redis::cmd("SET")
        .arg(WORKER_HEARTBEAT_KEY)
        .arg("1")
        .arg("EX")
        .arg(WORKER_HEARTBEAT_TTL_SECS)
        .query_async(&mut conn)
        .await
        .unwrap();
    let body: serde_json::Value = app.session().get("/api/health").await.json().await.unwrap();
    assert_eq!(body["worker"], true);

    let _: () = redis::cmd("DEL").arg(WORKER_HEARTBEAT_KEY).query_async(&mut conn).await.unwrap();
}
