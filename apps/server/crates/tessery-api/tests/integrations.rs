mod common;

use axum::Router;
use axum::http::{HeaderMap, StatusCode as Http};
use axum::routing::get;
use common::add_member;
use reqwest::StatusCode;
use serde_json::{Value, json};

async fn fake_digitalocean() -> String {
    async fn account(headers: HeaderMap) -> (Http, String) {
        if headers.get("authorization").and_then(|v| v.to_str().ok()) == Some("Bearer dop_v1_good_token_123") {
            (Http::OK, json!({ "account": { "email": "ops@example.com", "team": { "name": "Shop" } } }).to_string())
        } else {
            (Http::UNAUTHORIZED, json!({ "id": "unauthorized", "message": "Unable to authenticate you" }).to_string())
        }
    }
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    let routes = Router::new()
        .route("/v2/account", get(account))
        .route("/v2/regions", get(|| async { json!({ "regions": [{ "slug": "fra1", "name": "Frankfurt 1", "available": true }] }).to_string() }))
        .route("/v2/sizes", get(|| async { json!({ "sizes": [{ "slug": "s-1vcpu-1gb", "description": "Basic", "memory": 1024, "vcpus": 1, "disk": 25, "price_monthly": 6.0, "price_hourly": 0.00893, "regions": ["fra1"], "available": true }] }).to_string() }))
        .route("/v2/droplets", axum::routing::post(|body: String| async move {
            let v: Value = serde_json::from_str(&body).unwrap();
            assert!(v["user_data"].as_str().unwrap().contains("ssh-ed25519 "), "the new machine trusts Tessery's key");
            (Http::ACCEPTED, json!({ "droplet": { "id": 4242, "status": "new" } }).to_string())
        }))
        .route("/v2/droplets/{id}", axum::routing::delete(|| async { Http::NO_CONTENT }));
    tokio::spawn(async move { axum::serve(listener, routes).await.unwrap() });
    format!("http://{addr}/v2")
}

#[tokio::test]
async fn cloud_accounts_are_checked_before_they_are_saved() {
    let api = fake_digitalocean().await;
    let app = common::spawn_with(|c| {
        c.provider_apis.insert("digitalocean".into(), api);
    })
    .await;
    let (admin, org) = app.setup().await;

    let providers: Value = admin.json("/api/integrations/providers").await;
    assert!(providers.as_array().unwrap().iter().any(|p| p["id"] == "aws"));

    let missing = admin.post(&format!("/api/orgs/{org}/integrations"), json!({ "provider": "digitalocean", "name": "main", "fields": {} })).await;
    assert_eq!(missing.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let wrong = admin.post(&format!("/api/orgs/{org}/integrations"), json!({ "provider": "digitalocean", "name": "main", "fields": { "token": "dop_v1_wrong" } })).await;
    assert_eq!(wrong.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let body: Value = wrong.json().await.unwrap();
    assert!(body.to_string().contains("rejected the credentials"), "{body}");
    assert!(admin.json(&format!("/api/orgs/{org}/integrations")).await.as_array().unwrap().is_empty(), "nothing is saved");

    let ok = admin.post(&format!("/api/orgs/{org}/integrations"), json!({ "provider": "digitalocean", "name": "main", "fields": { "token": "dop_v1_good_token_123" } })).await;
    assert_eq!(ok.status(), StatusCode::CREATED);
    let saved: Value = ok.json().await.unwrap();
    assert_eq!(saved["lastCheck"]["account"], "ops@example.com (Shop)");
    let listed = admin.get(&format!("/api/orgs/{org}/integrations")).await.text().await.unwrap();
    assert!(!listed.contains("dop_v1_good_token_123"), "the token is never shown again");

    let (dev, _) = add_member(&app, &admin, org, "dev@example.com", "editor").await;
    assert_eq!(dev.json(&format!("/api/orgs/{org}/integrations")).await.as_array().unwrap().len(), 1);
    let id = saved["id"].as_str().unwrap();
    assert_eq!(dev.delete(&format!("/api/orgs/{org}/integrations/{id}")).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(admin.post(&format!("/api/orgs/{org}/integrations/{id}/check"), json!({})).await.status(), StatusCode::OK);

    let catalog: Value = admin.json(&format!("/api/orgs/{org}/integrations/{id}/catalog")).await;
    assert_eq!(catalog["sizes"][0]["id"], "s-1vcpu-1gb");
    assert_eq!(catalog["sizes"][0]["monthlyUsd"], 6.0);
    let created = admin.post(&format!("/api/orgs/{org}/servers/provision"), json!({ "integrationId": id, "name": "do-1", "region": "fra1", "size": "s-1vcpu-1gb" })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let server: Value = created.json().await.unwrap();
    assert_eq!(server["status"], "creating");
    assert_eq!(server["managed"], true);
    assert_eq!(server["provider"], "digitalocean");
    let sid = server["id"].as_str().unwrap();
    assert_eq!(admin.delete(&format!("/api/orgs/{org}/servers/{sid}?deleteMachine=true")).await.status(), StatusCode::OK);
    assert!(admin.json(&format!("/api/orgs/{org}/servers")).await.as_array().unwrap().is_empty());
    assert_eq!(admin.delete(&format!("/api/orgs/{org}/integrations/{id}")).await.status(), StatusCode::OK);
}
