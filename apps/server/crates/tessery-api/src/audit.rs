use crate::auth::Principal;
use tessery_core::Decision;
use tessery_db::audit::NewEvent;
use serde_json::Value;
use sqlx::PgExecutor;
use uuid::Uuid;

pub struct Entry<'a> {
    pub org: Option<Uuid>,
    pub action: &'a str,
    pub resource_type: &'a str,
    pub resource_id: Option<String>,
    pub decision: Decision,
    pub details: Value,
}

impl<'a> Entry<'a> {
    pub fn new(
        org: Option<Uuid>,
        action: &'a str,
        resource_type: &'a str,
        resource_id: impl ToString,
    ) -> Self {
        Self {
            org,
            action,
            resource_type,
            resource_id: Some(resource_id.to_string()),
            decision: Decision::Allowed,
            details: Value::Object(Default::default()),
        }
    }

    pub fn decision(mut self, d: Decision) -> Self {
        self.decision = d;
        self
    }

    pub fn details(mut self, v: Value) -> Self {
        self.details = v;
        self
    }
}

pub async fn record(
    ex: impl PgExecutor<'_>,
    actor: &Principal,
    e: Entry<'_>,
) -> Result<(), tessery_db::DbError> {
    tessery_db::audit::insert(
        ex,
        NewEvent {
            org_id: e.org,
            actor_id: Some(actor.user.id),
            actor_email: Some(actor.user.email.clone()),
            action: e.action.to_owned(),
            resource_type: e.resource_type.to_owned(),
            resource_id: e.resource_id,
            result: Some(e.decision.into()),
            ip: actor.meta.ip.clone(),
            user_agent: actor.meta.user_agent.clone(),
            details: e.details,
        },
    )
    .await
}
