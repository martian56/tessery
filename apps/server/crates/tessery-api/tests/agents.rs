mod common;

use common::{TestApp, add_member, doc};
use reqwest::{Client, StatusCode};
use serde_json::{Value, json};

async fn bearer(app: &TestApp, token: &str, method: reqwest::Method, path: &str, body: Option<Value>) -> reqwest::Response {
    let mut req = Client::new().request(method, format!("{}{path}", app.base)).bearer_auth(token);
    if let Some(b) = body {
        req = req.json(&b);
    }
    req.send().await.unwrap()
}

async fn mcp(app: &TestApp, token: &str, method: &str, params: Value) -> Value {
    let r = bearer(app, token, reqwest::Method::POST, "/api/mcp", Some(json!({ "jsonrpc": "2.0", "id": 1, "method": method, "params": params }))).await;
    assert_eq!(r.status(), StatusCode::OK);
    r.json::<Value>().await.unwrap()["result"].clone()
}

async fn tool(app: &TestApp, token: &str, name: &str, args: Value) -> (bool, Value) {
    let res = mcp(app, token, "tools/call", json!({ "name": name, "arguments": args })).await;
    let text = res["content"][0]["text"].as_str().unwrap().to_owned();
    (res["isError"] == true, serde_json::from_str(&text).unwrap_or(Value::String(text)))
}

