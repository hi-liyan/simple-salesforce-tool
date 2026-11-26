use rusqlite::Connection;

use crate::error::AppError;

/// 应用 SQLite 写连接运行时 PRAGMA：统一保证外键、WAL、同步策略与忙碌超时。
pub fn apply_write_pragmas(connection: &Connection) -> Result<(), AppError> {
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

/// 应用 SQLite 只读连接运行时 PRAGMA：开启 query_only 与忙碌超时，避免阻塞写事务。
pub fn apply_read_pragmas(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        PRAGMA foreign_keys = ON;
        PRAGMA query_only = ON;
        PRAGMA temp_store = MEMORY;
        PRAGMA busy_timeout = 5000;
        "#,
    )?;
    Ok(())
}

/// 兼容旧入口：默认应用写连接 PRAGMA。
pub fn apply_pragmas(connection: &Connection) -> Result<(), AppError> {
    apply_write_pragmas(connection)
}
