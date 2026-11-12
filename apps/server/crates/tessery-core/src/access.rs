use crate::ids::{OrgId, ProjectId, TeamId};
use crate::permission::{Permission, PermissionSet};
use serde::{Deserialize, Serialize};
use time::OffsetDateTime;

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum GrantScope {
    Org,
    Team { team: TeamId },
    Project { project: ProjectId },
    Environment { project: ProjectId, env: String },
}

#[derive(Debug, Clone)]
pub struct Grant {
    pub permissions: PermissionSet,
    pub scope: GrantScope,
    pub expires_at: Option<OffsetDateTime>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Target {
    Org(OrgId),
    Team {
        org: OrgId,
        team: TeamId,
    },
    Project {
        org: OrgId,
        team: Option<TeamId>,
        project: ProjectId,
    },
    Environment {
        org: OrgId,
        team: Option<TeamId>,
        project: ProjectId,
        env: String,
    },
}

impl Target {
    pub fn org(&self) -> OrgId {
        match self {
            Target::Org(o)
            | Target::Team { org: o, .. }
            | Target::Project { org: o, .. }
            | Target::Environment { org: o, .. } => *o,
        }
    }
}

impl GrantScope {
    pub fn covers(&self, target: &Target) -> bool {
        match (self, target) {
            (GrantScope::Org, _) => true,
            (GrantScope::Team { team }, Target::Team { team: t, .. }) => team == t,
            (
                GrantScope::Team { team },
                Target::Project { team: Some(t), .. } | Target::Environment { team: Some(t), .. },
            ) => team == t,
            (
                GrantScope::Project { project },
                Target::Project { project: p, .. } | Target::Environment { project: p, .. },
            ) => project == p,
            (
                GrantScope::Environment { project, env },
                Target::Environment {
                    project: p, env: e, ..
                },
            ) => project == p && env == e,
            _ => false,
        }
    }
}

pub fn effective_permissions<'a>(
    grants: impl IntoIterator<Item = &'a Grant>,
    target: &Target,
    now: OffsetDateTime,
) -> PermissionSet {
    let mut out = PermissionSet::empty();
    for g in grants {
        if g.expires_at.is_some_and(|e| e <= now) || !g.scope.covers(target) {
            continue;
        }
        out.extend(&g.permissions);
    }
    out
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Decision {
    Allowed,
    Denied,
    Bypassed,
}

pub fn decide(instance_admin: bool, effective: &PermissionSet, perm: Permission) -> Decision {
    if effective.contains(perm) {
        Decision::Allowed
    } else if instance_admin {
        Decision::Bypassed
    } else {
        Decision::Denied
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::role::{DEPLOYER, EDITOR, VIEWER};
    use time::Duration;

    fn grant(role: crate::role::BuiltinRole, scope: GrantScope) -> Grant {
        Grant {
            permissions: role.permissions(),
            scope,
            expires_at: None,
        }
    }

    fn ids() -> (OrgId, TeamId, TeamId, ProjectId, ProjectId) {
        (
            OrgId::new(),
            TeamId::new(),
            TeamId::new(),
            ProjectId::new(),
            ProjectId::new(),
        )
    }

    #[test]
    fn org_grant_covers_everything_in_org() {
        let (o, t, _, p, _) = ids();
        let g = [grant(VIEWER, GrantScope::Org)];
        let now = OffsetDateTime::now_utc();
        for target in [
            Target::Org(o),
            Target::Team { org: o, team: t },
            Target::Project {
                org: o,
                team: None,
                project: p,
            },
            Target::Environment {
                org: o,
                team: Some(t),
                project: p,
                env: "prod".into(),
            },
        ] {
            assert!(effective_permissions(&g, &target, now).contains(Permission::ProjectRead));
        }
    }

    #[test]
    fn team_grant_covers_only_that_teams_projects() {
        let (o, t1, t2, p1, p2) = ids();
        let g = [grant(EDITOR, GrantScope::Team { team: t1 })];
        let now = OffsetDateTime::now_utc();
        assert!(
            effective_permissions(
                &g,
                &Target::Project {
                    org: o,
                    team: Some(t1),
                    project: p1
                },
                now
            )
            .contains(Permission::ProjectEdit)
        );
        assert!(
            effective_permissions(
                &g,
                &Target::Project {
                    org: o,
                    team: Some(t2),
                    project: p2
                },
                now
            )
            .is_empty()
        );
        assert!(
            effective_permissions(
                &g,
                &Target::Project {
                    org: o,
                    team: None,
                    project: p2
                },
                now
            )
            .is_empty()
        );
        assert!(effective_permissions(&g, &Target::Org(o), now).is_empty());
    }

    #[test]
    fn environment_grant_is_limited_to_that_environment() {
        let (o, _, _, p, _) = ids();
        let g = [grant(
            DEPLOYER,
            GrantScope::Environment {
                project: p,
                env: "staging".into(),
            },
        )];
        let now = OffsetDateTime::now_utc();
        let staging = Target::Environment {
            org: o,
            team: None,
            project: p,
            env: "staging".into(),
        };
        let prod = Target::Environment {
            org: o,
            team: None,
            project: p,
            env: "prod".into(),
        };
        assert!(effective_permissions(&g, &staging, now).contains(Permission::DeploymentRun));
        assert!(!effective_permissions(&g, &prod, now).contains(Permission::DeploymentRun));
        assert!(
            !effective_permissions(
                &g,
                &Target::Project {
                    org: o,
                    team: None,
                    project: p
                },
                now
            )
            .contains(Permission::DeploymentRun)
        );
    }

    #[test]
    fn expired_grants_do_not_apply() {
        let (o, _, _, _, _) = ids();
        let now = OffsetDateTime::now_utc();
        let g = [Grant {
            permissions: VIEWER.permissions(),
            scope: GrantScope::Org,
            expires_at: Some(now - Duration::minutes(1)),
        }];
        assert!(effective_permissions(&g, &Target::Org(o), now).is_empty());
        let g = [Grant {
            permissions: VIEWER.permissions(),
            scope: GrantScope::Org,
            expires_at: Some(now + Duration::minutes(1)),
        }];
        assert!(!effective_permissions(&g, &Target::Org(o), now).is_empty());
    }

    #[test]
    fn instance_admin_bypasses_but_is_distinguished() {
        let none = PermissionSet::empty();
        assert_eq!(
            decide(true, &none, Permission::OrgDelete),
            Decision::Bypassed
        );
        assert_eq!(
            decide(false, &none, Permission::OrgDelete),
            Decision::Denied
        );
        assert_eq!(
            decide(true, &PermissionSet::all(), Permission::OrgDelete),
            Decision::Allowed
        );
    }
}
