use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    CachedObjects, SalesforceObject, SalesforceSource, SourceUpsertPayload, SystemLogEntry,
    SystemLogPage,
};

const OBJECT_CACHE_TTL_SECONDS: i64 = 3600;

/// 初始化数据库表结构。
pub fn init_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS salesforce_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            instance_url TEXT NOT NULL,
            access_token TEXT NOT NULL,
            api_version TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS object_metadata_cache (
            source_id TEXT PRIMARY KEY,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            FOREIGN KEY(source_id) REFERENCES salesforce_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS column_visibility_settings (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name),
            FOREIGN KEY(source_id) REFERENCES salesforce_sources(id) ON DELETE CASCADE
        );

        CREATE TABLE IF NOT EXISTS system_logs (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            created_at TEXT NOT NULL,
            level TEXT NOT NULL,
            category TEXT NOT NULL,
            action TEXT NOT NULL,
            source_id TEXT NULL,
            target TEXT NULL,
            success INTEGER NOT NULL,
            message TEXT NOT NULL,
            detail TEXT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_system_logs_created_at ON system_logs(created_at DESC);

        CREATE TABLE IF NOT EXISTS app_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        "#,
    )?;

    Ok(())
}

/// 读取应用配置项，不存在时返回 None。
pub fn read_app_setting(connection: &Connection, key: &str) -> Result<Option<String>, AppError> {
    let value: Option<String> = connection
        .query_row(
            "SELECT value FROM app_settings WHERE key = ?1",
            [key],
            |row| row.get(0),
        )
        .optional()?;
    Ok(value)
}

/// 写入应用配置项（UPSERT）。
pub fn write_app_setting(connection: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO app_settings (key, value, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at",
        params![key, value, now],
    )?;
    Ok(())
}

/// 删除应用配置项。
pub fn delete_app_setting(connection: &Connection, key: &str) -> Result<(), AppError> {
    connection.execute("DELETE FROM app_settings WHERE key = ?1", [key])?;
    Ok(())
}

/// 查询所有数据源，按更新时间倒序返回。
pub fn list_sources(connection: &Connection) -> Result<Vec<SalesforceSource>, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, name, instance_url, access_token, api_version, created_at, updated_at FROM salesforce_sources ORDER BY updated_at DESC",
    )?;

    let rows = statement.query_map([], |row| {
        Ok(SalesforceSource {
            id: row.get(0)?,
            name: row.get(1)?,
            instance_url: row.get(2)?,
            access_token: row.get(3)?,
            api_version: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }
    Ok(items)
}

/// 按 ID 查询单个数据源，不存在时返回业务错误。
pub fn get_source(connection: &Connection, id: &str) -> Result<SalesforceSource, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, name, instance_url, access_token, api_version, created_at, updated_at FROM salesforce_sources WHERE id = ?1",
    )?;

    let item = statement
        .query_row([id], |row| {
            Ok(SalesforceSource {
                id: row.get(0)?,
                name: row.get(1)?,
                instance_url: row.get(2)?,
                access_token: row.get(3)?,
                api_version: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            })
        })
        .optional()?;

    item.ok_or_else(|| AppError::Biz(format!("数据源不存在: {id}")))
}

/// 新增数据源（ID 由后端生成 UUID）。
pub fn create_source(
    connection: &Connection,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let now = Utc::now().to_rfc3339();
    let item = SalesforceSource {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name,
        instance_url: payload.instance_url.trim_end_matches('/').to_string(),
        access_token: payload.access_token,
        api_version: payload.api_version,
        created_at: now.clone(),
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO salesforce_sources (id, name, instance_url, access_token, api_version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            item.id,
            item.name,
            item.instance_url,
            item.access_token,
            item.api_version,
            item.created_at,
            item.updated_at
        ],
    )?;

    Ok(item)
}

