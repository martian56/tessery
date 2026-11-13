use serde::{Deserialize, Serialize};
use std::collections::BTreeSet;
use std::fmt;
use std::str::FromStr;

macro_rules! permissions {
    ($( $variant:ident = $key:literal, $group:literal, $desc:literal; )*) => {
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
        pub enum Permission { $($variant),* }

        impl Permission {
            pub const ALL: &'static [Permission] = &[$(Permission::$variant),*];
            pub fn as_str(self) -> &'static str { match self { $(Permission::$variant => $key),* } }
            pub fn group(self) -> &'static str { match self { $(Permission::$variant => $group),* } }
            pub fn description(self) -> &'static str { match self { $(Permission::$variant => $desc),* } }
        }

        impl FromStr for Permission {
            type Err = UnknownPermission;
            fn from_str(s: &str) -> Result<Self, Self::Err> {
                match s { $($key => Ok(Permission::$variant),)* other => Err(UnknownPermission(other.to_owned())) }
            }
        }
    };
}

permissions! {
    OrgRead          = "org:read",          "Organization", "View the organization";
    OrgManage        = "org:manage",        "Organization", "Rename and configure the organization";
    OrgDelete        = "org:delete",        "Organization", "Delete the organization";
    MemberRead       = "member:read",       "Members",      "List members";
    MemberInvite     = "member:invite",     "Members",      "Add members";
    MemberRemove     = "member:remove",     "Members",      "Remove members";
    TeamRead         = "team:read",         "Teams",        "View teams";
    TeamManage       = "team:manage",       "Teams",        "Create, edit and delete teams and their membership";
    RoleRead         = "role:read",         "Access",       "View roles and access grants";
    RoleManage       = "role:manage",       "Access",       "Create custom roles and grant or revoke access";
    ProjectRead      = "project:read",      "Projects",     "View projects and designs";
    ProjectCreate    = "project:create",    "Projects",     "Create projects";
    ProjectEdit      = "project:edit",      "Projects",     "Edit designs, APIs, schemas and pages";
    ProjectDelete    = "project:delete",    "Projects",     "Delete projects";
    EnvManage        = "env:manage",        "Environments", "Create and configure environments";
    DeploymentRead   = "deployment:read",   "Deployments",  "View releases and logs";
    DeploymentRun    = "deployment:run",    "Deployments",  "Start deployments and rollbacks";
    DeploymentApprove= "deployment:approve","Deployments",  "Approve deployments that need approval";
    DataRead         = "data:read",         "Data",         "Browse tables and logs of running environments";
    DataWrite        = "data:write",        "Data",         "Run SQL that changes data in running environments";
    SecretRead       = "secret:read",       "Secrets",      "Read secret values";
    SecretWrite      = "secret:write",      "Secrets",      "Create and change secrets";
    AuditRead        = "audit:read",        "Audit",        "View and export the audit log";
    TokenManage      = "token:manage",      "Access",       "Create and revoke API tokens for agents and CI";
    ServerRead       = "server:read",       "Servers",      "See servers and pick them for environments";
    ServerManage     = "server:manage",     "Servers",      "Add, check, change and remove servers";
}

impl fmt::Display for Permission {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str(self.as_str())
    }
}

impl Serialize for Permission {
    fn serialize<S: serde::Serializer>(&self, s: S) -> Result<S::Ok, S::Error> {
        s.serialize_str(self.as_str())
    }
}
impl<'de> Deserialize<'de> for Permission {
    fn deserialize<D: serde::Deserializer<'de>>(d: D) -> Result<Self, D::Error> {
        let s = String::deserialize(d)?;
        s.parse().map_err(serde::de::Error::custom)
    }
}

#[derive(Debug, Clone, thiserror::Error)]
#[error("unknown permission `{0}`")]
pub struct UnknownPermission(pub String);

#[derive(Debug, Clone, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct PermissionSet(BTreeSet<Permission>);

impl PermissionSet {
    pub fn empty() -> Self {
        Self::default()
    }
    pub fn all() -> Self {
        Self(Permission::ALL.iter().copied().collect())
    }
    pub fn contains(&self, p: Permission) -> bool {
        self.0.contains(&p)
    }
    pub fn insert(&mut self, p: Permission) {
        self.0.insert(p);
    }
    pub fn extend(&mut self, other: &PermissionSet) {
        self.0.extend(other.0.iter().copied());
    }
    pub fn iter(&self) -> impl Iterator<Item = Permission> + '_ {
        self.0.iter().copied()
    }
    pub fn len(&self) -> usize {
        self.0.len()
    }
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
    pub fn to_strings(&self) -> Vec<String> {
        self.0.iter().map(|p| p.as_str().to_owned()).collect()
    }

    pub fn from_keys<I: IntoIterator<Item = S>, S: AsRef<str>>(keys: I) -> Self {
        Self(
            keys.into_iter()
                .filter_map(|k| k.as_ref().parse().ok())
                .collect(),
        )
    }
}

impl FromIterator<Permission> for PermissionSet {
    fn from_iter<T: IntoIterator<Item = Permission>>(iter: T) -> Self {
        Self(iter.into_iter().collect())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keys_round_trip() {
        for p in Permission::ALL {
            assert_eq!(p.as_str().parse::<Permission>().unwrap(), *p);
        }
    }

    #[test]
    fn keys_are_unique() {
        let keys: BTreeSet<_> = Permission::ALL.iter().map(|p| p.as_str()).collect();
        assert_eq!(keys.len(), Permission::ALL.len());
    }

    #[test]
    fn from_keys_skips_unknown() {
        let s = PermissionSet::from_keys(["project:read", "gone:forever"]);
        assert_eq!(s.len(), 1);
        assert!(s.contains(Permission::ProjectRead));
    }
}
