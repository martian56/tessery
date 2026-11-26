mod common;

use axum::http::StatusCode;
use common::add_member;
use serde_json::{Value, json};

async fn releases() -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let base = format!("http://{}/releases", listener.local_addr().unwrap());
    let app = axum::Router::new()
        .route(
            "/releases",
            axum::routing::get(|| async {
                axum::Json(json!([
                    { "tag_name": "v0.2.0", "name": "", "body": "Adds updates", "html_url": "https://example.com/v0.2.0", "published_at": "2026-11-20T10:00:00Z", "prerelease": false, "draft": false },
                    { "tag_name": "v0.2.0-rc.1", "body": "Candidate", "html_url": "https://example.com/rc", "prerelease": true, "draft": false },
                    { "tag_name": "v0.3.0", "body": "Not out yet", "html_url": "", "prerelease": false, "draft": true },
                    { "tag_name": "nightly", "body": "", "html_url": "", "prerelease": false, "draft": false },
                ]))
            }),
        )
        .route(
            "/releases/latest",
            axum::routing::get(|| async { axum::Json(json!({ "tag_name": "v0.2.0", "html_url": "https://example.com/v0.2.0" })) }),
        );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    format!("{base}/latest")
}

#[tokio::test]
async fn only_instance_admins_can_update_or_read_update_details() {
    let app = common::spawn_with(|c| c.version = "0.1.0".into()).await;
    let (admin, org) = app.setup().await;
    let (member, _) = add_member(&app, &admin, org, "owner@example.com", "owner").await;
    assert_eq!(member.post("/api/system/update", json!({ "version": "0.2.0" })).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(member.get("/api/system/updates").await.status(), StatusCode::FORBIDDEN);
    assert_eq!(member.get("/api/system/releases").await.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        app.session().post("/api/system/update", json!({ "version": "0.2.0" })).await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn updates_are_refused_with_a_clear_message_when_turned_off() {
    let app = common::spawn_with(|c| c.version = "0.1.0".into()).await;
    let (admin, _) = app.setup().await;

    let info: Value = admin.json("/api/system/updates").await;
    assert_eq!(info["enabled"], false);
    assert_eq!(info["current"], "0.1.0");
    assert_eq!(info["rollbackTo"], Value::Null);

    let r = admin.post("/api/system/update", json!({ "version": "0.2.0" })).await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    let body: Value = r.json().await.unwrap();
    assert!(body["error"]["message"].as_str().unwrap().contains("TESSERY_COMPOSE_DIR"), "{body}");

    let r = admin.put("/api/admin/settings", json!({ "autoUpdate": true })).await;
    assert_eq!(r.status(), StatusCode::CONFLICT, "automatic updates can't be turned on either");

    let info: Value = admin.json("/api/system/updates").await;
    assert_eq!(info["history"], json!([]), "nothing was recorded");
}

#[tokio::test]
async fn checks_the_target_version_before_starting() {
    let app = common::spawn_with(|c| {
        c.version = "0.2.0".into();
        c.updater.compose_dir = Some("/opt/tessery".into());
    })
    .await;
    let (admin, _) = app.setup().await;
    assert_eq!(
        admin.post("/api/system/update", json!({ "version": "latest" })).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    assert_eq!(
        admin.post("/api/system/update", json!({ "version": "0.2.0" })).await.status(),
        StatusCode::CONFLICT,
        "already on it"
    );
    assert_eq!(
        admin.post("/api/system/update", json!({ "version": "v0.2.0" })).await.status(),
        StatusCode::CONFLICT,
        "a leading v is the same version"
    );
}

#[tokio::test]
async fn automatic_update_window_is_an_admin_setting() {
    let app = common::spawn_with(|c| c.updater.compose_dir = Some("/opt/tessery".into())).await;
    let (admin, _) = app.setup().await;
    let s: Value = admin.json("/api/admin/settings").await;
    assert_eq!(
        (s["autoUpdate"].clone(), s["autoUpdateFrom"].clone(), s["autoUpdateTo"].clone()),
        (json!(false), json!(3), json!(5)),
        "off by default"
    );

    assert_eq!(
        admin.put("/api/admin/settings", json!({ "autoUpdateFrom": 24 })).await.status(),
        StatusCode::UNPROCESSABLE_ENTITY
    );
    let r =
        admin.put("/api/admin/settings", json!({ "autoUpdate": true, "autoUpdateFrom": 22, "autoUpdateTo": 2 })).await;
    assert_eq!(r.status(), StatusCode::OK);
    let s: Value = r.json().await.unwrap();
    assert_eq!(
        (s["autoUpdate"].clone(), s["autoUpdateFrom"].clone(), s["autoUpdateTo"].clone()),
        (json!(true), json!(22), json!(2))
    );
    assert_eq!(s["allowOrgCreation"], true, "other settings keep their value");
}

#[tokio::test]
async fn lists_published_releases_for_the_changelog() {
    let url = releases().await;
    let app = common::spawn_with(move |c| c.releases_url = url).await;
    let (admin, _) = app.setup().await;
    let list: Value = admin.json("/api/system/releases").await;
    let releases = list["releases"].as_array().unwrap();
    let versions: Vec<&str> = releases.iter().map(|r| r["version"].as_str().unwrap()).collect();
    assert_eq!(versions, ["0.2.0", "0.2.0-rc.1"], "drafts and tags that aren't versions are left out");
    assert_eq!(releases[0]["name"], "v0.2.0", "an empty name falls back to the tag");
    assert_eq!(releases[0]["notes"], "Adds updates");
    assert_eq!(releases[1]["prerelease"], true);

    let app = common::spawn().await;
    let (admin, _) = app.setup().await;
    let list: Value = admin.json("/api/system/releases").await;
    assert_eq!(list["releases"], Value::Null, "GitHub can't be reached");
}

#[tokio::test]
async fn rollback_only_offers_an_older_version() {
    let app = common::spawn_with(|c| c.version = "0.1.0".into()).await;
    let (admin, _) = app.setup().await;
    let url = std::env::var("TESSERY_TEST_DATABASE_URL")
        .unwrap_or_else(|_| "postgres://tessery:tessery@127.0.0.1:15432/tessery".into());
    let pool = sqlx::PgPool::connect(&format!("{}/{}", url.rsplit_once('/').unwrap().0, app.db_name)).await.unwrap();
    tessery_db::updates::record(&pool, "0.1.0", "0.2.0", "update", None).await.unwrap();
    tessery_db::updates::record(&pool, "0.2.0", "0.1.0", "rollback", None).await.unwrap();
    let info: Value = admin.json("/api/system/updates").await;
    assert_eq!(
        info["rollbackTo"],
        Value::Null,
        "after rolling back from 0.2.0, going to 0.2.0 is an update, not a rollback"
    );
    assert_eq!(info["history"].as_array().unwrap().len(), 2);
}
