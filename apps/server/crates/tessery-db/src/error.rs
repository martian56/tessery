#[derive(Debug, thiserror::Error)]
pub enum DbError {
    #[error("not found")]
    NotFound,
    #[error("conflict on {0}")]
    Conflict(String),
    #[error("the record was changed by someone else")]
    StaleVersion,
    #[error(transparent)]
    Sqlx(sqlx::Error),
}

pub type DbResult<T> = Result<T, DbError>;

impl From<sqlx::Error> for DbError {
    fn from(e: sqlx::Error) -> Self {
        match &e {
            sqlx::Error::RowNotFound => DbError::NotFound,
            sqlx::Error::Database(d) if d.is_unique_violation() || d.is_foreign_key_violation() => {
                DbError::Conflict(d.constraint().unwrap_or("unknown").to_owned())
            }
            _ => DbError::Sqlx(e),
        }
    }
}

pub(crate) trait OptionalExt<T> {
    fn or_not_found(self) -> DbResult<T>;
}

impl<T> OptionalExt<T> for Option<T> {
    fn or_not_found(self) -> DbResult<T> {
        self.ok_or(DbError::NotFound)
    }
}
