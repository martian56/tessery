use serde_json::Value;

pub const MIGRATIONS_FILE: &str = "db/migrations.json";

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingMigration {
    pub database: String,
    pub file: String,
    pub sql: String,
    pub destructive: Vec<String>,
}

fn databases(state: &Value) -> impl Iterator<Item = (&String, &Value)> {
    state["databases"].as_object().into_iter().flatten()
}

fn files(db: &Value) -> impl Iterator<Item = &Value> {
    db["migrations"].as_array().into_iter().flatten()
}

pub fn pending_migrations(running: Option<&Value>, next: &Value) -> Vec<PendingMigration> {
    let mut out = Vec::new();
    for (id, db) in databases(next) {
        let applied: Vec<&str> = running
            .and_then(|r| r["databases"].get(id))
            .map(|d| files(d).filter_map(|m| m["file"].as_str()).collect())
            .unwrap_or_default();
        for m in files(db) {
            let Some(file) = m["file"].as_str() else { continue };
            if applied.contains(&file) {
                continue;
            }
            out.push(PendingMigration {
                database: db["node"].as_str().unwrap_or(id).to_owned(),
                file: file.to_owned(),
                sql: m["sql"].as_str().unwrap_or_default().to_owned(),
                destructive: m["destructive"].as_array().into_iter().flatten().filter_map(|d| d.as_str().map(str::to_owned)).collect(),
            });
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    fn state(files: &[(&str, &[&str])]) -> Value {
        json!({ "version": 1, "databases": { "n1": { "node": "shop-db", "migrations": files.iter().map(|(f, d)| json!({ "file": f, "sql": "SELECT 1;", "destructive": d })).collect::<Vec<_>>() } } })
    }

    #[test]
    fn lists_only_migrations_the_environment_has_not_run() {
        let running = state(&[("0001_init.sql", &[])]);
        let next = state(&[("0001_init.sql", &[]), ("0002_drop_orders_note.sql", &["drops column orders.note and its values"])]);
        let pending = pending_migrations(Some(&running), &next);
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].database, "shop-db");
        assert_eq!(pending[0].file, "0002_drop_orders_note.sql");
        assert_eq!(pending[0].destructive, ["drops column orders.note and its values"]);
        assert!(pending_migrations(Some(&next), &running).is_empty(), "rolling back runs nothing");
        assert_eq!(pending_migrations(None, &next).len(), 2);
    }
}
