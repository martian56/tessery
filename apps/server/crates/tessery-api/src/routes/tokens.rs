use crate::audit::{self, Entry};
use crate::auth::{Principal, TOKEN_PREFIX, token_hash};
use crate::error::{ApiError, ApiResult};
use crate::rbac;
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use tessery_core::Permission;
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use rand::Rng;
use serde::{Deserialize, Serialize};
use serde_json::json;
use time::{Duration, OffsetDateTime};
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct TokenDto {
    pub id: Uuid,
    pub name: String,
    /// First characters of the token, to tell tokens apart.
    pub prefix: String,
    /// `None` means every permission the owner has.
    pub permissions: Option<Vec<String>>,
    pub project_id: Option<Uuid>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub expires_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_used_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<tessery_db::tokens::Token> for TokenDto {
    fn from(t: tessery_db::tokens::Token) -> Self {
        Self { id: t.id, name: t.name, prefix: t.prefix, permissions: t.permissions, project_id: t.project_id, expires_at: t.expires_at, last_used_at: t.last_used_at, created_at: t.created_at }
    }
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct CreateToken {
    pub name: String,
    /// Permission keys like `project:read`; omit for everything you can do.
    pub permissions: Option<Vec<String>>,
    /// Restrict the token to one project.
    pub project_id: Option<Uuid>,
    /// Days until the token stops working; omit for no expiry.
    pub expires_in_days: Option<u32>,
}

#[derive(Serialize, ToSchema)]
pub struct CreatedToken {
    pub token: TokenDto,
    /// The token itself. It is not shown again.
    pub secret: String,
}

fn sessions_only(p: &Principal) -> ApiResult<()> {
    if p.scope.is_some() {
        return Err(ApiError::ForbiddenMsg("API tokens cannot manage tokens; sign in instead".into()));
    }
    Ok(())
}

#[utoipa::path(get, path = "/api/auth/tokens", tag = "auth", responses((status = 200, body = [TokenDto])))]
pub async fn list(State(state): State<AppState>, p: Principal) -> ApiResult<Json<Vec<TokenDto>>> {
    sessions_only(&p)?;
    Ok(Json(tessery_db::tokens::list(&state.db, p.user.id).await?.into_iter().map(Into::into).collect()))
}

#[utoipa::path(post, path = "/api/auth/tokens", tag = "auth", request_body = CreateToken, responses((status = 201, body = CreatedToken)))]
pub async fn create(State(state): State<AppState>, p: Principal, Json(req): Json<CreateToken>) -> ApiResult<(StatusCode, Json<CreatedToken>)> {
    sessions_only(&p)?;
    let name = req.name.trim();
    if name.is_empty() || name.len() > 80 {
        return Err(ApiError::invalid("name", "1 to 80 characters"));
    }
    let permissions = match &req.permissions {
        None => None,
        Some(ps) if ps.is_empty() => return Err(ApiError::invalid("permissions", "pick at least one permission, or omit the list")),
        Some(ps) => {
            for k in ps {
                k.parse::<Permission>().map_err(|_| ApiError::invalid("permissions", format!("unknown permission `{k}`")))?;
            }
            Some(ps.clone())
        }
    };
    if let Some(project) = req.project_id {
        let target = rbac::project_target(&state, project).await?;
        rbac::require(&state, &p, &target, Permission::ProjectRead).await?;
    }
    let mut bytes = [0u8; 30];
    rand::rng().fill_bytes(&mut bytes);
    let secret = format!("{TOKEN_PREFIX}{}", hex::encode(bytes));
    let prefix = secret[..TOKEN_PREFIX.len() + 6].to_owned();
    let row = tessery_db::tokens::create(
        &state.db,
        tessery_db::tokens::NewToken {
            user_id: p.user.id,
            name,
            prefix: &prefix,
            hash: &token_hash(&secret),
            permissions: permissions.as_deref(),
            project_id: req.project_id,
            expires_at: req.expires_in_days.map(|d| OffsetDateTime::now_utc() + Duration::days(i64::from(d.clamp(1, 3650)))),
        },
    )
    .await?;
    audit::record(&state.db, &p, Entry::new(None, "token.create", "token", row.id).details(json!({ "name": name, "projectId": req.project_id, "permissions": permissions }))).await?;
    Ok((StatusCode::CREATED, Json(CreatedToken { token: row.into(), secret })))
}

#[utoipa::path(delete, path = "/api/auth/tokens/{id}", tag = "auth", params(("id" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn revoke(State(state): State<AppState>, p: Principal, Path(id): Path<Uuid>) -> ApiResult<Json<Ok>> {
    sessions_only(&p)?;
    if !tessery_db::tokens::revoke(&state.db, p.user.id, id).await? {
        return Err(ApiError::NotFound);
    }
    audit::record(&state.db, &p, Entry::new(None, "token.revoke", "token", id)).await?;
    Ok(Json(OK))
}
