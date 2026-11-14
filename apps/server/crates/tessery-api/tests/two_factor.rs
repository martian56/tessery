mod common;

use common::add_member;
use reqwest::StatusCode;
use serde_json::{Value, json};
use tessery_api::totp;

fn code(secret: &[u8], offset: i64) -> String {
    format!("{:06}", totp::code_at(secret, (totp::now_step() as i64 + offset) as u64))
}

async fn turn_on(s: &common::Session) -> (Vec<u8>, Vec<String>) {
    let setup: Value = s.post("/api/auth/two-factor/setup", json!({})).await.json().await.unwrap();
    assert!(setup["qrSvg"].as_str().unwrap().contains("<svg"));
    assert!(setup["otpauthUrl"].as_str().unwrap().starts_with("otpauth://totp/Tessery:"));
    let secret = totp::decode(setup["secret"].as_str().unwrap()).unwrap();
    assert_eq!(s.post("/api/auth/two-factor/enable", json!({ "code": "000000" })).await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let enabled = s.post("/api/auth/two-factor/enable", json!({ "code": code(&secret, 0) })).await;
    assert_eq!(enabled.status(), StatusCode::OK);
    let codes: Vec<String> = serde_json::from_value(enabled.json::<Value>().await.unwrap()["recoveryCodes"].clone()).unwrap();
    (secret, codes)
}

async fn ticket(app: &common::TestApp, email: &str, password: &str) -> (common::Session, String) {
    let s = app.session();
    let r = s.post("/api/auth/login", json!({ "email": email, "password": password })).await;
    assert_eq!(r.status(), StatusCode::ACCEPTED, "two-factor accounts get a challenge, not a session");
    let t = r.json::<Value>().await.unwrap()["twoFactorTicket"].as_str().unwrap().to_owned();
    assert_eq!(s.get("/api/auth/me").await.status(), StatusCode::UNAUTHORIZED, "the password alone does not sign in");
    (s, t)
}

#[tokio::test]
async fn codes_are_required_and_recovery_codes_work_once() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let me: Value = admin.json("/api/auth/me").await;
    let email = me["email"].as_str().unwrap().to_owned();

    assert_eq!(admin.put(&format!("/api/orgs/{org}/security"), json!({ "requireTwoFactor": true })).await.status(), StatusCode::CONFLICT, "no locking yourself out");
    let (secret, recovery) = turn_on(&admin).await;
    assert_eq!(recovery.len(), 10);
    assert_eq!(admin.json("/api/auth/two-factor").await["recoveryCodesLeft"], 10);

    let (s, t) = ticket(&app, &email, "admin-password-1").await;
    assert_eq!(s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": "123456" })).await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": code(&secret, 0) })).await.status(), StatusCode::UNPROCESSABLE_ENTITY, "the code used to turn it on cannot be replayed");
    let ok = s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": code(&secret, 1) })).await;
    assert_eq!(ok.status(), StatusCode::OK);
    assert_eq!(s.json("/api/auth/me").await["twoFactor"], true);
    assert_eq!(s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": code(&secret, 1) })).await.status(), StatusCode::UNPROCESSABLE_ENTITY, "a ticket works once");

    let (s, t) = ticket(&app, &email, "admin-password-1").await;
    assert_eq!(s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": recovery[3].to_uppercase() })).await.status(), StatusCode::OK);
    let (s, t) = ticket(&app, &email, "admin-password-1").await;
    assert_eq!(s.post("/api/auth/login/two-factor", json!({ "ticket": t, "code": recovery[3] })).await.status(), StatusCode::UNPROCESSABLE_ENTITY, "a recovery code works once");
    assert_eq!(admin.json("/api/auth/two-factor").await["recoveryCodesLeft"], 9);

    let (member, member_id) = add_member(&app, &admin, org, "dev@example.com", "editor").await;
    assert_eq!(member.get(&format!("/api/orgs/{org}/members")).await.status(), StatusCode::OK);
    let sec = admin.put(&format!("/api/orgs/{org}/security"), json!({ "requireTwoFactor": true })).await;
    assert_eq!(sec.status(), StatusCode::OK);
    assert_eq!(sec.json::<Value>().await.unwrap()["membersWithout"], json!(["dev@example.com"]));
    let blocked = member.get(&format!("/api/orgs/{org}/members")).await;
    assert_eq!(blocked.status(), StatusCode::FORBIDDEN);
    assert!(blocked.text().await.unwrap().contains("requires two-factor"));
    turn_on(&member).await;
    assert_eq!(member.get(&format!("/api/orgs/{org}/members")).await.status(), StatusCode::OK);

    assert_eq!(member.delete(&format!("/api/orgs/{org}/members/{member_id}/two-factor")).await.status(), StatusCode::FORBIDDEN, "editors cannot reset factors");
    assert_eq!(admin.delete(&format!("/api/orgs/{org}/members/{member_id}/two-factor")).await.status(), StatusCode::OK);
    let audit: Value = admin.json(&format!("/api/orgs/{org}/audit")).await;
    assert!(audit.to_string().contains("member.two_factor_reset"), "{audit}");
    let again = app.session();
    assert_eq!(again.login("dev@example.com", "member-password-1").await, StatusCode::OK, "after a reset the password signs in and setup starts over");
    assert_eq!(again.json("/api/auth/two-factor").await["enabled"], false);

    assert_eq!(admin.post("/api/auth/two-factor/disable", json!({ "password": "wrong-password-1" })).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(admin.post("/api/auth/two-factor/disable", json!({ "password": "admin-password-1" })).await.status(), StatusCode::OK);
}
