mod common;

use axum::http::StatusCode;
use common::{add_member, doc};
use serde_json::{Value, json};

#[tokio::test]
async fn checking_a_cluster_needs_deploy_rights_a_namespace_and_a_kubeconfig() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let p: Value =
        admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("Shop") })).await.json().await.unwrap();
    let pid = p["id"].as_str().unwrap();
    let check = format!("/api/projects/{pid}/environments/prod/kubernetes/check");

    let (viewer, _) = add_member(&app, &admin, org, "viewer@example.com", "viewer").await;
    assert_eq!(viewer.post(&check, json!({ "namespace": "shop-prod" })).await.status(), StatusCode::FORBIDDEN);

    for bad in ["", "Shop", "--all-namespaces", "a b"] {
        assert_eq!(
            admin.post(&check, json!({ "namespace": bad })).await.status(),
            StatusCode::UNPROCESSABLE_ENTITY,
            "{bad:?}"
        );
    }

    let r = admin.post(&check, json!({ "namespace": "shop-prod" })).await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    let body: Value = r.json().await.unwrap();
    assert!(body["error"]["message"].as_str().unwrap().contains("no KUBECONFIG secret"), "{body}");
}