/// 更新现有数据源并返回最新记录。
pub fn update_source(
    connection: &Connection,
    id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE salesforce_sources SET name = ?2, instance_url = ?3, access_token = ?4, api_version = ?5, updated_at = ?6 WHERE id = ?1",
        params![
            id,
            payload.name,
            payload.instance_url.trim_end_matches('/').to_string(),
            payload.access_token,
            payload.api_version,
            now
        ],
    )?;

    get_source(connection, id)
}

/// 按固定 ID 进行写入，适用于 CLI 同步场景（重复同步只更新不新增）。
pub fn upsert_source_with_id(
    connection: &Connection,
    id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let now = Utc::now().to_rfc3339();
    let created_at: Option<String> = connection
        .query_row(
            "SELECT created_at FROM salesforce_sources WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;

    connection.execute(
        "INSERT INTO salesforce_sources (id, name, instance_url, access_token, api_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           instance_url = excluded.instance_url,
           access_token = excluded.access_token,
           api_version = excluded.api_version,
           updated_at = excluded.updated_at",
        params![
            id,
            payload.name,
            payload.instance_url.trim_end_matches('/').to_string(),
            payload.access_token,
            payload.api_version,
            created_at.unwrap_or_else(|| now.clone()),
            now,
        ],
    )?;

    get_source(connection, id)
}

/// 清理本次 CLI 同步中不存在的旧 CLI 数据源，避免脏数据堆积。
pub fn prune_cli_sources(connection: &Connection, keep_ids: &[String]) -> Result<(), AppError> {
    if keep_ids.is_empty() {
        // 当 CLI 无任何可用账号时，直接清空全部 cli-* 来源及关联缓存。
        connection.execute(
            "DELETE FROM object_metadata_cache WHERE source_id LIKE 'cli-%'",
            [],
        )?;
        connection.execute(
            "DELETE FROM column_visibility_settings WHERE source_id LIKE 'cli-%'",
            [],
        )?;
        connection.execute("DELETE FROM salesforce_sources WHERE id LIKE 'cli-%'", [])?;
        return Ok(());
    }

    // 构造动态占位符，确保 SQL 仍走参数绑定，避免字符串拼接注入风险。
    let placeholders = std::iter::repeat("?")
        .take(keep_ids.len())
        .collect::<Vec<_>>()
        .join(", ");

    let cache_sql = format!(
        "DELETE FROM object_metadata_cache WHERE source_id LIKE 'cli-%' AND source_id NOT IN ({})",
        placeholders
    );
    connection.execute(&cache_sql, params_from_iter(keep_ids.iter()))?;

    let visibility_sql = format!(
        "DELETE FROM column_visibility_settings WHERE source_id LIKE 'cli-%' AND source_id NOT IN ({})",
        placeholders
    );
    connection.execute(&visibility_sql, params_from_iter(keep_ids.iter()))?;

    let source_sql = format!(
        "DELETE FROM salesforce_sources WHERE id LIKE 'cli-%' AND id NOT IN ({})",
        placeholders
    );
    connection.execute(&source_sql, params_from_iter(keep_ids.iter()))?;

    Ok(())
}

/// 删除数据源及其对象缓存、字段可见性配置。
pub fn delete_source(connection: &Connection, id: &str) -> Result<(), AppError> {
    connection.execute("DELETE FROM salesforce_sources WHERE id = ?1", [id])?;
    connection.execute(
        "DELETE FROM object_metadata_cache WHERE source_id = ?1",
        [id],
    )?;
    connection.execute(
        "DELETE FROM column_visibility_settings WHERE source_id = ?1",
        [id],
    )?;
    Ok(())
}

/// 读取某个数据源 + 对象的字段勾选配置。
pub fn read_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
) -> Result<Option<HashMap<String, bool>>, AppError> {
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM column_visibility_settings WHERE source_id = ?1 AND object_name = ?2",
            params![source_id, object_name],
            |row| row.get(0),
        )
        .optional()?;

    match payload {
        Some(json) => Ok(Some(serde_json::from_str(&json)?)),
        None => Ok(None),
    }
}

