mod common;

use common::{Session, TestApp, add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};

fn pipeline_doc(name: &str) -> Value {
    let mut d = doc(name);
    d["environments"] = json!([
        { "id": "dev", "name": "Development", "approval": false },
        { "id": "staging", "name": "Staging", "approval": false },
        { "id": "prod", "name": "Production", "approval": true },
    ]);
    d
}

async fn create_project(admin: &Session, org: uuid::Uuid) -> (String, i64) {
    let p: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": pipeline_doc("Shop") })).await.json().await.unwrap();
    (p["id"].as_str().unwrap().to_owned(), p["version"].as_i64().unwrap())
}

async fn checkpoint(s: &Session, pid: &str, version: i64, name: &str) -> Value {
    let r = s.post(&format!("/api/projects/{pid}/checkpoints"), json!({ "name": name, "version": version })).await;
    assert_eq!(r.status(), StatusCode::CREATED, "{}", r.text().await.unwrap_or_default());
    r.json().await.unwrap()
}

async fn release(s: &Session, pid: &str, env: &str, cp: &Value) -> reqwest::Response {
    s.post(&format!("/api/projects/{pid}/releases"), json!({ "env": env, "checkpointId": cp["id"] })).await
}

fn git_ref(app: &TestApp, pid: &str, rev: &str) -> String {
    let dir = std::env::temp_dir().join("tessery-tests").join(&app.db_name).join("repos").join(format!("{pid}.git"));
    let out = std::process::Command::new("git").arg("--git-dir").arg(dir).args(["rev-parse", rev]).output().unwrap();
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}

#[tokio::test]
async fn checkpoints_commit_the_saved_design_and_generated_code() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (pid, v1) = create_project(&admin, org).await;

    let r = admin.post(&format!("/api/projects/{pid}/checkpoints"), json!({ "name": "first", "version": v1 + 1 })).await;
    assert_eq!(r.status(), StatusCode::CONFLICT, "only the saved version can be checkpointed");

    let c1 = checkpoint(&admin, &pid, v1, "first").await;
    assert_eq!(c1["seq"], 1);
    assert!(c1["files"].as_i64().unwrap() >= 3, "the server generates the project itself");
    assert_eq!(git_ref(&app, &pid, "refs/tags/checkpoint/1"), c1["commit"]);

    let stored: Value = admin.json(&format!("/api/projects/{pid}/checkpoints/{}/doc", c1["id"].as_str().unwrap())).await;
    assert_eq!(stored["doc"]["name"], "Shop", "tessery.json comes from the saved design, not the request");

    let mut d = pipeline_doc("Shop v2");
    d["nodes"] = json!([{ "id": "n1", "techId": "service", "name": "orders", "x": 0, "y": 0, "replicas": 1, "config": { "language": "Go", "port": 8080 }, "placement": { "providerId": "aws", "mode": "managed" } }]);
    let saved: Value = admin.put(&format!("/api/projects/{pid}"), json!({ "version": v1, "doc": d })).await.json().await.unwrap();
    let c2 = checkpoint(&admin, &pid, saved["version"].as_i64().unwrap(), "second").await;
    assert_eq!(c2["seq"], 2);

    let diff: Value = admin.json(&format!("/api/projects/{pid}/checkpoints/{}/diff", c2["id"].as_str().unwrap())).await;
    assert_eq!(diff["baseSeq"], 1);
    let paths: Vec<&str> = diff["files"].as_array().unwrap().iter().map(|f| f["path"].as_str().unwrap()).collect();
    assert!(paths.contains(&"tessery.json"));
    assert!(paths.contains(&"services/orders/go.mod"), "the new Go service shows up in the diff: {paths:?}");

    let generated: Value = admin.json(&format!("/api/projects/{pid}/generated")).await;
    assert!(generated["files"]["services/orders/cmd/orders/main.go"].as_str().unwrap().contains("ListenAndServe"));

    let list: Value = admin.json(&format!("/api/projects/{pid}/checkpoints")).await;
    assert_eq!(list[0]["name"], "second");
    assert_eq!(list[0]["author"], "Admin");

    let r = admin.get(&format!("/api/projects/{pid}/repository.bundle")).await;
    assert_eq!(r.status(), StatusCode::OK);
    assert!(r.bytes().await.unwrap().starts_with(b"# v"), "a git bundle header");

    let viewer = add_member(&app, &admin, org, "viewer@example.com", "viewer").await.0;
    let r = viewer.post(&format!("/api/projects/{pid}/checkpoints"), json!({ "name": "nope", "version": 2 })).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
}

