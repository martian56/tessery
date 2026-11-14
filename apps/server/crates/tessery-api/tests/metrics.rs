mod common;

use common::{add_member, doc};
use reqwest::StatusCode;
use serde_json::{Value, json};
use sqlx::Connection;

#[tokio::test]
async fn charts_read_stored_samples_and_rules_are_checked() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let mut d = doc("shop");
    d["nodes"] = json!([{ "id": "n1", "name": "web", "techId": "nextjs" }]);
    d["environments"] = json!([{ "id": "prod", "name": "Production" }]);
    let project: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": d })).await.json().await.unwrap();
    let pid = project["id"].as_str().unwrap().to_owned();

    let url = std::env::var("TESSERY_TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://tessery:tessery@127.0.0.1:15432/tessery".into());
    let url = format!("{}/{}", url.rsplit_once('/').unwrap().0, app.db_name);
    let mut conn = sqlx::PgConnection::connect(&url).await.unwrap();
    sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
        "INSERT INTO metric_samples (project_id, env_key, node, instance, at, state, healthy, cpu_percent, memory_bytes, memory_limit_bytes, restarts)
         SELECT '{pid}', 'prod', 'web', 'web-' || r, now() - make_interval(secs => i * 30), 'running', true, 20 + r, 100 * r, 1000, 0
         FROM generate_series(0, 200) AS i, generate_series(1, 2) AS r"
    )))
    .execute(&mut conn)
    .await
    .unwrap();

    let hour: Value = admin.json(&format!("/api/projects/{pid}/environments/prod/metrics?range=1h")).await;
    assert_eq!(hour["stepSeconds"], 30);
    let web = &hour["nodes"][0];
    assert_eq!(web["name"], "web");
    let last = web["points"].as_array().unwrap().last().unwrap();
    assert_eq!(last["cpu"], 43.0, "replicas add up");
    assert_eq!(last["memoryBytes"], 300.0);
    assert_eq!(last["ok"], true);
    let day: Value = admin.json(&format!("/api/projects/{pid}/environments/prod/metrics?range=1d")).await;
    assert_eq!(day["stepSeconds"], 300);
    assert!(day["nodes"][0]["points"].as_array().unwrap().len() < web["points"].as_array().unwrap().len());
    assert_eq!(admin.get(&format!("/api/projects/{pid}/environments/prod/metrics?range=1y")).await.status(), StatusCode::UNPROCESSABLE_ENTITY);

    let alerts = format!("/api/projects/{pid}/environments/prod/alerts");
    assert_eq!(admin.post(&alerts, json!({ "metric": "memory", "threshold": 120, "minutes": 5 })).await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(admin.post(&alerts, json!({ "node": "nope", "metric": "cpu", "threshold": 80, "minutes": 5 })).await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let created = admin.post(&alerts, json!({ "node": "web", "metric": "restarts", "threshold": 3, "minutes": 10 })).await;
    assert_eq!(created.status(), StatusCode::CREATED);
    let rule: Value = created.json().await.unwrap();
    assert_eq!(rule["summary"], "web restarted at least 3 times in 10 min");

    let (viewer, _) = add_member(&app, &admin, org, "viewer@example.com", "viewer").await;
    assert_eq!(viewer.json(&alerts).await.as_array().unwrap().len(), 1, "viewers can read rules");
    assert_eq!(viewer.post(&alerts, json!({ "metric": "unhealthy", "minutes": 2 })).await.status(), StatusCode::FORBIDDEN);
    assert_eq!(admin.delete(&format!("/api/projects/{pid}/alerts/{}", rule["id"].as_str().unwrap())).await.status(), StatusCode::OK);

    let settings: Value = admin.json("/api/admin/settings").await;
    assert_eq!(settings["metricsRetentionDays"], 7);
    assert_eq!(admin.put("/api/admin/settings", json!({ "allowOrgCreation": true, "metricsRetentionDays": 400 })).await.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(admin.put("/api/admin/settings", json!({ "allowOrgCreation": true, "metricsRetentionDays": 30 })).await.status(), StatusCode::OK);
    assert_eq!(admin.json("/api/admin/settings").await["metricsRetentionDays"], 30);
}
