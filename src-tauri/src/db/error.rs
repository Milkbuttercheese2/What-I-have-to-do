use thiserror::Error;

#[derive(Debug, Error)]
pub enum DbError {
    #[error("database error: {0}")]
    Sqlite(#[from] rusqlite::Error),
    #[error("migration error: {0}")]
    Migration(#[from] rusqlite_migration::Error),
    #[error("io error: {0}")]
    Io(#[from] std::io::Error),
    #[error("json error: {0}")]
    Json(#[from] serde_json::Error),
    /// 더 새 버전의 앱이 만든 DB(스키마 번호가 이 버전이 아는 것보다 크다). 손상이 아니므로 복구(백업으로 덮기)하지 않는다.
    #[error("이 데이터는 더 새 버전의 '뭐하려 했더라'가 만든 것이라 이 버전으로는 열 수 없습니다(데이터 버전 {db}, 이 앱 {app}).\n데이터를 지키기 위해 아무것도 바꾸지 않았습니다 — 가장 새 버전의 앱으로 실행하세요.\n({path})")]
    TooNew { db: i64, app: i64, path: String },
}

pub type DbResult<T> = Result<T, DbError>;
