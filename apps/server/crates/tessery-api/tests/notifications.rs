mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncReadExt, AsyncWriteExt};

async fn http_sink(status: u16) -> (String, Arc<Mutex<Vec<String>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://127.0.0.1:{}/hook/secret-part", listener.local_addr().unwrap().port());
    let seen = Arc::new(Mutex::new(Vec::new()));
    let store = seen.clone();
    tokio::spawn(async move {
        loop {
            let (mut stream, _) = listener.accept().await.unwrap();
            let mut buf = vec![0u8; 16384];
            let mut got = 0;
            loop {
                let n = stream.read(&mut buf[got..]).await.unwrap();
                got += n;
                let text = String::from_utf8_lossy(&buf[..got]).to_string();
                if let Some((head, body)) = text.split_once("\r\n\r\n") {
                    let len = head.lines().find_map(|l| l.to_ascii_lowercase().strip_prefix("content-length:").map(|v| v.trim().parse::<usize>().unwrap())).unwrap_or(0);
                    if body.len() >= len {
                        store.lock().unwrap().push(body.to_owned());
                        break;
                    }
                }
                if n == 0 {
                    break;
                }
            }
            let reply = format!("HTTP/1.1 {status} X\r\ncontent-length: 0\r\nconnection: close\r\n\r\n");
            let _ = stream.write_all(reply.as_bytes()).await;
        }
    });
    (url, seen)
}

#[tokio::test]
async fn channels_keep_targets_secret_and_deliver_tests() {
    let (url, seen) = http_sink(200).await;
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let project: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("shop") })).await.json().await.unwrap();
    let project = project["id"].as_str().unwrap().to_owned();
    let base = format!("/api/projects/{project}/notifications");

    let bad = admin.post(&base, json!({ "name": "ops", "kind": "slack", "target": "hooks.slack.com/x", "events": ["release.failed"] })).await;
    assert_eq!(bad.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let unknown = admin.post(&base, json!({ "name": "ops", "kind": "webhook", "target": url, "events": ["release.exploded"] })).await;
    assert_eq!(unknown.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let created = admin.post(&base, json!({ "name": "ops", "kind": "webhook", "target": url, "events": ["release.failed", "release.succeeded"], "envs": ["prod"] })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let channel: Value = created.json().await.unwrap();
    assert!(!channel.to_string().contains("secret-part"), "the full target is never returned: {channel}");
    let id = channel["id"].as_str().unwrap().to_owned();

    assert_eq!(admin.post(&format!("{base}/{id}/test"), json!({})).await.status(), StatusCode::OK);
    let body: Value = serde_json::from_str(seen.lock().unwrap().last().unwrap()).unwrap();
    assert_eq!(body["event"], "test");
    assert_eq!(body["project"], "shop");
    let listed: Value = admin.json(&base).await;
    assert!(listed[0]["lastSentAt"].is_string());
    assert!(listed[0]["lastError"].is_null());

    let paused = admin.put(&format!("{base}/{id}"), json!({ "name": "ops", "events": ["release.failed"], "enabled": false })).await;
    assert_eq!(paused.status(), StatusCode::OK);
    assert_eq!(paused.json::<Value>().await.unwrap()["enabled"], false);

    let (viewer, _) = add_member(&app, &admin, org, "viewer@example.com", "viewer").await;
    assert_eq!(viewer.post(&base, json!({ "name": "mine", "kind": "webhook", "target": "https://x.example/h", "events": ["release.failed"] })).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(viewer.delete(&format!("{base}/{id}")).await.status(), StatusCode::FORBIDDEN);

    let (down, _) = http_sink(500).await;
    let broken: Value = admin.post(&base, json!({ "name": "down", "kind": "discord", "target": down, "events": ["backup.failed"] })).await.json().await.unwrap();
    let failed = admin.post(&format!("{base}/{}/test", broken["id"].as_str().unwrap()), json!({})).await;
    assert_eq!(failed.status(), StatusCode::CONFLICT);
    let listed: Value = admin.json(&base).await;
    assert!(listed[1]["lastError"].as_str().unwrap().contains("500"));

    assert_eq!(admin.delete(&format!("{base}/{id}")).await.status(), StatusCode::OK);
    assert_eq!(admin.json(&base).await.as_array().unwrap().len(), 1);
}