/// 保存某个数据源 + 对象的字段勾选配置（UPSERT）。
pub fn write_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
    visibility: &HashMap<String, bool>,
) -> Result<(), AppError> {
    let payload = serde_json::to_string(visibility)?;
    let now = Utc::now().timestamp();

    connection.execute(
        "INSERT INTO column_visibility_settings (source_id, object_name, payload, updated_at) VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id, object_name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![source_id, object_name, payload, now],
    )?;

    Ok(())
}

/// 读取对象列表缓存（命中且未过期时返回 Some）。
pub fn read_object_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<Option<Vec<SalesforceObject>>, AppError> {
    let mut statement = connection
        .prepare("SELECT payload, updated_at FROM object_metadata_cache WHERE source_id = ?1")?;

    let cache = statement
        .query_row([source_id], |row| {
            Ok(CachedObjects {
                payload: row.get(0)?,
                updated_at: row.get(1)?,
            })
        })
        .optional()?;

    if let Some(item) = cache {
        let now = Utc::now().timestamp();
        // 仅在 TTL 内返回缓存，超时后强制走远端刷新。
        if now - item.updated_at < OBJECT_CACHE_TTL_SECONDS {
            let parsed: Vec<SalesforceObject> = serde_json::from_str(&item.payload)?;
            return Ok(Some(parsed));
        }
    }

    Ok(None)
}

/// 写入对象列表缓存（按 source_id 覆盖）。
pub fn write_object_cache(
    connection: &Connection,
    source_id: &str,
    objects: &[SalesforceObject],
) -> Result<(), AppError> {
    let payload = serde_json::to_string(objects)?;
    let now = Utc::now().timestamp();

    connection.execute(
        "INSERT INTO object_metadata_cache (source_id, payload, updated_at) VALUES (?1, ?2, ?3)
         ON CONFLICT(source_id) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![source_id, payload, now],
    )?;

    Ok(())
}

/// 写入系统日志（用于 Salesforce API / CLI 调用链路追踪）。
pub fn insert_system_log(
    connection: &Connection,
    level: &str,
    category: &str,
    action: &str,
    source_id: Option<&str>,
    target: Option<&str>,
    success: bool,
    message: &str,
    detail: Option<&str>,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO system_logs (created_at, level, category, action, source_id, target, success, message, detail)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            now,
            level,
            category,
            action,
            source_id,
            target,
            if success { 1 } else { 0 },
            message,
            detail
        ],
    )?;
    Ok(())
}

/// 分页读取系统日志，按时间倒序返回。
pub fn list_system_logs(
    connection: &Connection,
    page: i64,
    page_size: i64,
) -> Result<SystemLogPage, AppError> {
    // 对页码和页大小做后端兜底，防止前端传入无效参数。
    let safe_page = page.max(1);
    let safe_size = page_size.clamp(10, 200);
    let offset = (safe_page - 1) * safe_size;

    let total: i64 =
        connection.query_row("SELECT COUNT(1) FROM system_logs", [], |row| row.get(0))?;

    let mut statement = connection.prepare(
        "SELECT id, created_at, level, category, action, source_id, target, success, message, detail
         FROM system_logs
         ORDER BY id DESC
         LIMIT ?1 OFFSET ?2",
    )?;

    let rows = statement.query_map(params![safe_size, offset], |row| {
        Ok(SystemLogEntry {
            id: row.get(0)?,
            created_at: row.get(1)?,
            level: row.get(2)?,
            category: row.get(3)?,
            action: row.get(4)?,
            source_id: row.get(5)?,
            target: row.get(6)?,
            success: row.get::<_, i64>(7)? == 1,
            message: row.get(8)?,
            detail: row.get(9)?,
        })
    })?;

    let mut items = Vec::new();
    for row in rows {
        items.push(row?);
    }

    Ok(SystemLogPage {
        items,
        page: safe_page,
        page_size: safe_size,
        total,
    })
}