#[tokio::test]
async fn tokens_act_as_their_owner_within_their_scope() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let a: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("Alpha") })).await.json().await.unwrap();
    let b: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("Beta") })).await.json().await.unwrap();
    let (a_id, b_id) = (a["id"].as_str().unwrap(), b["id"].as_str().unwrap());

    let created: Value = admin.post("/api/auth/tokens", json!({ "name": "ci", "projectId": a_id, "permissions": ["project:read"] })).await.json().await.unwrap();
    let token = created["secret"].as_str().unwrap();
    assert!(token.starts_with("tessery_"));
    let listed: Value = admin.json("/api/auth/tokens").await;
    assert!(!listed.to_string().contains(token), "the secret is only shown once");

    assert_eq!(bearer(&app, token, reqwest::Method::GET, &format!("/api/projects/{a_id}"), None).await.status(), StatusCode::OK);
    assert_eq!(bearer(&app, token, reqwest::Method::GET, &format!("/api/projects/{b_id}"), None).await.status(), StatusCode::NOT_FOUND, "other projects are invisible");
    let save = bearer(&app, token, reqwest::Method::PUT, &format!("/api/projects/{a_id}"), Some(json!({ "version": a["version"], "doc": doc("Alpha 2") }))).await;
    assert_eq!(save.status(), StatusCode::FORBIDDEN, "project:read does not allow editing, even for an instance admin's token");
    assert_eq!(bearer(&app, token, reqwest::Method::POST, "/api/auth/tokens", Some(json!({ "name": "escalate" }))).await.status(), StatusCode::FORBIDDEN, "tokens cannot mint tokens");

    let viewer = add_member(&app, &admin, org, "viewer@example.com", "viewer").await.0;
    let vt: Value = viewer.post("/api/auth/tokens", json!({ "name": "mine" })).await.json().await.unwrap();
    let vt = vt["secret"].as_str().unwrap();
    let r = bearer(&app, vt, reqwest::Method::PUT, &format!("/api/projects/{a_id}"), Some(json!({ "version": a["version"], "doc": doc("Alpha 3") }))).await;
    assert_eq!(r.status(), StatusCode::FORBIDDEN, "a full token is still limited to what its owner may do");

    let id = created["token"]["id"].as_str().unwrap();
    assert_eq!(admin.delete(&format!("/api/auth/tokens/{id}")).await.status(), StatusCode::OK);
    assert_eq!(bearer(&app, token, reqwest::Method::GET, &format!("/api/projects/{a_id}"), None).await.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(bearer(&app, "tessery_not-a-token", reqwest::Method::GET, "/api/auth/me", None).await.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn agents_design_and_checkpoint_over_mcp() {
    let app = common::spawn().await;
    let (admin, _) = app.setup().await;
    let created: Value = admin.post("/api/auth/tokens", json!({ "name": "agent" })).await.json().await.unwrap();
    let token = created["secret"].as_str().unwrap();

    let unauth = Client::new().post(format!("{}/api/mcp", app.base)).json(&json!({ "jsonrpc": "2.0", "id": 1, "method": "tools/list" })).send().await.unwrap();
    assert_eq!(unauth.status(), StatusCode::UNAUTHORIZED);
    assert!(unauth.headers().contains_key("www-authenticate"));

    let init = mcp(&app, token, "initialize", json!({ "protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": { "name": "test", "version": "1" } })).await;
    assert_eq!(init["protocolVersion"], "2025-06-18");
    let tools = mcp(&app, token, "tools/list", json!({})).await;
    assert!(tools["tools"].as_array().unwrap().iter().any(|t| t["name"] == "edit_design"));

    let (err, project) = tool(&app, token, "create_project", json!({ "name": "shop" })).await;
    assert!(!err, "{project}");
    let pid = project["id"].as_str().unwrap();
    let (err, edited) = tool(&app, token, "edit_design", json!({ "project": pid, "operations": [
        { "op": "addNode", "args": { "techId": "service", "x": 0, "y": 0, "name": "orders", "config": { "language": "Go" } } },
        { "op": "addNode", "args": { "techId": "postgres", "x": 0, "y": 0, "name": "orders-db" } },
        { "op": "connect", "args": { "source": "$0", "target": "orders-db" } },
        { "op": "addTable", "args": { "nodeId": "$1", "name": "orders" } },
        { "op": "addOperation", "args": { "nodeId": "orders", "kind": "GET /orders", "name": "listOrders" } },
    ] })).await;
    assert!(!err, "{edited}");
    assert_eq!(edited["results"].as_array().unwrap().len(), 5);

    let (_, got) = tool(&app, token, "get_project", json!({ "project": pid })).await;
    let nodes = got["doc"]["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 2);
    assert_ne!(nodes[0]["x"], nodes[1]["x"], "nodes dropped on the same spot are moved apart");

    let (_, files) = tool(&app, token, "list_files", json!({ "project": pid, "prefix": "services/orders/" })).await;
    assert!(files.as_array().unwrap().iter().any(|f| f.as_str().unwrap().ends_with("db.go")), "{files}");
    let (err, cp) = tool(&app, token, "create_checkpoint", json!({ "project": pid, "name": "first" })).await;
    assert!(!err, "{cp}");
    assert_eq!(cp["seq"], 1);

    let (err, msg) = tool(&app, token, "edit_design", json!({ "project": pid, "operations": [{ "op": "connect", "args": { "source": "orders", "target": "nowhere" } }] })).await;
    assert!(err && msg.as_str().unwrap().contains("connect"), "a failed connect is an error, not a silent no-op: {msg}");
}

#[tokio::test]
async fn git_over_http_needs_a_token_and_protects_tessery_refs() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let p: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": doc("Repo") })).await.json().await.unwrap();
    let pid = p["id"].as_str().unwrap();
    admin.post(&format!("/api/projects/{pid}/checkpoints"), json!({ "name": "first", "version": p["version"] })).await;
    let created: Value = admin.post("/api/auth/tokens", json!({ "name": "git" })).await.json().await.unwrap();
    let token = created["secret"].as_str().unwrap();
    let refs = format!("{}/git/{pid}.git/info/refs?service=git-upload-pack", app.base);

    let anon = Client::new().get(&refs).send().await.unwrap();
    assert_eq!(anon.status(), StatusCode::UNAUTHORIZED);
    assert!(anon.headers()["www-authenticate"].to_str().unwrap().starts_with("Basic"));

    let ok = Client::new().get(&refs).basic_auth("anyone", Some(token)).send().await.unwrap();
    assert_eq!(ok.status(), StatusCode::OK);
    assert_eq!(ok.headers()["content-type"], "application/x-git-upload-pack-advertisement");
    assert!(String::from_utf8_lossy(&ok.bytes().await.unwrap()).contains("refs/heads/main"));

    let zero = "0".repeat(40);
    let line = format!("{zero} {zero} refs/heads/env/prod\0report-status\n");
    let body = format!("{:04x}{line}0000", line.len() + 4);
    let push = Client::new()
        .post(format!("{}/git/{pid}.git/git-receive-pack", app.base))
        .basic_auth("anyone", Some(token))
        .header("content-type", "application/x-git-receive-pack-request")
        .body(body)
        .send()
        .await
        .unwrap();
    assert_eq!(push.status(), StatusCode::FORBIDDEN, "environment branches belong to Tessery");
}
