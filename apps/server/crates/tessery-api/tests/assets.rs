mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};

fn png(w: u32, h: u32) -> Vec<u8> {
    [b"\x89PNG\r\n\x1a\n".as_slice(), &[0, 0, 0, 13], b"IHDR", &w.to_be_bytes(), &h.to_be_bytes(), &[8, 6, 0, 0, 0]].concat()
}

#[tokio::test]
async fn images_are_stored_checked_and_served_safely() {
    if std::env::var("TESSERY_TEST_S3_ENDPOINT").is_err() {
        eprintln!("skipped: set TESSERY_TEST_S3_ENDPOINT to an S3 endpoint such as the dev SeaweedFS");
        return;
    }
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let project: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("shop") })).await.json().await.unwrap();
    let pid = project["id"].as_str().unwrap().to_owned();
    let http = reqwest::Client::builder().cookie_store(true).build().unwrap();
    let login = http.post(format!("{}/api/auth/login", app.base)).header("x-tessery-csrf", "1").json(&json!({ "email": "admin@example.com", "password": "admin-password-1" })).send().await.unwrap();
    assert_eq!(login.status(), StatusCode::OK);
    let upload = |name: &str, body: Vec<u8>| http.post(format!("{}/api/projects/{pid}/assets/upload?name={name}", app.base)).header("x-tessery-csrf", "1").body(body).send();

    let ok = upload("Hero Shot.png", png(1600, 900)).await.unwrap();
    assert_eq!(ok.status(), StatusCode::CREATED);
    let asset: Value = ok.json().await.unwrap();
    assert_eq!(asset["name"], "hero-shot.png");
    assert_eq!((asset["width"].as_i64(), asset["height"].as_i64()), (Some(1600), Some(900)));
    assert!(asset["reference"].as_str().unwrap().starts_with("asset:"));

    let fake = upload("cat.png", b"<html><script>alert(1)</script></html>".to_vec()).await.unwrap();
    assert_eq!(fake.status(), StatusCode::UNPROCESSABLE_ENTITY, "content decides the type, not the name");
    let big = upload("big.png", [png(10, 10), vec![0u8; 11 * 1024 * 1024]].concat()).await.unwrap();
    assert_eq!(big.status(), StatusCode::PAYLOAD_TOO_LARGE);

    let served = http.get(format!("{}{}", app.base, asset["url"].as_str().unwrap())).send().await.unwrap();
    assert_eq!(served.status(), StatusCode::OK);
    assert_eq!(served.headers()["content-type"], "image/png");
    assert_eq!(served.headers()["x-content-type-options"], "nosniff");
    assert!(served.headers()["content-security-policy"].to_str().unwrap().contains("sandbox"));
    assert_eq!(served.bytes().await.unwrap().to_vec(), png(1600, 900));

    let list: Value = admin.json(&format!("/api/projects/{pid}/assets")).await;
    assert_eq!(list.as_array().unwrap().len(), 1);

    let (viewer, _) = add_member(&app, &admin, org, "viewer@example.com", "viewer").await;
    assert_eq!(viewer.get(asset["url"].as_str().unwrap()).await.status(), StatusCode::OK, "readers of the project may load its images");
    assert_eq!(viewer.delete(&format!("/api/projects/{pid}/assets/{}", asset["id"].as_str().unwrap())).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(app.session().get(asset["url"].as_str().unwrap()).await.status(), StatusCode::UNAUTHORIZED, "assets are private to the project");

    assert_eq!(admin.delete(&format!("/api/projects/{pid}/assets/{}", asset["id"].as_str().unwrap())).await.status(), StatusCode::OK);
    assert_eq!(admin.get(asset["url"].as_str().unwrap()).await.status(), StatusCode::NOT_FOUND);
}
