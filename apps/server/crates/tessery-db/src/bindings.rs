use crate::error::{DbError, DbResult};
use crate::types::{ScopeKind, SubjectKind};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Binding {
    pub id: Uuid,
    pub org_id: Uuid,
    pub role_id: Uuid,
    pub role_key: String,
    pub role_name: String,
    pub role_is_builtin: bool,
    pub role_permissions: Vec<String>,
    pub subject_kind: SubjectKind,
    pub subject_id: Uuid,
    pub subject_name: Option<String>,
    pub scope_kind: ScopeKind,
    pub scope_id: Option<Uuid>,
    pub env_key: Option<String>,
    pub expires_at: Option<OffsetDateTime>,
    pub created_at: OffsetDateTime,
    pub created_by: Option<Uuid>,
}

pub struct NewBinding<'a> {
    pub org_id: Uuid,
    pub role_id: Uuid,
    pub subject_kind: SubjectKind,
    pub subject_id: Uuid,
    pub scope_kind: ScopeKind,
    pub scope_id: Option<Uuid>,
    pub env_key: Option<&'a str>,
    pub expires_at: Option<OffsetDateTime>,
    pub created_by: Uuid,
}

pub async fn list(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<Binding>> {
    Ok(sqlx::query_as!(
        Binding,
        r#"SELECT b.id, b.org_id, b.role_id, r.key AS role_key, r.name AS role_name, (r.org_id IS NULL) AS "role_is_builtin!",
                  r.permissions AS role_permissions,
                  b.subject_kind AS "subject_kind: SubjectKind", b.subject_id,
                  CASE b.subject_kind WHEN 'user' THEN (SELECT u.name FROM users u WHERE u.id = b.subject_id)
                                      ELSE (SELECT t.name FROM teams t WHERE t.id = b.subject_id) END AS subject_name,
                  b.scope_kind AS "scope_kind: ScopeKind", b.scope_id, b.env_key, b.expires_at, b.created_at, b.created_by
           FROM role_bindings b JOIN roles r ON r.id = b.role_id
           WHERE b.org_id = $1 ORDER BY b.created_at"#,
        org_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn for_user(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    user_id: Uuid,
) -> DbResult<Vec<Binding>> {
    Ok(sqlx::query_as!(
        Binding,
        r#"SELECT b.id, b.org_id, b.role_id, r.key AS role_key, r.name AS role_name, (r.org_id IS NULL) AS "role_is_builtin!",
                  r.permissions AS role_permissions,
                  b.subject_kind AS "subject_kind: SubjectKind", b.subject_id, NULL::text AS subject_name,
                  b.scope_kind AS "scope_kind: ScopeKind", b.scope_id, b.env_key, b.expires_at, b.created_at, b.created_by
           FROM role_bindings b JOIN roles r ON r.id = b.role_id
           WHERE b.org_id = $1
             AND ((b.subject_kind = 'user' AND b.subject_id = $2)
               OR (b.subject_kind = 'team' AND b.subject_id IN (SELECT team_id FROM team_members WHERE org_id = $1 AND user_id = $2)))"#,
        org_id,
        user_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn create(ex: impl PgExecutor<'_>, b: NewBinding<'_>) -> DbResult<Uuid> {
    Ok(sqlx::query_scalar!(
        "INSERT INTO role_bindings (org_id, role_id, subject_kind, subject_id, scope_kind, scope_id, env_key, expires_at, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id",
        b.org_id,
        b.role_id,
        b.subject_kind as SubjectKind,
        b.subject_id,
        b.scope_kind as ScopeKind,
        b.scope_id,
        b.env_key,
        b.expires_at,
        b.created_by
    )
    .fetch_one(ex)
    .await?)
}

pub async fn delete(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!(
        "DELETE FROM role_bindings WHERE org_id = $1 AND id = $2",
        org_id,
        id
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn delete_for_subject(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    kind: SubjectKind,
    subject_id: Uuid,
) -> DbResult<u64> {
    Ok(sqlx::query!(
        "DELETE FROM role_bindings WHERE org_id = $1 AND subject_kind = $2 AND subject_id = $3",
        org_id,
        kind as SubjectKind,
        subject_id
    )
    .execute(ex)
    .await?
    .rows_affected())
}

pub async fn count_org_owners(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<i64> {
    Ok(sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM role_bindings b JOIN roles r ON r.id = b.role_id
           WHERE b.org_id = $1 AND r.key = 'owner' AND r.org_id IS NULL AND b.scope_kind = 'org'
             AND b.subject_kind = 'user' AND (b.expires_at IS NULL OR b.expires_at > now())"#,
        org_id
    )
    .fetch_one(ex)
    .await?)
}

#[derive(Debug, Clone)]
pub struct Expired {
    pub id: Uuid,
    pub org_id: Uuid,
    pub role_key: String,
    pub subject_kind: SubjectKind,
    pub subject_id: Uuid,
}

pub async fn delete_expired(ex: impl PgExecutor<'_>) -> DbResult<Vec<Expired>> {
    Ok(sqlx::query_as!(
        Expired,
        r#"WITH gone AS (DELETE FROM role_bindings WHERE expires_at IS NOT NULL AND expires_at <= now()
                         RETURNING id, org_id, role_id, subject_kind, subject_id)
           SELECT g.id, g.org_id, r.key AS role_key, g.subject_kind AS "subject_kind: SubjectKind", g.subject_id
           FROM gone g JOIN roles r ON r.id = g.role_id"#
    )
    .fetch_all(ex)
    .await?)
}
