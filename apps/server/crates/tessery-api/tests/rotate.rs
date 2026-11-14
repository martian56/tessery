mod common;

use common::doc;
use reqwest::StatusCode;
use serde_json::{Value, json};
use sqlx::PgPool;
use tessery_api::rotate::reencrypt;
use tessery_core::SecretKey;

fn key(c: char) -> SecretKey {
    SecretKey::parse(&c.to_string().repeat(64)).unwrap()
}

async fn stored(db: &PgPool) -> (Vec<u8>, Vec<u8>) {
    let secret: Vec<u8> = sqlx::query_scalar("SELECT cipher FROM environment_secrets").fetch_one(db).await.unwrap();
    let target: Vec<u8> = sqlx::query_scalar("SELECT target FROM notification_channels").fetch_one(db).await.unwrap();
    (secret, target)
}

#[tokio::test]
async fn rotation_moves_every_value_to_the_new_key() {
    let app = common::spawn_with(|c| c.notify_allow_private = true).await;
    let (admin, org) = app.setup().await;
    let mut d = doc("shop");
    d["environments"] = json!([{ "id": "prod", "name": "Production" }]);
    let project: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": d })).await.json().await.unwrap();
    let pid = project["id"].as_str().unwrap();
    let put = admin.put(&format!("/api/projects/{pid}/environments/prod/secrets/DB_PASSWORD"), json!({ "value": "hunter22-hunter22" })).await;
    assert_eq!(put.status(), StatusCode::OK, "{}", put.text().await.unwrap_or_default());
    let ch = admin.post(&format!("/api/projects/{pid}/notifications"), json!({ "name": "ops", "kind": "webhook", "target": "https://hooks.example/abc", "events": ["release.failed"] })).await;
    assert_eq!(ch.status(), StatusCode::CREATED);

    let url = std::env::var("TESSERY_TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://tessery:tessery@127.0.0.1:15432/tessery".into());
    let url = format!("{}/{}", url.rsplit_once('/').unwrap().0, app.db_name);
    let db = PgPool::connect(&url).await.unwrap();

    let (old, new, stranger) = (key('7'), key('8'), key('9'));
    let before = stored(&db).await;
    assert!(new.decrypt(&before.0).is_err());

    let err = reencrypt(&db, &stranger).await.unwrap_err();
    assert!(err.to_string().contains("environment secrets"), "{err}");
    assert_eq!(stored(&db).await, before, "a failed rotation changes nothing");

    let report = reencrypt(&db, &new.clone().with_previous(old.clone())).await.unwrap();
    let get = |what: &str| report.iter().find(|c| c.what == what).map(|c| (c.total, c.changed)).unwrap();
    assert_eq!(get("environment secrets"), (1, 1));
    assert_eq!(get("notification targets"), (1, 1));
    assert_eq!(get("server SSH keys"), (0, 0));

    let after = stored(&db).await;
    assert_eq!(new.decrypt(&after.0).unwrap(), b"hunter22-hunter22");
    assert_eq!(new.decrypt(&after.1).unwrap(), b"https://hooks.example/abc");
    assert!(old.decrypt(&after.0).is_err(), "the old key no longer opens anything");

    let again = reencrypt(&db, &new).await.unwrap();
    assert_eq!(again.iter().map(|c| c.changed).sum::<u64>(), 0, "running it twice is harmless");
}
