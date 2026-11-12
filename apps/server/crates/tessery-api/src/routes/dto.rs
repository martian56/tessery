use serde::Serialize;
use time::OffsetDateTime;
use utoipa::ToSchema;
use uuid::Uuid;

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserDto {
    pub id: Uuid,
    pub email: String,
    pub name: String,
    pub instance_admin: bool,
    pub disabled: bool,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
    #[serde(with = "time::serde::rfc3339::option")]
    pub last_login_at: Option<OffsetDateTime>,
}

impl From<tessery_db::users::User> for UserDto {
    fn from(u: tessery_db::users::User) -> Self {
        Self {
            id: u.id,
            email: u.email,
            name: u.name,
            instance_admin: u.is_instance_admin,
            disabled: u.disabled_at.is_some(),
            created_at: u.created_at,
            last_login_at: u.last_login_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct OrgDto {
    pub id: Uuid,
    pub slug: String,
    pub name: String,
    #[serde(with = "time::serde::rfc3339")]
    pub created_at: OffsetDateTime,
}

impl From<tessery_db::orgs::Org> for OrgDto {
    fn from(o: tessery_db::orgs::Org) -> Self {
        Self {
            id: o.id,
            slug: o.slug,
            name: o.name,
            created_at: o.created_at,
        }
    }
}

#[derive(Serialize, ToSchema)]
pub struct Ok {
    pub ok: bool,
}

pub const OK: Ok = Ok { ok: true };

pub fn normalize_email(raw: &str) -> Result<String, crate::error::ApiError> {
    let e = raw.trim().to_lowercase();
    let valid = e.len() <= 254
        && e.split_once('@').is_some_and(|(local, domain)| {
            !local.is_empty()
                && domain.contains('.')
                && !domain.starts_with('.')
                && !domain.ends_with('.')
        });
    if valid {
        Result::Ok(e)
    } else {
        Err(crate::error::ApiError::invalid(
            "email",
            "is not a valid email address",
        ))
    }
}

pub fn clean_name(
    field: &'static str,
    raw: &str,
    max: usize,
) -> Result<String, crate::error::ApiError> {
    let s = raw.trim();
    if s.is_empty() || s.chars().count() > max {
        return Err(crate::error::ApiError::invalid(
            field,
            format!("must be 1 to {max} characters"),
        ));
    }
    Result::Ok(s.to_owned())
}

pub fn slug_or_from(
    field: &'static str,
    slug: Option<&str>,
    name: &str,
) -> Result<String, crate::error::ApiError> {
    let s = match slug {
        Some(s) if !s.trim().is_empty() => s.trim().to_owned(),
        _ => tessery_core::slug::slugify(name),
    };
    if tessery_core::slug::is_valid(&s) {
        Result::Ok(s)
    } else {
        Err(crate::error::ApiError::invalid(
            field,
            "use lowercase letters, digits and single dashes",
        ))
    }
}
