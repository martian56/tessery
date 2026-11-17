mod common;

use common::add_member;
use reqwest::StatusCode;
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};

async fn smtp_sink() -> (u16, Arc<Mutex<Vec<String>>>) {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    let inbox = Arc::new(Mutex::new(Vec::new()));
    let store = inbox.clone();
    tokio::spawn(async move {
        loop {
            let (stream, _) = listener.accept().await.unwrap();
            let store = store.clone();
            tokio::spawn(async move {
                let (read, mut write) = stream.into_split();
                let mut lines = BufReader::new(read).lines();
                write.write_all(b"220 sink\r\n").await.unwrap();
                let mut data = false;
                let mut message = String::new();
                while let Ok(Some(line)) = lines.next_line().await {
                    if data {
                        if line == "." {
                            data = false;
                            store.lock().unwrap().push(std::mem::take(&mut message));
                            write.write_all(b"250 queued\r\n").await.unwrap();
                        } else {
                            message.push_str(&line);
                            message.push('\n');
                        }
                        continue;
                    }
                    let reply: &[u8] = match line.get(..4).unwrap_or("").to_ascii_uppercase().as_str() {
                        "EHLO" | "HELO" => b"250 sink\r\n",
                        "DATA" => {
                            data = true;
                            b"354 go\r\n"
                        }
                        "QUIT" => {
                            let _ = write.write_all(b"221 bye\r\n").await;
                            break;
                        }
                        _ => b"250 ok\r\n",
                    };
                    write.write_all(reply).await.unwrap();
                }
            });
        }
    });
    (port, inbox)
}

fn link_token(message: &str) -> String {
    let unfolded = message.replace("=\n", "").replace("=3D", "=");
    unfolded.split("token=").nth(1).expect("a link with a token").chars().take_while(|c| c.is_ascii_hexdigit()).collect()
}

#[tokio::test]
async fn reset_and_invitation_links_arrive_by_email() {
    let (port, inbox) = smtp_sink().await;
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;

    let no_email = admin.post(&format!("/api/orgs/{org}/members"), json!({ "email": "new@example.com", "name": "New" })).await;
    assert_eq!(no_email.status(), StatusCode::UNPROCESSABLE_ENTITY, "without email a password is still required");

    let saved = admin.put("/api/admin/email", json!({ "settings": { "host": "127.0.0.1", "port": port, "username": "", "from": "Tessery <tessery@example.com>", "security": "none" } })).await;
    assert_eq!(saved.status(), StatusCode::OK);
    assert_eq!(admin.post("/api/admin/email/test", json!({ "to": "admin@example.com" })).await.status(), StatusCode::OK);
    assert!(inbox.lock().unwrap().last().unwrap().contains("Email from your Tessery instance works"));

    let (member, _) = add_member(&app, &admin, org, "dev@example.com", "editor").await;
    drop(member);
    let anon = app.session();
    assert_eq!(anon.post("/api/auth/password/forgot", json!({ "email": "nobody@example.com" })).await.status(), StatusCode::OK, "unknown addresses look the same");
    let before = inbox.lock().unwrap().len();
    assert_eq!(anon.post("/api/auth/password/forgot", json!({ "email": "dev@example.com" })).await.status(), StatusCode::OK);
    assert_eq!(inbox.lock().unwrap().len(), before + 1, "only the real account gets an email");
    let token = link_token(inbox.lock().unwrap().last().unwrap());
    let info: Value = anon.json(&format!("/api/auth/password/token?token={token}")).await;
    assert_eq!(info["purpose"], "reset");
    assert_eq!(anon.post("/api/auth/password/reset", json!({ "token": token, "password": "a-brand-new-password" })).await.status(), StatusCode::OK);
    assert_eq!(anon.post("/api/auth/password/reset", json!({ "token": token, "password": "another-password-1" })).await.status(), StatusCode::UNPROCESSABLE_ENTITY, "a link works once");
    assert_eq!(app.session().login("dev@example.com", "a-brand-new-password").await, StatusCode::OK);

    let invited = admin.post(&format!("/api/orgs/{org}/members"), json!({ "email": "invitee@example.com", "name": "Invitee", "role": "viewer" })).await;
    assert_eq!(invited.status(), StatusCode::CREATED);
    let mail = inbox.lock().unwrap().last().unwrap().clone();
    assert!(mail.contains("added you to"), "{mail}");
    let token = link_token(&mail);
    assert_eq!(anon.json(&format!("/api/auth/password/token?token={token}")).await["purpose"], "invite");
    assert_eq!(anon.post("/api/auth/password/reset", json!({ "token": token, "password": "invitee-password-1" })).await.status(), StatusCode::OK);
    assert_eq!(app.session().login("invitee@example.com", "invitee-password-1").await, StatusCode::OK);
}