#[tokio::test]
async fn releases_follow_the_pipeline_and_production_needs_someone_elses_approval() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (pid, v1) = create_project(&admin, org).await;
    let (ops, _) = add_member(&app, &admin, org, "ops@example.com", "deployer").await;
    let (lead, _) = add_member(&app, &admin, org, "lead@example.com", "admin").await;
    let c1 = checkpoint(&admin, &pid, v1, "first").await;

    let r = release(&ops, &pid, "staging", &c1).await;
    assert_eq!(r.status(), StatusCode::CONFLICT, "staging only takes what development already runs");
    let r = release(&ops, &pid, "qa", &c1).await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let dev: Value = release(&ops, &pid, "dev", &c1).await.json().await.unwrap();
    assert_eq!(dev["status"], "released");
    assert_eq!(release(&ops, &pid, "dev", &c1).await.status(), StatusCode::CONFLICT, "already running");

    let pipe: Value = ops.json(&format!("/api/projects/{pid}/pipeline")).await;
    assert_eq!(pipe["stages"][0]["head"]["seq"], 1);
    assert_eq!(pipe["stages"][1]["candidate"]["seq"], 1);
    assert!(pipe["stages"][2]["candidate"].is_null());

    assert_eq!(release(&ops, &pid, "staging", &c1).await.status(), StatusCode::CREATED);
    assert_eq!(git_ref(&app, &pid, "refs/heads/env/staging"), c1["commit"]);

    let pending: Value = release(&ops, &pid, "prod", &c1).await.json().await.unwrap();
    assert_eq!(pending["status"], "pending");
    assert_eq!(pending["fromEnv"], "staging");
    assert_eq!(release(&ops, &pid, "prod", &c1).await.status(), StatusCode::CONFLICT, "one pending release per environment");
    let id = pending["id"].as_str().unwrap();
    assert_eq!(ops.post(&format!("/api/releases/{id}/approve"), json!({})).await.status(), StatusCode::FORBIDDEN, "deployers cannot approve");

    let approved: Value = lead.post(&format!("/api/releases/{id}/approve"), json!({ "note": "ship it" })).await.json().await.unwrap();
    assert_eq!(approved["status"], "released");
    assert_eq!(approved["decider"], "lead");
    assert_eq!(git_ref(&app, &pid, "refs/heads/env/prod"), c1["commit"]);
    assert_eq!(lead.post(&format!("/api/releases/{id}/reject"), json!({})).await.status(), StatusCode::CONFLICT, "already decided");

    let saved: Value = admin.put(&format!("/api/projects/{pid}"), json!({ "version": v1, "doc": pipeline_doc("Shop v2") })).await.json().await.unwrap();
    let c2 = checkpoint(&admin, &pid, saved["version"].as_i64().unwrap(), "second").await;
    release(&lead, &pid, "dev", &c2).await;
    release(&lead, &pid, "staging", &c2).await;
    let own: Value = release(&lead, &pid, "prod", &c2).await.json().await.unwrap();
    let own_id = own["id"].as_str().unwrap();
    let r = lead.post(&format!("/api/releases/{own_id}/approve"), json!({})).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN, "no approving your own release");
    let rejected: Value = admin.post(&format!("/api/releases/{own_id}/reject"), json!({ "note": "wait for monday" })).await.json().await.unwrap();
    assert_eq!(rejected["status"], "rejected");
    assert_eq!(git_ref(&app, &pid, "refs/heads/env/prod"), c1["commit"], "a rejection leaves production alone");

    let rollback: Value = release(&ops, &pid, "staging", &c1).await.json().await.unwrap();
    assert_eq!(rollback["status"], "released", "rolling back to a checkpoint development ran before is allowed");
    assert_eq!(git_ref(&app, &pid, "refs/heads/env/staging"), c1["commit"]);

    assert_eq!(release(&admin, &pid, "prod", &c1).await.status(), StatusCode::CONFLICT, "prod already runs checkpoint 1");
    let self_approved: Value = {
        let p: Value = release(&ops, &pid, "staging", &c2).await.json().await.unwrap();
        assert_eq!(p["status"], "released");
        let pend: Value = release(&admin, &pid, "prod", &c2).await.json().await.unwrap();
        admin.post(&format!("/api/releases/{}/approve", pend["id"].as_str().unwrap()), json!({})).await.json().await.unwrap()
    };
    assert_eq!(self_approved["status"], "released", "instance admins may approve their own releases");
    let audit: Value = admin.json(&format!("/api/orgs/{org}/audit?action=release.approve")).await;
    assert_eq!(audit["events"][0]["result"], "bypassed");

    let history: Value = ops.json(&format!("/api/projects/{pid}/releases")).await;
    assert!(history.as_array().unwrap().len() >= 8);
}

#[tokio::test]
async fn remotes_keep_tokens_secret() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let (pid, v1) = create_project(&admin, org).await;
    let path = format!("/api/projects/{pid}/remote");

    for bad in ["ftp://example.com/x.git", "https://user:pw@github.com/a/b.git", "not a url"] {
        let r = admin.put(&path, json!({ "url": bad })).await;
        assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY, "{bad}");
    }
    let r = admin.put(&path, json!({ "url": "https://github.com/acme/shop.git", "username": "bot", "token": "ghp_secret_value" })).await;
    let body = r.text().await.unwrap();
    assert!(!body.contains("ghp_secret_value"));
    let remote: Value = serde_json::from_str(&body).unwrap();
    assert_eq!(remote["hasToken"], true);
    assert_eq!(remote["autoPush"], true);

    let kept: Value = admin.put(&path, json!({ "url": "https://github.com/acme/shop2.git", "autoPush": false })).await.json().await.unwrap();
    assert_eq!(kept["hasToken"], true, "omitting the token keeps it");
    let cleared: Value = admin.put(&path, json!({ "url": "https://github.com/acme/shop2.git", "token": "" })).await.json().await.unwrap();
    assert_eq!(cleared["hasToken"], false);

    assert_eq!(admin.post(&format!("{path}/push"), json!({})).await.status(), StatusCode::CONFLICT, "nothing to push yet");
    checkpoint(&admin, &pid, v1, "first").await;
    assert_eq!(admin.post(&format!("{path}/push"), json!({})).await.status(), StatusCode::ACCEPTED);

    let (editor, _) = add_member(&app, &admin, org, "editor@example.com", "editor").await;
    assert_eq!(editor.put(&path, json!({ "url": "https://evil.example/x.git" })).await.status(), StatusCode::FORBIDDEN, "changing the remote needs secret:write");
    assert_eq!(admin.delete(&path).await.status(), StatusCode::OK);
    assert!(admin.json(&path).await.is_null());
}
