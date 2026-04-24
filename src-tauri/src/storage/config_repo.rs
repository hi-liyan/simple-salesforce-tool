use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;

/// 读取应用设置值；不存在时返回 `None`。
pub fn read_app_setting(connection: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let value = connection
        .query_row(
            "SELECT value_json FROM app_settings WHERE setting_key = ?1",
            [key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value)
}

/// 写入应用设置值。
pub fn write_app_setting(connection: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    connection.execute(
        "INSERT INTO app_settings (setting_key, value_json, scope, schema_version, updated_at)
         VALUES (?1, ?2, 'global', 2, ?3)
         ON CONFLICT(setting_key) DO UPDATE SET
           value_json = excluded.value_json,
           schema_version = excluded.schema_version,
           updated_at = excluded.updated_at",
        params![key, value, Utc::now().to_rfc3339()],
    )?;
    Ok(())
}

/// 删除应用设置值。
pub fn delete_app_setting(connection: &Connection, key: &str) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM app_settings WHERE setting_key = ?1",
        [key],
    )?;
    Ok(())
}
