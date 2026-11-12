mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn saves_are_versioned_and_reject_stale_edits() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let p: Value = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Shop") }),
        )
        .await
        .json()
        .await
        .unwrap();
    let id = p["id"].as_str().unwrap();
    assert_eq!(p["version"], 1);
    assert_eq!(p["slug"], "shop");
    assert_eq!(p["doc"]["id"], id);

    let mut d = doc("Shop v2");
    d["nodes"] = json!([{ "id": "n1" }, { "id": "n2" }]);
    let saved: Value = admin
        .put(
            &format!("/api/projects/{id}"),
            json!({ "version": 1, "doc": d, "message": "add services" }),
        )
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(saved["version"], 2);
    assert_eq!(saved["doc"]["name"], "Shop v2");

    let r = admin
        .put(
            &format!("/api/projects/{id}"),
            json!({ "version": 1, "doc": doc("Lost update") }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["code"],
        "stale_version"
    );

    let list: Value = admin.json(&format!("/api/orgs/{org}/projects")).await;
    assert_eq!(list[0]["nodes"], 2);
    let versions: Value = admin.json(&format!("/api/projects/{id}/versions")).await;
    assert_eq!(versions.as_array().unwrap().len(), 2);
    assert_eq!(versions[0]["message"], "add services");
    assert_eq!(versions[0]["author"], "Admin");
    let v1: Value = admin.json(&format!("/api/projects/{id}/versions/1")).await;
    assert_eq!(v1["doc"]["name"], "Shop");
}

#[tokio::test]
async fn documents_are_validated() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let r = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": { "name": "x", "nodes": "nope", "edges": [] } }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let r = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": { "name": "", "nodes": [], "edges": [] } }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
    admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Same") }),
        )
        .await;
    let r = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Same") }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn project_lists_only_show_what_you_can_read() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (outsider, outsider_id) =
        add_member(&app, &admin, org, "contractor@example.com", "viewer").await;
    let a: Value = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Alpha") }),
        )
        .await
        .json()
        .await
        .unwrap();
    admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Beta") }),
        )
        .await;

    let bindings: Value = admin.json(&format!("/api/orgs/{org}/bindings")).await;
    let viewer_binding = bindings
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["subject"]["id"] == outsider_id.to_string())
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        admin
            .delete(&format!("/api/orgs/{org}/bindings/{viewer_binding}"))
            .await
            .status(),
        StatusCode::OK
    );
    let viewer = common::role_id(&admin, org, "viewer").await;
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": viewer, "subject": { "kind": "user", "id": outsider_id }, "scope": { "type": "project", "id": a["id"] } })).await;
    assert_eq!(r.status(), StatusCode::CREATED);

    let r = outsider.get(&format!("/api/orgs/{org}/projects")).await;
    assert_eq!(
        r.status(),
        StatusCode::NOT_FOUND,
        "no org-level read means the org list endpoint is hidden"
    );
    assert_eq!(
        outsider
            .get(&format!("/api/projects/{}", a["id"].as_str().unwrap()))
            .await
            .status(),
        StatusCode::OK
    );
}
