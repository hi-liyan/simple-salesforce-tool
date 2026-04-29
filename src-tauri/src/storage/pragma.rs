use rusqlite::Connection;

use crate::error::AppError;

/// 应用 SQLite 运行时 PRAGMA：统一保证外键、WAL 与基本可靠性。
pub fn apply_pragmas(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA journal_mode = WAL;
        PRAGMA synchronous = NORMAL;
        PRAGMA temp_store = MEMORY;
        PRAGMA busy_timeout = 5000;
        "#,
    )?;
    Ok(())
}
