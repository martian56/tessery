use crate::audit::{self, Entry};
use crate::auth::{Principal, session};
use crate::error::{ApiError, ApiResult};
use crate::routes::dto::{OrgDto, UserDto};
use crate::state::AppState;
use axum::Json;
use axum::extract::{Path, State};
use serde::{Deserialize, Serialize};
use serde_json::json;
use utoipa::ToSchema;
use uuid::Uuid;

#[utoipa::path(get, path = "/api/admin/users", tag = "admin", responses((status = 200, body = [UserDto])))]
pub async fn users(State(state): State<AppState>, p: Principal) -> ApiResult<Json<Vec<UserDto>>> {
    p.require_instance_admin()?;
    Ok(Json(
        tessery_db::users::list_all(&state.db)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UpdateUser {
    pub instance_admin: Option<bool>,
    pub disabled: Option<bool>,
}

#[utoipa::path(patch, path = "/api/admin/users/{user}", tag = "admin", params(("user" = Uuid, Path)), request_body = UpdateUser, responses((status = 200, body = UserDto)))]
pub async fn update_user(
    State(state): State<AppState>,
    p: Principal,
    Path(user): Path<Uuid>,
    Json(req): Json<UpdateUser>,
) -> ApiResult<Json<UserDto>> {
    p.require_instance_admin()?;
    let target = tessery_db::users::get(&state.db, user).await?;
    let removes_admin = (req.instance_admin == Some(false) || req.disabled == Some(true))
        && target.is_instance_admin
        && target.disabled_at.is_none();
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    if let Some(v) = req.instance_admin {
        tessery_db::users::set_instance_admin(&mut *tx, user, v).await?;
    }
    if let Some(v) = req.disabled {
        if v && user == p.user.id {
            return Err(ApiError::Conflict(
                "you cannot disable your own account".into(),
            ));
        }
        tessery_db::users::set_disabled(&mut *tx, user, v).await?;
    }
    if removes_admin && tessery_db::users::count_instance_admins(&mut *tx).await? == 0 {
        return Err(ApiError::Conflict(
            "the instance must keep at least one active administrator".into(),
        ));
    }
    audit::record(
        &mut *tx,
        &p,
        Entry::new(None, "admin.user_update", "user", user)
            .details(json!({ "instanceAdmin": req.instance_admin, "disabled": req.disabled })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    if req.disabled == Some(true) {
        let mut redis = state.redis.clone();
        session::destroy_all(&mut redis, user, None).await?;
    }
    Ok(Json(tessery_db::users::get(&state.db, user).await?.into()))
}

#[utoipa::path(get, path = "/api/admin/orgs", tag = "admin", responses((status = 200, body = [OrgDto])))]
pub async fn orgs(State(state): State<AppState>, p: Principal) -> ApiResult<Json<Vec<OrgDto>>> {
    p.require_instance_admin()?;
    Ok(Json(
        tessery_db::orgs::list_all(&state.db)
            .await?
            .into_iter()
            .map(Into::into)
            .collect(),
    ))
}

#[derive(Serialize, Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub allow_org_creation: bool,
    /// Days of container metrics to keep, 1 to 90.
    pub metrics_retention_days: i32,
    /// Install new releases automatically inside the daily window.
    pub auto_update: bool,
    /// Start of the automatic update window, as a UTC hour from 0 to 23.
    pub auto_update_from: i16,
    /// End of the window, a UTC hour from 0 to 23, not included. Before the start, the window runs past midnight.
    pub auto_update_to: i16,
}

/// Fields left out keep their stored value.
#[derive(Deserialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdate {
    pub allow_org_creation: Option<bool>,
    pub metrics_retention_days: Option<i32>,
    pub auto_update: Option<bool>,
    pub auto_update_from: Option<i16>,
    pub auto_update_to: Option<i16>,
}

#[utoipa::path(get, path = "/api/admin/settings", tag = "admin", responses((status = 200, body = Settings)))]
pub async fn get_settings(
    State(state): State<AppState>,
    p: Principal,
) -> ApiResult<Json<Settings>> {
    p.require_instance_admin()?;
    let s = tessery_db::settings::get(&state.db).await?;
    let auto = tessery_db::settings::auto_update(&state.db).await?;
    Ok(Json(Settings {
        allow_org_creation: s.allow_org_creation,
        metrics_retention_days: tessery_db::metrics::retention_days(&state.db).await?,
        auto_update: auto.enabled,
        auto_update_from: auto.from_hour,
        auto_update_to: auto.to_hour,
    }))
}

#[utoipa::path(put, path = "/api/admin/settings", tag = "admin", request_body = SettingsUpdate, responses((status = 200, body = Settings)))]
pub async fn put_settings(
    State(state): State<AppState>,
    p: Principal,
    Json(req): Json<SettingsUpdate>,
) -> ApiResult<Json<Settings>> {
    p.require_instance_admin()?;
    if req.metrics_retention_days.is_some_and(|d| !(1..=90).contains(&d)) {
        return Err(ApiError::invalid("metricsRetentionDays", "use 1 to 90 days"));
    }
    for (field, hour) in [("autoUpdateFrom", req.auto_update_from), ("autoUpdateTo", req.auto_update_to)] {
        if hour.is_some_and(|h| !(0..=23).contains(&h)) {
            return Err(ApiError::invalid(field, "use an hour from 0 to 23"));
        }
    }
    if req.auto_update == Some(true) && !state.config.updater.enabled() {
        return Err(ApiError::Conflict(tessery_update::UpdateError::Disabled.to_string()));
    }
    let mut tx = state.db.begin().await.map_err(tessery_db::DbError::from)?;
    if let Some(allow) = req.allow_org_creation {
        tessery_db::settings::set_allow_org_creation(&mut *tx, allow).await?;
    }
    if let Some(days) = req.metrics_retention_days {
        tessery_db::metrics::set_retention_days(&mut *tx, days).await?;
    }
    if req.auto_update.is_some() || req.auto_update_from.is_some() || req.auto_update_to.is_some() {
        tessery_db::settings::set_auto_update(&mut *tx, req.auto_update, req.auto_update_from, req.auto_update_to).await?;
    }
    audit::record(
        &mut *tx,
        &p,
        Entry::new(None, "admin.settings_update", "instance", "instance")
            .details(json!({ "allowOrgCreation": req.allow_org_creation, "metricsRetentionDays": req.metrics_retention_days, "autoUpdate": req.auto_update, "autoUpdateFrom": req.auto_update_from, "autoUpdateTo": req.auto_update_to })),
    )
    .await?;
    tx.commit().await.map_err(tessery_db::DbError::from)?;
    get_settings(State(state), p).await
}
