use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::error::AppError;

/// 插件持久化键值记录。
#[derive(Debug, Clone)]
pub struct PluginKvEntry {
    /// 插件唯一标识。
    pub plugin_id: String,
    /// 存储键名。
    pub storage_key: String,
    /// JSON 序列化的值。
    pub value_json: String,
    /// 最后更新时间（RFC3339）。
    pub updated_at: String,
}

/// 读取插件存储项；不存在时返回 `None`。
pub fn get_plugin_kv(
    connection: &Connection,
    plugin_id: &str,
    storage_key: &str,
) -> Result<Option<String>, AppError> {
    let value = connection
        .query_row(
            "SELECT value_json FROM plugin_kv_store WHERE plugin_id = ?1 AND storage_key = ?2",
            params![plugin_id, storage_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value)
}

/// 写入或更新插件存储项。
pub fn set_plugin_kv(
    tx: &Transaction<'_>,
    plugin_id: &str,
    storage_key: &str,
    value_json: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO plugin_kv_store (plugin_id, storage_key, value_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(plugin_id, storage_key) DO UPDATE SET
           value_json = excluded.value_json,
           updated_at = excluded.updated_at",
        params![plugin_id, storage_key, value_json, now],
    )?;
    Ok(())
}

/// 删除插件存储项。
pub fn delete_plugin_kv(
    tx: &Transaction<'_>,
    plugin_id: &str,
    storage_key: &str,
) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM plugin_kv_store WHERE plugin_id = ?1 AND storage_key = ?2",
        params![plugin_id, storage_key],
    )?;
    Ok(())
}

/// 列出指定插件的全部键值项。
pub fn list_plugin_kv(
    connection: &Connection,
    plugin_id: &str,
) -> Result<Vec<PluginKvEntry>, AppError> {
    let mut statement = connection.prepare(
        "SELECT plugin_id, storage_key, value_json, updated_at
         FROM plugin_kv_store
         WHERE plugin_id = ?1
         ORDER BY storage_key ASC",
    )?;
    let rows = statement.query_map([plugin_id], |row| {
        Ok(PluginKvEntry {
            plugin_id: row.get(0)?,
            storage_key: row.get(1)?,
            value_json: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}
