use serde::{Deserialize, Serialize};
use uuid::Uuid;

macro_rules! id_type {
    ($($name:ident),* $(,)?) => {$(
        #[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord, Serialize, Deserialize, utoipa::ToSchema)]
        #[serde(transparent)]
        #[schema(value_type = String, format = Uuid)]
        pub struct $name(pub Uuid);

        impl $name {
            pub fn new() -> Self { Self(Uuid::now_v7()) }
        }
        impl Default for $name { fn default() -> Self { Self::new() } }
        impl std::fmt::Display for $name {
            fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result { self.0.fmt(f) }
        }
        impl From<Uuid> for $name { fn from(v: Uuid) -> Self { Self(v) } }
        impl From<$name> for Uuid { fn from(v: $name) -> Self { v.0 } }
        impl std::str::FromStr for $name {
            type Err = uuid::Error;
            fn from_str(s: &str) -> Result<Self, Self::Err> { Uuid::parse_str(s).map(Self) }
        }
    )*};
}

id_type!(UserId, OrgId, TeamId, ProjectId, RoleId, BindingId);
