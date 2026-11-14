mod common;

use reqwest::StatusCode;
use serde_json::json;
use sqlx::PgPool;
use tessery_cloud::github::sign_webhook;
use tessery_core::SecretKey;

#[tokio::test]
async fn webhooks_need_a_valid_signature() {
    let app = common::spawn().await;
    let (_admin, _org) = app.setup().await;
    let http = reqwest::Client::new();
    let hook = format!("{}/api/github/webhook", app.base);
    let body = json!({ "ref": "refs/heads/main", "repository": { "full_name": "acme/shop" }, "after": "abc" }).to_string();

    let unset = http.post(&hook).header("x-github-event", "push").header("x-hub-signature-256", sign_webhook(b"s3cret", body.as_bytes())).body(body.clone()).send().await.unwrap();
    assert_eq!(unset.status(), StatusCode::NOT_FOUND, "no app, no webhook");

    let url = std::env::var("TESSERY_TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://tessery:tessery@127.0.0.1:15432/tessery".into());
    let db = PgPool::connect(&format!("{}/{}", url.rsplit_once('/').unwrap().0, app.db_name)).await.unwrap();
    let key = SecretKey::parse(&"7".repeat(64)).unwrap();
    sqlx::query("UPDATE instance_settings SET github_app = $1, github_webhook_secret = $2")
        .bind(json!({ "id": 1, "slug": "tessery-test", "name": "Tessery test", "htmlUrl": "https://github.com/apps/tessery-test", "owner": "acme" }))
        .bind(key.encrypt(b"s3cret"))
        .execute(&db)
        .await
        .unwrap();

    let unsigned = http.post(&hook).header("x-github-event", "push").body(body.clone()).send().await.unwrap();
    assert_eq!(unsigned.status(), StatusCode::FORBIDDEN, "without a signature the CSRF guard still applies");
    let forged = http.post(&hook).header("x-github-event", "push").header("x-hub-signature-256", sign_webhook(b"guess", body.as_bytes())).body(body.clone()).send().await.unwrap();
    assert_eq!(forged.status(), StatusCode::UNAUTHORIZED);
    let tampered = http.post(&hook).header("x-github-event", "push").header("x-hub-signature-256", sign_webhook(b"s3cret", body.as_bytes())).body(body.replace("shop", "bank")).send().await.unwrap();
    assert_eq!(tampered.status(), StatusCode::UNAUTHORIZED);

    let ping = json!({ "zen": "hi" }).to_string();
    let ok = http.post(&hook).header("x-github-event", "ping").header("x-hub-signature-256", sign_webhook(b"s3cret", ping.as_bytes())).body(ping).send().await.unwrap();
    assert_eq!(ok.status(), StatusCode::ACCEPTED);
    let push = http.post(&hook).header("x-github-event", "push").header("x-hub-signature-256", sign_webhook(b"s3cret", body.as_bytes())).body(body).send().await.unwrap();
    assert_eq!(push.status(), StatusCode::ACCEPTED);
}
