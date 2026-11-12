mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn changes_and_denials_are_recorded() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (viewer, _) = add_member(&app, &admin, org, "v@example.com", "viewer").await;
    admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Audited") }),
        )
        .await;
    viewer
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Denied") }),
        )
        .await;

    let page: Value = admin.json(&format!("/api/orgs/{org}/audit")).await;
    let actions: Vec<&str> = page["events"]
        .as_array()
        .unwrap()
        .iter()
        .map(|e| e["action"].as_str().unwrap())
        .collect();
    assert!(actions.contains(&"project.create"));
    assert!(actions.contains(&"member.add"));
    assert!(actions.contains(&"instance.setup"));

    let denied: Value = admin
        .json(&format!("/api/orgs/{org}/audit?result=denied"))
        .await;
    let ev = &denied["events"][0];
    assert_eq!(ev["action"], "project:create");
    assert_eq!(ev["actorEmail"], "v@example.com");
    assert!(ev["ip"].as_str().unwrap().starts_with("10."));
}

#[tokio::test]
async fn audit_pages_with_a_cursor() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    for i in 0..5 {
        admin
            .post(
                &format!("/api/orgs/{org}/projects"),
                json!({ "doc": doc(&format!("P{i}")) }),
            )
            .await;
    }
    let first: Value = admin
        .json(&format!("/api/orgs/{org}/audit?action=project.&limit=3"))
        .await;
    assert_eq!(first["events"].as_array().unwrap().len(), 3);
    let cursor = first["nextCursor"].as_i64().unwrap();
    let second: Value = admin
        .json(&format!(
            "/api/orgs/{org}/audit?action=project.&limit=3&before={cursor}"
        ))
        .await;
    assert_eq!(second["events"].as_array().unwrap().len(), 2);
    assert!(second["nextCursor"].is_null());
}

#[tokio::test]
async fn exports_are_queued_on_rabbitmq() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let r = admin
        .post(
            &format!("/api/orgs/{org}/audit/exports"),
            json!({ "format": "csv" }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::ACCEPTED);
    let e: Value = r.json().await.unwrap();
    assert!(["queued", "running", "done"].contains(&e["status"].as_str().unwrap()));
    let r = admin
        .post(
            &format!("/api/orgs/{org}/audit/exports"),
            json!({ "format": "xml" }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn instance_admin_controls() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (member, member_id) = add_member(&app, &admin, org, "member@example.com", "viewer").await;
    assert_eq!(
        member.get("/api/admin/users").await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        admin
            .json("/api/admin/users")
            .await
            .as_array()
            .unwrap()
            .len(),
        2
    );

    let me: Value = admin.json("/api/auth/me").await;
    let r = admin
        .patch(
            &format!("/api/admin/users/{}", me["id"].as_str().unwrap()),
            json!({ "instanceAdmin": false }),
        )
        .await;
    assert_eq!(
        r.status(),
        StatusCode::CONFLICT,
        "the last instance admin must stay"
    );

    assert_eq!(
        admin
            .patch(
                &format!("/api/admin/users/{member_id}"),
                json!({ "disabled": true })
            )
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        member.get("/api/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        member
            .login("member@example.com", "member-password-1")
            .await,
        StatusCode::UNAUTHORIZED
    );

    assert_eq!(
        admin
            .put("/api/admin/settings", json!({ "allowOrgCreation": false }))
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        admin
            .patch(
                &format!("/api/admin/users/{member_id}"),
                json!({ "disabled": false })
            )
            .await
            .status(),
        StatusCode::OK
    );
    assert_eq!(
        member
            .login("member@example.com", "member-password-1")
            .await,
        StatusCode::OK
    );
    assert_eq!(
        member
            .post("/api/orgs", json!({ "name": "Side project" }))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
}
