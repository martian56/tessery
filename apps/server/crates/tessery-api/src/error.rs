use tessery_core::Permission;
use tessery_db::DbError;
use axum::Json;
use axum::http::StatusCode;
use axum::response::{IntoResponse, Response};
use serde::Serialize;

#[derive(Debug, thiserror::Error)]
pub enum ApiError {
    #[error("{0}")]
    BadRequest(String),
    #[error("{field}: {message}")]
    Invalid {
        field: &'static str,
        message: String,
    },
    #[error("authentication required")]
    Unauthenticated,
    #[error("invalid email or password")]
    InvalidCredentials,
    #[error("missing permission {0}")]
    Forbidden(Permission),
    #[error("{0}")]
    ForbiddenMsg(String),
    #[error("not found")]
    NotFound,
    #[error("{0}")]
    Conflict(String),
    #[error("the project was changed by someone else; reload and try again")]
    StaleVersion,
    #[error("too many attempts, try again later")]
    RateLimited,
    #[error(transparent)]
    Internal(#[from] anyhow::Error),
}

pub type ApiResult<T> = Result<T, ApiError>;

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorBody {
    pub error: ErrorDetail,
}

#[derive(Serialize, utoipa::ToSchema)]
pub struct ErrorDetail {
    /// Stable machine-readable code, e.g. `forbidden` or `stale_version`.
    pub code: &'static str,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub field: Option<&'static str>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub permission: Option<String>,
}

impl ApiError {
    pub fn invalid(field: &'static str, message: impl Into<String>) -> Self {
        Self::Invalid {
            field,
            message: message.into(),
        }
    }

    fn status_and_code(&self) -> (StatusCode, &'static str) {
        match self {
            ApiError::BadRequest(_) => (StatusCode::BAD_REQUEST, "bad_request"),
            ApiError::Invalid { .. } => (StatusCode::UNPROCESSABLE_ENTITY, "invalid"),
            ApiError::Unauthenticated => (StatusCode::UNAUTHORIZED, "unauthenticated"),
            ApiError::InvalidCredentials => (StatusCode::UNAUTHORIZED, "invalid_credentials"),
            ApiError::Forbidden(_) | ApiError::ForbiddenMsg(_) => {
                (StatusCode::FORBIDDEN, "forbidden")
            }
            ApiError::NotFound => (StatusCode::NOT_FOUND, "not_found"),
            ApiError::Conflict(_) => (StatusCode::CONFLICT, "conflict"),
            ApiError::StaleVersion => (StatusCode::CONFLICT, "stale_version"),
            ApiError::RateLimited => (StatusCode::TOO_MANY_REQUESTS, "rate_limited"),
            ApiError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, "internal"),
        }
    }
}

impl IntoResponse for ApiError {
    fn into_response(self) -> Response {
        let (status, code) = self.status_and_code();
        let message = match &self {
            ApiError::Internal(e) => {
                tracing::error!(error = ?e, "internal error");
                "internal server error".to_owned()
            }
            other => other.to_string(),
        };
        let body = ErrorBody {
            error: ErrorDetail {
                code,
                message,
                field: if let ApiError::Invalid { field, .. } = &self {
                    Some(field)
                } else {
                    None
                },
                permission: if let ApiError::Forbidden(p) = &self {
                    Some(p.as_str().to_owned())
                } else {
                    None
                },
            },
        };
        (status, Json(body)).into_response()
    }
}

impl From<DbError> for ApiError {
    fn from(e: DbError) -> Self {
        match e {
            DbError::NotFound => ApiError::NotFound,
            DbError::StaleVersion => ApiError::StaleVersion,
            DbError::Conflict(c) => ApiError::Conflict(conflict_message(&c)),
            DbError::Sqlx(e) => ApiError::Internal(e.into()),
        }
    }
}

impl From<redis::RedisError> for ApiError {
    fn from(e: redis::RedisError) -> Self {
        ApiError::Internal(e.into())
    }
}

impl From<tessery_mq::MqError> for ApiError {
    fn from(e: tessery_mq::MqError) -> Self {
        ApiError::Internal(e.into())
    }
}

fn conflict_message(constraint: &str) -> String {
    match constraint {
        "users_email_key" => "a user with this email already exists".into(),
        "organizations_slug_key" => "an organization with this slug already exists".into(),
        "teams_org_id_slug_key" => "a team with this slug already exists".into(),
        "roles_org_key" => "a role with this key already exists".into(),
        "projects_org_id_slug_key" => "a project with this slug already exists".into(),
        "role_bindings_unique" => "this access grant already exists".into(),
        "team_members_org_id_user_id_fkey" => {
            "the user is not a member of this organization".into()
        }
        other => format!("conflicts with existing data ({other})"),
    }
}
