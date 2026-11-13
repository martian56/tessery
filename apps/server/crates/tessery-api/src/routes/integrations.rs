use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::cloud::{self, ProviderSpec};
use crate::error::{ApiError, ApiResult};
use crate::rbac::{self, org_target};
use crate::routes::dto::{OK, Ok};
use crate::state::AppState;
use tessery_core::Permission as P;
use tessery_db::integrations::{self as db, NewIntegration};
use axum::Json;
use axum::extract::{Path, State};
use axum::http::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationDto {
    pub id: Uuid,
    pub provider: String,
    pub name: String,
    /// Non-secret details, such as a masked key ID, the region or the service account email.
    #[schema(value_type = Object)]
    pub summary: Value,
    /// Result of the last check: `ok`, then `account` or `error`.
    #[schema(value_type = Option<Object>)]
    pub last_check: Option<Value>,
    #[serde(with = "time::serde::rfc3339::option")]
    pub checked_at: Option<OffsetDateTime>,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<db::Integration> for IntegrationDto {
    fn from(i: db::Integration) -> Self {
        Self { id: i.id, provider: i.provider, name: i.name, summary: i.summary, last_check: i.last_check, checked_at: i.checked_at, created_at: i.created_at }
    }
}

fn key(state: &AppState) -> ApiResult<&tessery_core::SecretKey> {
    state.config.secret_key.as_ref().ok_or_else(|| ApiError::Conflict("set TESSERY_SECRET_KEY on the server to store cloud credentials".into()))
}

fn spec(provider: &str) -> ApiResult<&'static ProviderSpec> {
    cloud::provider(provider).ok_or_else(|| ApiError::invalid("provider", format!("use one of {}", cloud::PROVIDERS.iter().map(|p| p.id).collect::<Vec<_>>().join(", "))))
}

fn check_name(name: &str) -> ApiResult<&str> {
    let n = name.trim();
    if n.is_empty() || n.chars().count() > 80 {
        return Err(ApiError::invalid("name", "must be 1 to 80 characters"));
    }
    Ok(n)
}

/// Cloud providers Tessery can connect to, with the fields each one needs.
#[utoipa::path(get, path = "/api/integrations/providers", tag = "integrations", responses((status = 200, body = [ProviderSpec])))]
pub async fn providers(_p: Principal) -> Json<&'static [ProviderSpec]> {
    Json(cloud::PROVIDERS)
}

