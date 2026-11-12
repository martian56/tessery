mod common;

use common::{add_member, doc, role_id};
use reqwest::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn built_in_roles_gate_project_actions() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (viewer, _) = add_member(&app, &admin, org, "viewer@example.com", "viewer").await;
    let (editor, _) = add_member(&app, &admin, org, "editor@example.com", "editor").await;

    let r = viewer
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Nope") }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["permission"],
        "project:create"
    );

    let r = editor
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Payments") }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let id = r.json::<Value>().await.unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();

    assert_eq!(
        viewer.get(&format!("/api/projects/{id}")).await.status(),
        StatusCode::OK
    );
    assert_eq!(
        viewer
            .put(
                &format!("/api/projects/{id}"),
                json!({ "version": 1, "doc": doc("Payments") })
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        editor.delete(&format!("/api/projects/{id}")).await.status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        admin.delete(&format!("/api/projects/{id}")).await.status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn outsiders_cannot_see_an_org_exists() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (_, other_org_owner) = {
        let r = admin.post("/api/orgs", json!({ "name": "Other" })).await;
        assert_eq!(r.status(), StatusCode::CREATED);
        (
            (),
            r.json::<Value>().await.unwrap()["id"]
                .as_str()
                .unwrap()
                .to_owned(),
        )
    };
    let (member, _) = add_member(&app, &admin, org, "m@example.com", "viewer").await;
    assert_eq!(
        member
            .get(&format!("/api/orgs/{other_org_owner}"))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    assert_eq!(
        member
            .get(&format!("/api/orgs/{other_org_owner}/members"))
            .await
            .status(),
        StatusCode::NOT_FOUND
    );
    let orgs: Value = member.json("/api/orgs").await;
    assert_eq!(orgs.as_array().unwrap().len(), 1);
}

#[tokio::test]
async fn team_scoped_grants_apply_only_to_that_teams_projects() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (dev, dev_id) = add_member(&app, &admin, org, "dev@example.com", "viewer").await;

    let team: Value = admin
        .post(
            &format!("/api/orgs/{org}/teams"),
            json!({ "name": "Platform" }),
        )
        .await
        .json()
        .await
        .unwrap();
    let team_id = team["id"].as_str().unwrap();
    assert_eq!(
        admin
            .post(
                &format!("/api/orgs/{org}/teams/{team_id}/members"),
                json!({ "userId": dev_id })
            )
            .await
            .status(),
        StatusCode::OK
    );
    let editor = role_id(&admin, org, "editor").await;
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": editor, "subject": { "kind": "team", "id": team_id }, "scope": { "type": "team", "id": team_id } })).await;
    assert_eq!(
        r.status(),
        StatusCode::CREATED,
        "{}",
        r.text().await.unwrap()
    );

    let team_project: Value = dev
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "teamId": team_id, "doc": doc("Team Svc") }),
        )
        .await
        .json()
        .await
        .unwrap();
    assert!(
        team_project["id"].is_string(),
        "dev should create inside their team: {team_project}"
    );
    let org_project: Value = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Org Svc") }),
        )
        .await
        .json()
        .await
        .unwrap();

    let tp = team_project["id"].as_str().unwrap();
    let op = org_project["id"].as_str().unwrap();
    assert_eq!(
        dev.put(
            &format!("/api/projects/{tp}"),
            json!({ "version": 1, "doc": doc("Team Svc 2") })
        )
        .await
        .status(),
        StatusCode::OK
    );
    assert_eq!(
        dev.put(
            &format!("/api/projects/{op}"),
            json!({ "version": 1, "doc": doc("Org Svc 2") })
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        dev.post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Loose") })
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );

    let perms: Value = dev
        .json(&format!("/api/me/permissions?org={org}&project={tp}"))
        .await;
    assert!(
        perms["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "project:edit")
    );
    let perms: Value = dev
        .json(&format!("/api/me/permissions?org={org}&project={op}"))
        .await;
    assert!(
        !perms["permissions"]
            .as_array()
            .unwrap()
            .iter()
            .any(|p| p == "project:edit")
    );
}

#[tokio::test]
async fn environment_grants_do_not_leak_to_other_environments() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (ops, ops_id) = add_member(&app, &admin, org, "ops@example.com", "viewer").await;
    let p: Value = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Billing") }),
        )
        .await
        .json()
        .await
        .unwrap();
    let pid = p["id"].as_str().unwrap();
    let deployer = role_id(&admin, org, "deployer").await;
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": deployer, "subject": { "kind": "user", "id": ops_id }, "scope": { "type": "environment", "id": pid, "env": "staging" } })).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    let has = |v: &Value, p: &str| v["permissions"].as_array().unwrap().iter().any(|x| x == p);
    assert!(has(
        &ops.json(&format!(
            "/api/me/permissions?org={org}&project={pid}&env=staging"
        ))
        .await,
        "deployment:run"
    ));
    assert!(!has(
        &ops.json(&format!(
            "/api/me/permissions?org={org}&project={pid}&env=prod"
        ))
        .await,
        "deployment:run"
    ));
    assert!(!has(
        &ops.json(&format!("/api/me/permissions?org={org}&project={pid}"))
            .await,
        "deployment:run"
    ));
}

