mod common;

use axum::http::StatusCode;
use serde_json::{Value, json};


async fn releases(tag: &'static str) -> String {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/releases/latest", listener.local_addr().unwrap());
    let app = axum::Router::new().route(
        "/releases/latest",
        axum::routing::get(move || async move {
            axum::Json(json!({ "tag_name": tag, "html_url": format!("https://github.com/martian56/tessery/releases/tag/{tag}") }))
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

async fn version(current: &str, url: String) -> Value {
    let current = current.to_owned();
    let app = common::spawn_with(move |c| {
        c.version = current;
        c.releases_url = url;
    })
    .await;
    let (s, _) = app.setup().await;
    let r = s.get("/api/system/version").await;
    assert_eq!(r.status(), StatusCode::OK);
    r.json().await.unwrap()
}

#[tokio::test]
async fn reports_an_update_only_when_a_newer_release_exists() {
    let newer = version("0.1.0", releases("v0.2.0").await).await;
    assert_eq!(newer["current"], "0.1.0");
    assert_eq!(newer["latest"], "0.2.0");
    assert_eq!(newer["releaseUrl"], "https://github.com/martian56/tessery/releases/tag/v0.2.0");
    assert_eq!(newer["updateAvailable"], true);

    let same = version("0.2.0", releases("v0.2.0").await).await;
    assert_eq!(same["updateAvailable"], false);

    let older = version("0.3.0", releases("v0.2.0").await).await;
    assert_eq!(older["latest"], "0.2.0");
    assert_eq!(older["updateAvailable"], false);

    let dev = version("dev", releases("v0.2.0").await).await;
    assert_eq!(dev["current"], "dev");
    assert_eq!(dev["updateAvailable"], false, "a dev build never reports an update");
}

#[tokio::test]
async fn an_unreachable_github_leaves_latest_empty() {
    let v = version("0.1.0", "http://127.0.0.1:9/releases/latest".into()).await;
    assert_eq!(v["latest"], Value::Null);
    assert_eq!(v["updateAvailable"], false);
}

#[tokio::test]
async fn requires_a_signed_in_user() {
    let app = common::spawn().await;
    app.setup().await;
    assert_eq!(app.session().get("/api/system/version").await.status(), StatusCode::UNAUTHORIZED);
}