#[utoipa::path(get, path = "/api/orgs/{org}/integrations", tag = "integrations", params(("org" = Uuid, Path)), responses((status = 200, body = [IntegrationDto])))]
pub async fn list(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>) -> ApiResult<Json<Vec<IntegrationDto>>> {
    rbac::require(&state, &p, &org_target(org), P::IntegrationRead).await?;
    Ok(Json(db::list(&state.db, org).await?.into_iter().map(Into::into).collect()))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct NewIntegrationInput {
    pub provider: String,
    pub name: String,
    /// The provider's fields, as listed by `/api/integrations/providers`.
    #[schema(value_type = Object)]
    pub fields: Map<String, Value>,
}

/// Connects a cloud account. The credentials are checked with the provider first and refused if it rejects them.
#[utoipa::path(post, path = "/api/orgs/{org}/integrations", tag = "integrations", params(("org" = Uuid, Path)), request_body = NewIntegrationInput, responses((status = 201, body = IntegrationDto), (status = 422)))]
pub async fn create(State(state): State<AppState>, p: Principal, Path(org): Path<Uuid>, Json(req): Json<NewIntegrationInput>) -> ApiResult<(StatusCode, Json<IntegrationDto>)> {
    let d = rbac::require(&state, &p, &org_target(org), P::IntegrationManage).await?;
    let spec = spec(&req.provider)?;
    let name = check_name(&req.name)?;
    let fields = cloud::clean(spec, &req.fields).map_err(|e| ApiError::invalid("fields", e))?;
    let account = cloud::verify(spec.id, &fields, &state.config.provider_apis).await.map_err(|e| ApiError::invalid("fields", e))?;
    let cipher = key(&state)?.encrypt(serde_json::to_vec(&fields).map_err(|e| ApiError::Internal(e.into()))?.as_slice());
    let summary = cloud::summary(spec.id, &fields);
    let check = json!({ "ok": true, "account": account });
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let i = db::create(&mut *tx, NewIntegration { org_id: org, provider: spec.id, name, secret: &cipher, summary: &summary, check: &check, created_by: p.user.id }).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "integration.create", "integration", i.id).decision(d).details(json!({ "provider": spec.id, "name": name, "account": account }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok((StatusCode::CREATED, Json(i.into())))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct IntegrationPatch {
    pub name: Option<String>,
    /// Replace the credentials. They are checked with the provider first.
    #[schema(value_type = Option<Object>)]
    pub fields: Option<Map<String, Value>>,
}

#[utoipa::path(patch, path = "/api/orgs/{org}/integrations/{integration}", tag = "integrations", params(("org" = Uuid, Path), ("integration" = Uuid, Path)), request_body = IntegrationPatch, responses((status = 200, body = IntegrationDto)))]
pub async fn update(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>, Json(req): Json<IntegrationPatch>) -> ApiResult<Json<IntegrationDto>> {
    let d = rbac::require(&state, &p, &org_target(org), P::IntegrationManage).await?;
    let current = db::get(&state.db, org, id).await?;
    let name = req.name.as_deref().map(check_name).transpose()?;
    let replaced = match &req.fields {
        Some(input) => {
            let fields = cloud::clean(spec(&current.provider)?, input).map_err(|e| ApiError::invalid("fields", e))?;
            let account = cloud::verify(&current.provider, &fields, &state.config.provider_apis).await.map_err(|e| ApiError::invalid("fields", e))?;
            let cipher = key(&state)?.encrypt(serde_json::to_vec(&fields).map_err(|e| ApiError::Internal(e.into()))?.as_slice());
            Some((cipher, cloud::summary(&current.provider, &fields), account))
        }
        None => None,
    };
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let i = db::update(&mut *tx, org, id, name, replaced.as_ref().map(|(c, s, _)| (c.as_slice(), s))).await?;
    if let Some((_, _, account)) = &replaced {
        db::record_check(&mut *tx, id, &json!({ "ok": true, "account": account })).await?;
    }
    audit::record(&mut *tx, &p, Entry::new(Some(org), "integration.update", "integration", id).decision(d).details(json!({ "name": i.name, "newCredentials": replaced.is_some() }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(db::get(&state.db, org, id).await?.into()))
}

#[utoipa::path(post, path = "/api/orgs/{org}/integrations/{integration}/check", tag = "integrations", params(("org" = Uuid, Path), ("integration" = Uuid, Path)), responses((status = 200, body = IntegrationDto)))]
pub async fn check(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>) -> ApiResult<Json<IntegrationDto>> {
    rbac::require(&state, &p, &org_target(org), P::IntegrationManage).await?;
    let (provider, cipher) = db::secret(&state.db, org, id).await?;
    let fields: Map<String, Value> = serde_json::from_slice(&key(&state)?.decrypt(&cipher).map_err(|e| ApiError::Internal(e.into()))?).map_err(|e| ApiError::Internal(e.into()))?;
    let result = match cloud::verify(&provider, &fields, &state.config.provider_apis).await {
        Result::Ok(account) => json!({ "ok": true, "account": account }),
        Err(error) => json!({ "ok": false, "error": error }),
    };
    db::record_check(&state.db, id, &result).await?;
    Ok(Json(db::get(&state.db, org, id).await?.into()))
}

#[utoipa::path(delete, path = "/api/orgs/{org}/integrations/{integration}", tag = "integrations", params(("org" = Uuid, Path), ("integration" = Uuid, Path)), responses((status = 200, body = Ok)))]
pub async fn delete(State(state): State<AppState>, p: Principal, Path((org, id)): Path<(Uuid, Uuid)>) -> ApiResult<Json<Ok>> {
    let d = rbac::require(&state, &p, &org_target(org), P::IntegrationManage).await?;
    let mut tx = state.db.begin().await.map_err(|e| ApiError::Internal(e.into()))?;
    let i = db::get(&mut *tx, org, id).await?;
    db::delete(&mut *tx, org, id).await?;
    audit::record(&mut *tx, &p, Entry::new(Some(org), "integration.delete", "integration", id).decision(d).details(json!({ "provider": i.provider, "name": i.name }))).await?;
    tx.commit().await.map_err(|e| ApiError::Internal(e.into()))?;
    Ok(Json(OK))
}
