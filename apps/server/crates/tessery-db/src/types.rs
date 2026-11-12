use serde::{Deserialize, Serialize};

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "subject_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum SubjectKind {
    User,
    Team,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "scope_kind", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ScopeKind {
    Org,
    Team,
    Project,
    Environment,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "audit_result", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum AuditResult {
    Allowed,
    Denied,
    Bypassed,
}

impl From<tessery_core::Decision> for AuditResult {
    fn from(d: tessery_core::Decision) -> Self {
        match d {
            tessery_core::Decision::Allowed => AuditResult::Allowed,
            tessery_core::Decision::Denied => AuditResult::Denied,
            tessery_core::Decision::Bypassed => AuditResult::Bypassed,
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "export_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ExportStatus {
    Queued,
    Running,
    Done,
    Failed,
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, sqlx::Type, utoipa::ToSchema,
)]
#[sqlx(type_name = "release_status", rename_all = "snake_case")]
#[serde(rename_all = "snake_case")]
pub enum ReleaseStatus {
    Pending,
    Queued,
    Deploying,
    Released,
    Rejected,
    Cancelled,
    Failed,
}
