use crate::error::{DbError, DbResult, OptionalExt};
use sqlx::PgExecutor;
use time::OffsetDateTime;
use uuid::Uuid;

#[derive(Debug, Clone)]
pub struct Team {
    pub id: Uuid,
    pub org_id: Uuid,
    pub slug: String,
    pub name: String,
    pub description: String,
    pub member_count: i64,
    pub created_at: OffsetDateTime,
}

#[derive(Debug, Clone)]
pub struct TeamMember {
    pub user_id: Uuid,
    pub email: String,
    pub name: String,
    pub added_at: OffsetDateTime,
}

pub async fn create(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    slug: &str,
    name: &str,
    description: &str,
) -> DbResult<Team> {
    Ok(sqlx::query_as!(
        Team,
        r#"INSERT INTO teams (org_id, slug, name, description) VALUES ($1, $2, $3, $4)
           RETURNING id, org_id, slug, name, description, 0::bigint AS "member_count!", created_at"#,
        org_id,
        slug,
        name,
        description
    )
    .fetch_one(ex)
    .await?)
}

pub async fn list(ex: impl PgExecutor<'_>, org_id: Uuid) -> DbResult<Vec<Team>> {
    Ok(sqlx::query_as!(
        Team,
        r#"SELECT t.id, t.org_id, t.slug, t.name, t.description,
                  (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id) AS "member_count!", t.created_at
           FROM teams t WHERE t.org_id = $1 ORDER BY t.name"#,
        org_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn get(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<Team> {
    sqlx::query_as!(
        Team,
        r#"SELECT t.id, t.org_id, t.slug, t.name, t.description,
                  (SELECT count(*) FROM team_members tm WHERE tm.team_id = t.id) AS "member_count!", t.created_at
           FROM teams t WHERE t.org_id = $1 AND t.id = $2"#,
        org_id,
        id
    )
    .fetch_optional(ex)
    .await?
    .or_not_found()
}

pub async fn update(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    id: Uuid,
    slug: &str,
    name: &str,
    description: &str,
) -> DbResult<()> {
    let r = sqlx::query!(
        "UPDATE teams SET slug = $3, name = $4, description = $5 WHERE org_id = $1 AND id = $2",
        org_id,
        id,
        slug,
        name,
        description
    )
    .execute(ex)
    .await?;
    if r.rows_affected() == 0 {
        Err(DbError::NotFound)
    } else {
        Ok(())
    }
}

pub async fn delete(ex: impl PgExecutor<'_>, org_id: Uuid, id: Uuid) -> DbResult<()> {
    let r = sqlx::query!(
        "DELETE FROM teams WHERE org_id = $1 AND id = $2",
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

pub async fn add_member(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    team_id: Uuid,
    user_id: Uuid,
) -> DbResult<()> {
    sqlx::query!("INSERT INTO team_members (org_id, team_id, user_id) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING", org_id, team_id, user_id)
        .execute(ex)
        .await?;
    Ok(())
}

pub async fn remove_member(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    team_id: Uuid,
    user_id: Uuid,
) -> DbResult<()> {
    let r = sqlx::query!(
        "DELETE FROM team_members WHERE org_id = $1 AND team_id = $2 AND user_id = $3",
        org_id,
        team_id,
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

pub async fn list_members(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    team_id: Uuid,
) -> DbResult<Vec<TeamMember>> {
    Ok(sqlx::query_as!(
        TeamMember,
        "SELECT u.id AS user_id, u.email, u.name, tm.added_at FROM team_members tm JOIN users u ON u.id = tm.user_id
         WHERE tm.org_id = $1 AND tm.team_id = $2 ORDER BY u.name",
        org_id,
        team_id
    )
    .fetch_all(ex)
    .await?)
}

pub async fn team_ids_of_user(
    ex: impl PgExecutor<'_>,
    org_id: Uuid,
    user_id: Uuid,
) -> DbResult<Vec<Uuid>> {
    Ok(sqlx::query_scalar!(
        "SELECT team_id FROM team_members WHERE org_id = $1 AND user_id = $2",
        org_id,
        user_id
    )
    .fetch_all(ex)
    .await?)
}
