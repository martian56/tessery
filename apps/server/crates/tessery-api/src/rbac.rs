use crate::audit::{self, Entry};
use crate::auth::Principal;
use crate::error::{ApiError, ApiResult};
use crate::state::AppState;
use tessery_core::{
    BuiltinRole, Decision, Grant, GrantScope, OrgId, Permission, PermissionSet, ProjectId, Target,
    TeamId, decide, effective_permissions,
};
use tessery_db::bindings::Binding;
use tessery_db::types::ScopeKind;
use serde_json::json;
use time::OffsetDateTime;
use uuid::Uuid;

pub fn role_permissions(builtin: bool, key: &str, stored: &[String]) -> PermissionSet {
    if builtin {
        BuiltinRole::by_key(key)
            .map(|r| r.permissions())
            .unwrap_or_default()
    } else {
        PermissionSet::from_keys(stored)
    }
}

pub fn grant_from(b: &Binding) -> Option<Grant> {
    let scope = match (b.scope_kind, b.scope_id, &b.env_key) {
        (ScopeKind::Org, _, _) => GrantScope::Org,
        (ScopeKind::Team, Some(id), _) => GrantScope::Team { team: TeamId(id) },
        (ScopeKind::Project, Some(id), _) => GrantScope::Project {
            project: ProjectId(id),
        },
        (ScopeKind::Environment, Some(id), Some(env)) => GrantScope::Environment {
            project: ProjectId(id),
            env: env.clone(),
        },
        _ => return None,
    };
    Some(Grant {
        permissions: role_permissions(b.role_is_builtin, &b.role_key, &b.role_permissions),
        scope,
        expires_at: b.expires_at,
    })
}

pub async fn effective(
    state: &AppState,
    user_id: Uuid,
    target: &Target,
) -> ApiResult<PermissionSet> {
    let bindings = tessery_db::bindings::for_user(&state.db, target.org().0, user_id).await?;
    let grants: Vec<Grant> = bindings.iter().filter_map(grant_from).collect();
    Ok(effective_permissions(
        &grants,
        target,
        OffsetDateTime::now_utc(),
    ))
}

pub async fn require(
    state: &AppState,
    p: &Principal,
    target: &Target,
    perm: Permission,
) -> ApiResult<Decision> {
    let mut eff = effective(state, p.user.id, target).await?;
    if let Some(scope) = &p.scope {
        if scope.project.is_some_and(|only| target_project(target) != Some(only)) {
            eff = Default::default();
        } else if scope.permissions.as_ref().is_some_and(|ps| !ps.contains(&perm)) {
            if eff.is_empty() && !p.user.is_instance_admin {
                return Err(ApiError::NotFound);
            }
            return Err(ApiError::ForbiddenMsg(format!("this API token does not allow {}", perm.as_str())));
        }
    }
    match decide(p.is_instance_admin(), &eff, perm) {
        Decision::Denied => {
            let entry = Entry::new(
                Some(target.org().0),
                perm.as_str(),
                "authorization",
                describe(target),
            )
            .decision(Decision::Denied);
            if let Err(e) = audit::record(&state.db, p, entry).await {
                tracing::warn!(error = %e, "failed to audit a denied request");
            }
            if eff.is_empty() {
                Err(ApiError::NotFound)
            } else {
                Err(ApiError::Forbidden(perm))
            }
        }
        d => Ok(d),
    }
}

pub async fn ensure_can_grant(
    state: &AppState,
    p: &Principal,
    target: &Target,
    granted: &PermissionSet,
) -> ApiResult<()> {
    if p.is_instance_admin() {
        return Ok(());
    }
    let mine = effective(state, p.user.id, target).await?;
    let token_allows = |perm: &Permission| p.scope.as_ref().and_then(|s| s.permissions.as_ref()).is_none_or(|ps| ps.contains(perm));
    if let Some(missing) = granted.iter().find(|perm| !mine.contains(*perm) || !token_allows(perm)) {
        return Err(ApiError::ForbiddenMsg(format!(
            "you cannot grant `{missing}` because you do not have it"
        )));
    }
    Ok(())
}

fn target_project(t: &Target) -> Option<Uuid> {
    match t {
        Target::Project { project, .. } | Target::Environment { project, .. } => Some(project.0),
        _ => None,
    }
}

pub async fn project_target(state: &AppState, project: Uuid) -> ApiResult<Target> {
    let (org, team) = tessery_db::projects::locate(&state.db, project).await?;
    Ok(Target::Project {
        org: OrgId(org),
        team: team.map(TeamId),
        project: ProjectId(project),
    })
}

pub fn org_target(org: Uuid) -> Target {
    Target::Org(OrgId(org))
}

pub fn decision_details(d: Decision) -> serde_json::Value {
    if d == Decision::Bypassed {
        json!({ "bypass": "instance_admin" })
    } else {
        json!({})
    }
}

fn describe(t: &Target) -> String {
    match t {
        Target::Org(o) => format!("org:{o}"),
        Target::Team { team, .. } => format!("team:{team}"),
        Target::Project { project, .. } => format!("project:{project}"),
        Target::Environment { project, env, .. } => format!("project:{project}/env:{env}"),
    }
}