async fn resend_sink() -> (String, Arc<Mutex<Vec<(String, Value)>>>) {
    use axum::Json;
    use axum::http::HeaderMap;
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let sent = Arc::new(Mutex::new(Vec::new()));
    let store = sent.clone();
    let app = axum::Router::new().route(
        "/emails",
        axum::routing::post(move |headers: HeaderMap, Json(body): Json<Value>| {
            let store = store.clone();
            async move {
                let auth = headers.get("authorization").and_then(|v| v.to_str().ok()).unwrap_or_default().to_owned();
                if auth != "Bearer re_test_key" {
                    return (StatusCode::UNAUTHORIZED, Json(json!({ "message": "API key is invalid" })));
                }
                store.lock().unwrap().push((auth, body));
                (StatusCode::OK, Json(json!({ "id": "sent-1" })))
            }
        }),
    );
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    (url, sent)
}

#[tokio::test]
async fn sends_through_resend_with_a_saved_api_key() {
    let (url, sent) = resend_sink().await;
    let app = common::spawn_with(|c| c.resend_url = Some(url)).await;
    let (admin, _) = app.setup().await;
    let resend = json!({ "provider": "resend", "from": "Tessery <tessery@example.com>" });

    let no_key = admin.put("/api/admin/email", json!({ "settings": resend })).await;
    assert_eq!(no_key.status(), StatusCode::UNPROCESSABLE_ENTITY, "Resend needs an API key");

    let saved: Value = admin.put("/api/admin/email", json!({ "settings": resend, "password": "re_test_key" })).await.json().await.unwrap();
    assert_eq!(saved["settings"]["provider"], "resend");
    assert_eq!(saved["hasPassword"], true);
    assert!(saved.to_string().find("re_test_key").is_none(), "the key is never sent back");

    assert_eq!(admin.post("/api/admin/email/test", json!({ "to": "admin@example.com" })).await.status(), StatusCode::OK);
    let (_, body) = sent.lock().unwrap().last().unwrap().clone();
    assert_eq!(body["to"], json!(["admin@example.com"]));
    assert_eq!(body["from"], "Tessery <tessery@example.com>");
    assert!(body["text"].as_str().unwrap().contains("Email from your Tessery instance works"));

    let kept = admin.put("/api/admin/email", json!({ "settings": { "provider": "resend", "from": "Ops <ops@example.com>" } })).await;
    assert_eq!(kept.status(), StatusCode::OK, "the saved key stays when only the sender changes");
    assert_eq!(admin.post("/api/admin/email/test", json!({ "to": "admin@example.com" })).await.status(), StatusCode::OK);
    assert_eq!(sent.lock().unwrap().last().unwrap().1["from"], "Ops <ops@example.com>");

    let blank = admin.put("/api/admin/email", json!({ "settings": resend, "password": "  " })).await;
    assert_eq!(blank.status(), StatusCode::UNPROCESSABLE_ENTITY, "a blank key is refused rather than wiping the saved one");
    assert_eq!(admin.json("/api/admin/email").await["hasPassword"], true);

    let wrong = admin.put("/api/admin/email", json!({ "settings": resend, "password": "re_wrong" })).await;
    assert_eq!(wrong.status(), StatusCode::OK);
    let refused = admin.post("/api/admin/email/test", json!({ "to": "admin@example.com" })).await;
    assert_eq!(refused.status(), StatusCode::CONFLICT);
    assert!(refused.text().await.unwrap().contains("API key is invalid"), "Resend's reason reaches the admin");

    let smtp = admin.put("/api/admin/email", json!({ "settings": { "provider": "smtp", "host": "127.0.0.1", "port": 2525, "from": "Tessery <tessery@example.com>", "security": "none" } })).await;
    let smtp: Value = smtp.json().await.unwrap();
    assert_eq!(smtp["hasPassword"], false, "a Resend key is not reused as an SMTP password");
}
