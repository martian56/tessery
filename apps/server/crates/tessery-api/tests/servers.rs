mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn servers_keep_their_keys_and_only_managers_change_them() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;

    let bad = admin.post(&format!("/api/orgs/{org}/servers"), json!({ "name": "vps", "address": "deploy@203.0.113.7" })).await;
    assert_eq!(bad.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let r = admin.post(&format!("/api/orgs/{org}/servers"), json!({ "name": "vps", "address": "ssh://deploy@203.0.113.7:2222" })).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let server: Value = r.json().await.unwrap();
    let id = server["id"].as_str().unwrap().to_owned();
    assert!(server["publicKey"].as_str().unwrap().starts_with("ssh-ed25519 "), "a key pair is generated");
    assert_eq!(server["hostKeyPinned"], false);
    let listed = admin.get(&format!("/api/orgs/{org}/servers")).await.text().await.unwrap();
    assert!(!listed.contains("PRIVATE KEY"), "the private key never leaves the server");

    let pasted = admin.post(&format!("/api/orgs/{org}/servers"), json!({ "name": "other", "address": "ssh://root@198.51.100.4", "privateKey": "not a key" })).await;
    assert_eq!(pasted.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let (dev, _) = add_member(&app, &admin, org, "dev@example.com", "editor").await;
    let seen: Value = dev.json(&format!("/api/orgs/{org}/servers")).await;
    assert_eq!(seen.as_array().unwrap().len(), 1, "editors can pick servers");
    let refused = dev.patch(&format!("/api/orgs/{org}/servers/{id}"), json!({ "newKey": true })).await;
    assert_eq!(refused.status(), StatusCode::FORBIDDEN);

    let mut d = doc("Shop");
    d["environments"] = json!([{ "id": "prod", "name": "Production", "target": { "kind": "docker", "server": id, "host": "ssh://deploy@203.0.113.7:2222" } }]);
    let created = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": d })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let used: Value = admin.json(&format!("/api/orgs/{org}/servers")).await;
    assert_eq!(used[0]["usedBy"][0]["env"], "Production");
    let blocked = admin.delete(&format!("/api/orgs/{org}/servers/{id}")).await;
    assert_eq!(blocked.status(), StatusCode::CONFLICT);

    let rotated: Value = admin.patch(&format!("/api/orgs/{org}/servers/{id}"), json!({ "newKey": true, "name": "vps-1" })).await.json().await.unwrap();
    assert_eq!(rotated["name"], "vps-1");
    assert_ne!(rotated["publicKey"], server["publicKey"]);
}