#[tokio::test]
async fn nobody_can_grant_more_than_they_have() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (org_admin, _) = add_member(&app, &admin, org, "orgadmin@example.com", "admin").await;
    let (_, target) = add_member(&app, &admin, org, "target@example.com", "viewer").await;
    let owner = role_id(&admin, org, "owner").await;

    let r = org_admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": owner, "subject": { "kind": "user", "id": target }, "scope": { "type": "org" } })).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    assert!(r.text().await.unwrap().contains("org:delete"));

    let r = org_admin
        .post(
            &format!("/api/orgs/{org}/roles"),
            json!({ "name": "Super", "permissions": ["org:delete"] }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);

    let r = org_admin.post(&format!("/api/orgs/{org}/members"), json!({ "email": "x@example.com", "name": "X", "password": "x-password-123", "role": "owner" })).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn custom_roles_work_and_built_ins_are_immutable() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (auditor, auditor_id) =
        add_member(&app, &admin, org, "auditor@example.com", "viewer").await;
    assert_eq!(
        auditor
            .get(&format!("/api/orgs/{org}/audit"))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );

    let role: Value = admin
        .post(
            &format!("/api/orgs/{org}/roles"),
            json!({ "name": "Auditor", "permissions": ["org:read", "audit:read"] }),
        )
        .await
        .json()
        .await
        .unwrap();
    assert_eq!(role["key"], "auditor");
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": role["id"], "subject": { "kind": "user", "id": auditor_id }, "scope": { "type": "org" } })).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    assert_eq!(
        auditor
            .get(&format!("/api/orgs/{org}/audit"))
            .await
            .status(),
        StatusCode::OK
    );

    let viewer = role_id(&admin, org, "viewer").await;
    assert_eq!(
        admin
            .patch(
                &format!("/api/orgs/{org}/roles/{viewer}"),
                json!({ "name": "Hacked", "permissions": ["org:read"] })
            )
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    assert_eq!(
        admin
            .delete(&format!("/api/orgs/{org}/roles/{viewer}"))
            .await
            .status(),
        StatusCode::FORBIDDEN
    );
    let r = admin
        .post(
            &format!("/api/orgs/{org}/roles"),
            json!({ "name": "Bad", "permissions": ["not:real"] }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
}

#[tokio::test]
async fn time_limited_access_expires() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (temp, temp_id) = add_member(&app, &admin, org, "temp@example.com", "viewer").await;
    let p: Value = admin
        .post(
            &format!("/api/orgs/{org}/projects"),
            json!({ "doc": doc("Core") }),
        )
        .await
        .json()
        .await
        .unwrap();
    let pid = p["id"].as_str().unwrap();
    let editor = role_id(&admin, org, "editor").await;

    let past = time::OffsetDateTime::now_utc() - time::Duration::minutes(1);
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": editor, "subject": { "kind": "user", "id": temp_id }, "scope": { "type": "project", "id": pid }, "expiresAt": past.format(&time::format_description::well_known::Rfc3339).unwrap() })).await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let soon = time::OffsetDateTime::now_utc() + time::Duration::seconds(2);
    let r = admin.post(&format!("/api/orgs/{org}/bindings"), json!({ "roleId": editor, "subject": { "kind": "user", "id": temp_id }, "scope": { "type": "project", "id": pid }, "expiresAt": soon.format(&time::format_description::well_known::Rfc3339).unwrap() })).await;
    assert_eq!(r.status(), StatusCode::CREATED);
    assert_eq!(
        temp.put(
            &format!("/api/projects/{pid}"),
            json!({ "version": 1, "doc": doc("Core 2") })
        )
        .await
        .status(),
        StatusCode::OK
    );
    tokio::time::sleep(std::time::Duration::from_millis(2500)).await;
    assert_eq!(
        temp.put(
            &format!("/api/projects/{pid}"),
            json!({ "version": 2, "doc": doc("Core 3") })
        )
        .await
        .status(),
        StatusCode::FORBIDDEN
    );
}

#[tokio::test]
async fn the_last_owner_cannot_be_removed() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let me: Value = admin.json("/api/auth/me").await;
    let r = admin
        .delete(&format!(
            "/api/orgs/{org}/members/{}",
            me["id"].as_str().unwrap()
        ))
        .await;
    assert_eq!(r.status(), StatusCode::CONFLICT);
    let bindings: Value = admin.json(&format!("/api/orgs/{org}/bindings")).await;
    let owner_binding = bindings
        .as_array()
        .unwrap()
        .iter()
        .find(|b| b["roleKey"] == "owner")
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(
        admin
            .delete(&format!("/api/orgs/{org}/bindings/{owner_binding}"))
            .await
            .status(),
        StatusCode::CONFLICT
    );
}

#[tokio::test]
async fn instance_admin_bypasses_and_it_is_audited() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (founder, _) = add_member(&app, &admin, org, "founder@example.com", "viewer").await;
    let other: Value = founder
        .post("/api/orgs", json!({ "name": "Founder Co" }))
        .await
        .json()
        .await
        .unwrap();
    let other_id = other["id"].as_str().unwrap();

    let orgs: Value = admin.json("/api/orgs").await;
    let listed = orgs
        .as_array()
        .unwrap()
        .iter()
        .find(|o| o["id"] == other_id)
        .unwrap();
    assert_eq!(listed["member"], false);
    assert_eq!(
        admin
            .patch(
                &format!("/api/orgs/{other_id}"),
                json!({ "name": "Renamed by admin", "slug": "renamed" })
            )
            .await
            .status(),
        StatusCode::OK
    );

    let audit: Value = founder
        .json(&format!("/api/orgs/{other_id}/audit?action=org.update"))
        .await;
    let ev = &audit["events"][0];
    assert_eq!(ev["result"], "bypassed");
    assert_eq!(ev["actorEmail"], "admin@example.com");
}
