#![allow(dead_code)]

use tessery_api::config::Config;
use reqwest::{Client, Method, Response, StatusCode};
use serde_json::{Value, json};
use sqlx::{Connection, PgConnection};
use std::net::SocketAddr;
use std::time::Duration;
use uuid::Uuid;

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_owned())
}

pub struct TestApp {
    pub base: String,
    pub db_name: String,
}

pub async fn spawn() -> TestApp {
    spawn_with(|_| {}).await
}

pub async fn spawn_with(customize: impl FnOnce(&mut Config)) -> TestApp {
    let admin_url = env(
        "TESSERY_TEST_DATABASE_URL",
        "postgres://tessery:tessery@127.0.0.1:15432/tessery",
    );
    let now = time::OffsetDateTime::now_utc().unix_timestamp();
    let db_name = format!(
        "tessery_test_{now}_{}",
        &Uuid::new_v4().simple().to_string()[..12]
    );
    let mut admin = PgConnection::connect(&admin_url)
        .await
        .expect("connect to test Postgres; is `docker compose up -d` running?");
    let stale: Vec<String> =
        sqlx::query_scalar("SELECT datname FROM pg_database WHERE datname LIKE 'tessery_test_%'")
            .fetch_all(&mut admin)
            .await
            .unwrap();
    for name in stale {
        let created = name
            .split('_')
            .nth(2)
            .and_then(|t| t.parse::<i64>().ok())
            .unwrap_or(0);
        if now - created > 3600 {
            let _ = sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
                "DROP DATABASE IF EXISTS {name} WITH (FORCE)"
            )))
            .execute(&mut admin)
            .await;
        }
    }
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!("CREATE DATABASE {db_name}")))
        .execute(&mut admin)
        .await
        .unwrap();
    let base_url = admin_url.rsplit_once('/').unwrap().0;

    let mut config = Config {
        bind: "127.0.0.1:0".parse().unwrap(),
        database_url: format!("{base_url}/{db_name}"),
        db_max_connections: 5,
        redis_url: env("TESSERY_TEST_REDIS_URL", "redis://127.0.0.1:16379"),
        amqp_url: env("TESSERY_TEST_AMQP_URL", "amqp://tessery:tessery@127.0.0.1:15671/%2f"),
        web_dir: None,
        cookie_secure: false,
        session_ttl: Duration::from_secs(3600),
        log_json: false,
        trust_proxy: true,
        data_dir: std::env::temp_dir().join("tessery-tests").join(&db_name),
        secret_key: Some(tessery_core::SecretKey::parse(&"7".repeat(64)).unwrap()),
        oidc: None,
        provider_apis: Default::default(),
        engine: tessery_engine::EngineConfig {
            node: "node".into(),
            script: std::path::PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../../../../packages/core/dist/tessery-engine.mjs"),
            processes: 1,
            timeout: Duration::from_secs(30),
        },
    };
    customize(&mut config);
    let state = tessery_api::connect(config).await.expect("connect test state");
    let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
    let addr = listener.local_addr().unwrap();
    tokio::spawn(async move {
        axum::serve(
            listener,
            tessery_api::app(state).into_make_service_with_connect_info::<SocketAddr>(),
        )
        .await
        .unwrap();
    });
    TestApp {
        base: format!("http://{addr}"),
        db_name,
    }
}

pub struct Session {
    pub http: Client,
    pub base: String,
    ip: String,
}

impl TestApp {
    pub fn session(&self) -> Session {
        Session {
            http: Client::builder().cookie_store(true).build().unwrap(),
            base: self.base.clone(),
            ip: format!("10.{}.{}.{}", rand_u8(), rand_u8(), rand_u8()),
        }
    }

    pub async fn setup(&self) -> (Session, Uuid) {
        let s = self.session();
        let r = s.post("/api/setup", json!({ "email": "admin@example.com", "name": "Admin", "password": "admin-password-1", "orgName": "Acme" })).await;
        assert_eq!(r.status(), StatusCode::CREATED);
        let body: Value = r.json().await.unwrap();
        (s, body["orgId"].as_str().unwrap().parse().unwrap())
    }
}

fn rand_u8() -> u8 {
    (Uuid::new_v4().as_bytes()[0] % 250) + 1
}

impl Session {
    pub async fn request(&self, method: Method, path: &str, body: Option<Value>) -> Response {
        let mut req = self
            .http
            .request(method, format!("{}{}", self.base, path))
            .header("x-tessery-csrf", "1")
            .header("x-forwarded-for", &self.ip);
        if let Some(b) = body {
            req = req.json(&b);
        }
        req.send().await.unwrap()
    }
    pub async fn get(&self, path: &str) -> Response {
        self.request(Method::GET, path, None).await
    }
    pub async fn post(&self, path: &str, body: Value) -> Response {
        self.request(Method::POST, path, Some(body)).await
    }
    pub async fn put(&self, path: &str, body: Value) -> Response {
        self.request(Method::PUT, path, Some(body)).await
    }
    pub async fn patch(&self, path: &str, body: Value) -> Response {
        self.request(Method::PATCH, path, Some(body)).await
    }
    pub async fn delete(&self, path: &str) -> Response {
        self.request(Method::DELETE, path, None).await
    }
    pub async fn json(&self, path: &str) -> Value {
        let r = self.get(path).await;
        assert!(r.status().is_success(), "GET {path} -> {}", r.status());
        r.json().await.unwrap()
    }
    pub async fn login(&self, email: &str, password: &str) -> StatusCode {
        self.post(
            "/api/auth/login",
            json!({ "email": email, "password": password }),
        )
        .await
        .status()
    }
}

pub async fn add_member(
    app: &TestApp,
    admin: &Session,
    org: Uuid,
    email: &str,
    role: &str,
) -> (Session, Uuid) {
    let r = admin.post(&format!("/api/orgs/{org}/members"), json!({ "email": email, "name": email.split('@').next().unwrap(), "password": "member-password-1", "role": role })).await;
    assert_eq!(
        r.status(),
        StatusCode::CREATED,
        "adding {email}: {}",
        r.text().await.unwrap_or_default()
    );
    let user: Value = admin.json(&format!("/api/orgs/{org}/members")).await;
    let id = user
        .as_array()
        .unwrap()
        .iter()
        .find(|m| m["email"] == email)
        .unwrap()["userId"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap();
    let s = app.session();
    assert_eq!(s.login(email, "member-password-1").await, StatusCode::OK);
    (s, id)
}

pub fn doc(name: &str) -> Value {
    json!({ "name": name, "description": "test project", "icon": "o", "nodes": [], "edges": [], "apis": {}, "databases": {}, "pages": [], "environments": [], "observability": {} })
}

pub async fn role_id(s: &Session, org: Uuid, key: &str) -> Uuid {
    let roles: Value = s.json(&format!("/api/orgs/{org}/roles")).await;
    roles
        .as_array()
        .unwrap()
        .iter()
        .find(|r| r["key"] == key)
        .unwrap()["id"]
        .as_str()
        .unwrap()
        .parse()
        .unwrap()
}
