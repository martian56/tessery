mod common;

use common::doc;
use serde_json::{Value, json};
use sqlx::Connection;

#[tokio::test]
async fn spans_are_kept_for_the_days_the_environment_sets() {
    let app = common::spawn().await;
    let (admin, org) = app.setup().await;
    let mut d = doc("shop");
    d["environments"] = json!([{ "id": "dev", "name": "Development" }, { "id": "prod", "name": "Production", "traceRetentionDays": 7 }]);
    let project: Value = admin.post(&format!("/api/orgs/{org}/projects"), json!({ "doc": d })).await.json().await.unwrap();
    let pid: uuid::Uuid = project["id"].as_str().unwrap().parse().unwrap();

    let url = std::env::var("TESSERY_TEST_DATABASE_URL").unwrap_or_else(|_| "postgres://tessery:tessery@127.0.0.1:15432/tessery".into());
    let url = format!("{}/{}", url.rsplit_once('/').unwrap().0, app.db_name);
    let mut conn = sqlx::PgConnection::connect(&url).await.unwrap();
    for env in ["dev", "prod"] {
        sqlx::raw_sql(sqlx::AssertSqlSafe(format!(
            "INSERT INTO spans (project_id, env_key, trace_id, span_id, parent_id, service, name, kind, start_at, duration_us, error, attributes)
             SELECT '{pid}', '{env}', 't' || d, 's' || d, '', 'api', 'GET /', 2, now() - make_interval(days => d, hours => 1), 1000, false, '{{}}'
             FROM unnest(ARRAY[1, 5, 10]) AS d"
        )))
        .execute(&mut conn)
        .await
        .unwrap();
    }

    assert_eq!(tessery_db::telemetry::retention_days(&mut conn, pid, "dev").await.unwrap(), 3, "an environment without the setting keeps 3 days");
    assert_eq!(tessery_db::telemetry::retention_days(&mut conn, pid, "prod").await.unwrap(), 7);
    for env in ["dev", "prod"] {
        let days = tessery_db::telemetry::retention_days(&mut conn, pid, env).await.unwrap();
        tessery_db::telemetry::prune(&mut conn, pid, env, days).await.unwrap();
    }
    let left = |env: &'static str| {
        let url = url.clone();
        async move {
            let mut c = sqlx::PgConnection::connect(&url).await.unwrap();
            sqlx::query_scalar::<_, String>("SELECT trace_id FROM spans WHERE project_id = $1 AND env_key = $2 ORDER BY trace_id")
                .bind(pid)
                .bind(env)
                .fetch_all(&mut c)
                .await
                .unwrap()
        }
    };
    assert_eq!(left("dev").await, ["t1"], "3 days drops spans from 5 and 10 days ago");
    assert_eq!(left("prod").await, ["t1", "t5"], "7 days keeps a span from 5 days ago and drops one from 10");
}
