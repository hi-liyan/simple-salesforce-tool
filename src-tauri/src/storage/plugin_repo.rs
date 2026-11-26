use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::error::AppError;

/// 插件持久化键值记录。
#[derive(Debug, Clone)]
#[allow(dead_code)]
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

/// 已安装的外部插件包持久化记录。
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPluginRecord {
    /// 插件唯一标识（如 com.example.sql-visualizer）。
    pub plugin_id: String,
    /// 插件显示名称。
    pub name: String,
    /// 插件版本号（SemVer）。
    pub version: String,
    /// 声明兼容的宿主 SDK 版本。
    pub api_version: String,
    /// 插件描述。
    pub description: String,
    /// 插件分类。
    pub category: String,
    /// 完整 `manifest.json` 原文。
    pub manifest_json: String,
    /// 解压安装目录绝对路径。
    pub install_dir: String,
    /// 是否启用。
    pub enabled: bool,
    /// 用户批准的权限 JSON 数组。
    pub granted_permissions: String,
    /// 插件包 SHA-256 校验摘要。
    pub package_sha256: String,
    /// 首次安装时间（RFC3339）。
    pub installed_at: String,
    /// 最近更新时间（RFC3339）。
    pub updated_at: String,
}

/// 查询全部已安装外部插件记录。
pub fn list_installed_plugins(
    connection: &Connection,
) -> Result<Vec<InstalledPluginRecord>, AppError> {
    let mut stmt = connection.prepare(
        "SELECT plugin_id, name, version, api_version, description, category, manifest_json,
                install_dir, enabled, granted_permissions, package_sha256, installed_at, updated_at
         FROM installed_plugins
         ORDER BY installed_at DESC, plugin_id ASC",
    )?;
    let rows = stmt.query_map([], |row| {
        Ok(InstalledPluginRecord {
            plugin_id: row.get(0)?,
            name: row.get(1)?,
            version: row.get(2)?,
            api_version: row.get(3)?,
            description: row.get(4)?,
            category: row.get(5)?,
            manifest_json: row.get(6)?,
            install_dir: row.get(7)?,
            enabled: row.get::<_, i64>(8)? != 0,
            granted_permissions: row.get(9)?,
            package_sha256: row.get(10)?,
            installed_at: row.get(11)?,
            updated_at: row.get(12)?,
        })
    })?;
    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

/// 按 `plugin_id` 查询单个已安装外部插件。
pub fn get_installed_plugin(
    connection: &Connection,
    plugin_id: &str,
) -> Result<Option<InstalledPluginRecord>, AppError> {
    let item = connection
        .query_row(
            "SELECT plugin_id, name, version, api_version, description, category, manifest_json,
                    install_dir, enabled, granted_permissions, package_sha256, installed_at, updated_at
             FROM installed_plugins
             WHERE plugin_id = ?1",
            params![plugin_id],
            |row| {
                Ok(InstalledPluginRecord {
                    plugin_id: row.get(0)?,
                    name: row.get(1)?,
                    version: row.get(2)?,
                    api_version: row.get(3)?,
                    description: row.get(4)?,
                    category: row.get(5)?,
                    manifest_json: row.get(6)?,
                    install_dir: row.get(7)?,
                    enabled: row.get::<_, i64>(8)? != 0,
                    granted_permissions: row.get(9)?,
                    package_sha256: row.get(10)?,
                    installed_at: row.get(11)?,
                    updated_at: row.get(12)?,
                })
            },
        )
        .optional()?;
    Ok(item)
}

/// 新增或升级外部插件安装记录。
pub fn upsert_installed_plugin(
    tx: &Transaction<'_>,
    record: &InstalledPluginRecord,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO installed_plugins (
            plugin_id, name, version, api_version, description, category, manifest_json,
            install_dir, enabled, granted_permissions, package_sha256, installed_at, updated_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(plugin_id) DO UPDATE SET
            name = excluded.name,
            version = excluded.version,
            api_version = excluded.api_version,
            description = excluded.description,
            category = excluded.category,
            manifest_json = excluded.manifest_json,
            install_dir = excluded.install_dir,
            enabled = excluded.enabled,
            granted_permissions = excluded.granted_permissions,
            package_sha256 = excluded.package_sha256,
            updated_at = excluded.updated_at",
        params![
            record.plugin_id,
            record.name,
            record.version,
            record.api_version,
            record.description,
            record.category,
            record.manifest_json,
            record.install_dir,
            if record.enabled { 1i64 } else { 0i64 },
            record.granted_permissions,
            record.package_sha256,
            record.installed_at,
            record.updated_at,
        ],
    )?;
    Ok(())
}

/// 切换已安装外部插件的启用状态。
pub fn set_installed_plugin_enabled(
    tx: &Transaction<'_>,
    plugin_id: &str,
    enabled: bool,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "UPDATE installed_plugins SET enabled = ?2, updated_at = ?3 WHERE plugin_id = ?1",
        params![plugin_id, if enabled { 1i64 } else { 0i64 }, now],
    )?;
    Ok(())
}

/// 卸载并清理外部插件及其持久化 KV 数据。
pub fn delete_installed_plugin(tx: &Transaction<'_>, plugin_id: &str) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM installed_plugins WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
    tx.execute(
        "DELETE FROM plugin_kv_store WHERE plugin_id = ?1",
        params![plugin_id],
    )?;
    Ok(())
}

/// 列出指定插件的全部键值项。
#[allow(dead_code)]
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
