use crate::permission::{Permission as P, PermissionSet};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BuiltinRole {
    pub key: &'static str,
    pub name: &'static str,
    pub description: &'static str,
}

pub const OWNER: BuiltinRole = BuiltinRole {
    key: "owner",
    name: "Owner",
    description: "Full control, including deleting the organization.",
};
pub const ADMIN: BuiltinRole = BuiltinRole {
    key: "admin",
    name: "Admin",
    description: "Manage members, teams, access, projects and deployments.",
};
pub const EDITOR: BuiltinRole = BuiltinRole {
    key: "editor",
    name: "Editor",
    description: "Create and edit projects. Cannot deploy or manage access.",
};
pub const DEPLOYER: BuiltinRole = BuiltinRole {
    key: "deployer",
    name: "Deployer",
    description: "View projects and run deployments.",
};
pub const VIEWER: BuiltinRole = BuiltinRole {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access.",
};

pub const BUILTIN_ROLES: &[BuiltinRole] = &[OWNER, ADMIN, EDITOR, DEPLOYER, VIEWER];

impl BuiltinRole {
    pub fn by_key(key: &str) -> Option<BuiltinRole> {
        BUILTIN_ROLES.iter().copied().find(|r| r.key == key)
    }

    pub fn permissions(&self) -> PermissionSet {
        let read: &[P] = &[
            P::OrgRead,
            P::MemberRead,
            P::TeamRead,
            P::RoleRead,
            P::ProjectRead,
            P::DeploymentRead,
            P::ServerRead,
        ];
        let set: Vec<P> = match self.key {
            "owner" => P::ALL.to_vec(),
            "admin" => P::ALL
                .iter()
                .copied()
                .filter(|p| *p != P::OrgDelete)
                .collect(),
            "editor" => [read, &[P::ProjectCreate, P::ProjectEdit, P::EnvManage, P::DataRead]].concat(),
            "deployer" => [read, &[P::DeploymentRun, P::DataRead]].concat(),
            "viewer" => read.to_vec(),
            _ => vec![],
        };
        set.into_iter().collect()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn hierarchy_is_monotonic() {
        let viewer = VIEWER.permissions();
        for r in [EDITOR, DEPLOYER, ADMIN, OWNER] {
            assert!(
                viewer.iter().all(|p| r.permissions().contains(p)),
                "{} should include all viewer permissions",
                r.key
            );
        }
        assert!(!ADMIN.permissions().contains(P::OrgDelete));
        assert_eq!(OWNER.permissions(), PermissionSet::all());
    }

    #[test]
    fn editors_cannot_deploy_or_manage_access() {
        let e = EDITOR.permissions();
        assert!(!e.contains(P::DeploymentRun));
        assert!(!e.contains(P::RoleManage));
    }
}
