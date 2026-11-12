mod common;

use reqwest::StatusCode;
use serde_json::{Value, json};

#[tokio::test]
async fn first_run_setup_happens_exactly_once() {
    let app = common::spawn().await;
    let anon = app.session();
    assert_eq!(anon.json("/api/setup").await["required"], true);

    let (admin, org) = app.setup().await;
    let me = admin.json("/api/auth/me").await;
    assert_eq!(me["email"], "admin@example.com");
    assert_eq!(me["instanceAdmin"], true);
    assert_eq!(
        admin.json(&format!("/api/orgs/{org}")).await["name"],
        "Acme"
    );

    assert_eq!(anon.json("/api/setup").await["required"], false);
    let again = anon.post("/api/setup", json!({ "email": "evil@example.com", "name": "Evil", "password": "evil-password-1", "orgName": "Evil" })).await;
    assert_eq!(again.status(), StatusCode::CONFLICT);
}

#[tokio::test]
async fn login_logout_and_bad_credentials() {
    let app = common::spawn().await;
    app.setup().await;
    let s = app.session();
    assert_eq!(
        s.get("/api/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.login("admin@example.com", "wrong-password-xx").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.login("nobody@example.com", "whatever-password").await,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        s.login("ADMIN@example.com", "admin-password-1").await,
        StatusCode::OK
    );
    assert_eq!(s.get("/api/auth/me").await.status(), StatusCode::OK);
    assert_eq!(
        s.post("/api/auth/logout", json!({})).await.status(),
        StatusCode::OK
    );
    assert_eq!(
        s.get("/api/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn mutations_require_the_csrf_header() {
    let app = common::spawn().await;
    let r = reqwest::Client::new()
        .post(format!("{}/api/setup", app.base))
        .json(&json!({ "email": "a@example.com", "name": "A", "password": "a-password-123", "orgName": "A" }))
        .send()
        .await
        .unwrap();
    assert_eq!(r.status(), StatusCode::FORBIDDEN);
    let body: Value = r.json().await.unwrap();
    assert_eq!(body["error"]["code"], "forbidden");
}

#[tokio::test]
async fn login_is_rate_limited_per_email() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let email = format!("rl-{}@example.com", uuid::Uuid::new_v4().simple());
    common::add_member(&app, &admin, org, &email, "viewer").await;
    let s = app.session();
    let mut last = StatusCode::OK;
    for _ in 0..10 {
        last = s.login(&email, "wrong-password-xx").await;
    }
    assert_eq!(last, StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(
        s.login(&email, "member-password-1").await,
        StatusCode::TOO_MANY_REQUESTS,
        "the correct password is also refused while locked"
    );
}

#[tokio::test]
async fn changing_password_signs_out_other_sessions() {
    let app = common::spawn().await;
    let (a, _) = app.setup().await;
    let b = app.session();
    assert_eq!(
        b.login("admin@example.com", "admin-password-1").await,
        StatusCode::OK
    );
    let r = a
        .post(
            "/api/auth/password",
            json!({ "currentPassword": "admin-password-1", "newPassword": "a-brand-new-password" }),
        )
        .await;
    assert_eq!(r.status(), StatusCode::OK);
    assert_eq!(a.get("/api/auth/me").await.status(), StatusCode::OK);
    assert_eq!(
        b.get("/api/auth/me").await.status(),
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        b.login("admin@example.com", "a-brand-new-password").await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn validation_errors_name_the_field() {
    let app = common::spawn().await;
    let s = app.session();
    let r = s.post("/api/setup", json!({ "email": "not-an-email", "name": "A", "password": "long-enough-pw", "orgName": "A" })).await;
    assert_eq!(r.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(r.json::<Value>().await.unwrap()["error"]["field"], "email");
    let r = s
        .post(
            "/api/setup",
            json!({ "email": "a@example.com", "name": "A", "password": "short", "orgName": "A" }),
        )
        .await;
    assert_eq!(
        r.json::<Value>().await.unwrap()["error"]["field"],
        "password"
    );
}

#[tokio::test]
async fn health_and_openapi_are_public() {
    let app = common::spawn().await;
    let s = app.session();
    let h = s.json("/api/health").await;
    assert_eq!(h["status"], "ok");
    let spec = s.json("/api/openapi.json").await;
    assert!(spec["paths"]["/api/projects/{project}"]["put"].is_object());
}
