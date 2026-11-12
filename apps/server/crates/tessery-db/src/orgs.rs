use crate::error::{DbError, DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Org {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct Member {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub is_instance_admin: bool,
    pub disabled: bool,
    pub joined_at: OffsetDateTime,
}

pub async fn create(
    ex: impl PgExecutor<'_>,
    slug: &str,
    name: &str,
    created_by: Uuid,
) -> DbResult<Org> {
    Ok(sqlx::query_as!(Org, "INSERT INTO organizations (slug, name, created_by) VALUES ($1, $2, $3) RETURNING id, slug, name, created_at", slug, name, created_by)
        .fetch_one(ex)
        .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<Org> {
    sqlx::query_as!(
        Org,
        "SELECT id, slug, name, created_at FROM organizations WHERE id = $1",
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn get_by_slug(ex: impl PgExecutor<'_>, slug: &str) -> DbResult<Org> {
    sqlx::query_as!(
        Org,
        "SELECT id, slug, name, created_at FROM organizations WHERE slug = $1",
        slug
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn list_for_user(ex: impl PgExecutor<'_>, user_id: Uuid) -> DbResult<Vec<Org>> {
    Ok(sqlx::query_as!(
        Org,
        "SELECT o.id, o.slug, o.name, o.created_at FROM organizations o JOIN org_members m ON m.org_id = o.id WHERE m.user_id = $1 ORDER BY o.name",
        user_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn list_all(ex: impl PgExecutor<'_>) -> DbResult<Vec<Org>> {
    Ok(sqlx::query_as!(
        Org,
        "SELECT id, slug, name, created_at FROM organizations ORDER BY name"
    )
    .fetch_all(ex)
    .await?)
}

pub async fn update(ex: impl PgExecutor<'_>, id: Uuid, slug: &str, name: &str) -> DbResult<Org> {
    sqlx::query_as!(Org, "UPDATE organizations SET slug = $2, name = $3 WHERE id = $1 RETURNING id, slug, name, created_at", id, slug, name)
        .fetch_optional(ex)
        .await?
        .or_not_found()
}

pub async fn delete(ex: impl PgExecutor<'_>, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!("DELETE FROM organizations WHERE id = $1", id)
        .execute(ex)
        .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn add_member(ex: impl PgExecutor<'_>, org_id: Uuid, user_id: Uuid) -> DbResult<()> {
    sqlx::query!(
        "INSERT INTO org_members (org_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING",
        org_id,
        user_id
    )
    .execute(ex)
    .await?;
    Ok(())
}

pub async fn remove_member(ex: impl PgExecutor<'_>, org_id: Uuid, user_id: Uuid) -> DbResult<()> {
    let r = sqlx::query!(
        "DELETE FROM org_members WHERE org_id = $1 AND user_id = $2",
        org_id,
        user_id
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn is_member(ex: impl PgExecutor<'_>, org_id: Uuid, user_id: Uuid) -> DbResult<bool> {
    Ok(sqlx::query_scalar!(
        r#"SELECT EXISTS (SELECT 1 FROM org_members WHERE org_id = $1 AND user_id = $2) AS "e!""#,
        org_id,
        user_id
    )
    .fetch_one(ex)
    .await?)
}

pub async fn list_members(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<Member>> {
    Ok(sqlx::query_as!(
        Member,
        r#"SELECT u.id AS user_id, u.email, u.name, u.is_instance_admin, (u.disabled_at IS NOT NULL) AS "disabled!", m.joined_at
           FROM org_members m JOIN users u ON u.id = m.user_id WHERE m.org_id = $1 ORDER BY u.name"#,
        org_id
    )
    .fetch_all(ex)
    .await?)
}
