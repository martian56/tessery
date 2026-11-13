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
