use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    CachedObjects, SalesforceObject, SalesforceSource, SourceUpsertPayload, SystemLogEntry,
    SystemLogPage,
};

/// 初始化数据库表结构。
pub fn init_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS data_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            source_type TEXT NOT NULL,
            config_json TEXT NOT NULL,
            instance_url TEXT NOT NULL,
            access_token TEXT NOT NULL,
            api_version TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

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

        CREATE TABLE IF NOT EXISTS source_metadata_cache (
            source_id TEXT NOT NULL,
            metadata_type TEXT NOT NULL,
            object_name TEXT NOT NULL DEFAULT '',
            payload TEXT NOT NULL,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY(source_id, metadata_type, object_name),
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

    // 启动时将历史 Salesforce 表数据迁移到通用 data_sources，保证旧版本无缝升级。
    migrate_salesforce_sources_to_data_sources(connection)?;
    // 兼容旧外键：将 data_sources 回填到 legacy salesforce_sources，避免缓存表外键失败。
    backfill_data_sources_to_legacy_salesforce_sources(connection)?;

    Ok(())
}

/// 将旧版 salesforce_sources 的数据补录到 data_sources（幂等执行）。
fn migrate_salesforce_sources_to_data_sources(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        INSERT OR IGNORE INTO data_sources (
            id,
            name,
            source_type,
            config_json,
            instance_url,
            access_token,
            api_version,
            created_at,
            updated_at
        )
        SELECT
            id,
            name,
            'salesforce',
            json_object(
                'instanceUrl', instance_url,
                'accessToken', access_token,
                'apiVersion', api_version
            ),
            instance_url,
            access_token,
            api_version,
            created_at,
            updated_at
        FROM salesforce_sources;
        "#,
    )?;
    Ok(())
}

/// 将通用数据源回填到旧版 salesforce_sources（幂等执行）。
/// 说明：object_metadata_cache/column_visibility_settings 目前仍引用该旧表。
fn backfill_data_sources_to_legacy_salesforce_sources(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        INSERT OR IGNORE INTO salesforce_sources (
            id,
            name,
            instance_url,
            access_token,
            api_version,
            created_at,
            updated_at
        )
        SELECT
            id,
            name,
            instance_url,
            access_token,
            api_version,
            created_at,
            updated_at
        FROM data_sources;
        "#,
    )?;
    Ok(())
}

/// 将单条通用数据源镜像写入 legacy salesforce_sources，兼容旧外键约束。
fn upsert_legacy_salesforce_source(
    connection: &Connection,
    source: &SalesforceSource,
) -> Result<(), AppError> {
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
            source.id,
            source.name,
            source.instance_url,
            source.access_token,
            source.api_version,
            source.created_at,
            source.updated_at
        ],
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
        "SELECT id, name, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at FROM data_sources ORDER BY updated_at DESC",
    )?;

    let rows = statement.query_map([], |row| {
        let source_type: Option<String> = row.get(2)?;
        let config_json_raw: Option<String> = row.get(3)?;
        let instance_url: String = row.get(4)?;
        let access_token: String = row.get(5)?;
        let api_version: String = row.get(6)?;
        Ok(SalesforceSource {
            id: row.get(0)?,
            name: row.get(1)?,
            source_type: source_type.unwrap_or_else(|| "salesforce".to_string()),
            config_json: parse_or_build_source_config(
                config_json_raw.as_deref(),
                &instance_url,
                &access_token,
                &api_version,
            ),
            instance_url,
            access_token,
            api_version,
            created_at: row.get(7)?,
            updated_at: row.get(8)?,
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
        "SELECT id, name, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at FROM data_sources WHERE id = ?1",
    )?;

    let item = statement
        .query_row([id], |row| {
            let source_type: Option<String> = row.get(2)?;
            let config_json_raw: Option<String> = row.get(3)?;
            let instance_url: String = row.get(4)?;
            let access_token: String = row.get(5)?;
            let api_version: String = row.get(6)?;
            Ok(SalesforceSource {
                id: row.get(0)?,
                name: row.get(1)?,
                source_type: source_type.unwrap_or_else(|| "salesforce".to_string()),
                config_json: parse_or_build_source_config(
                    config_json_raw.as_deref(),
                    &instance_url,
                    &access_token,
                    &api_version,
                ),
                instance_url,
                access_token,
                api_version,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
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
    let source_type = normalize_source_type(Some(&payload.source_type));
    let config_json = build_source_config_json(
        &source_type,
        &payload.config_json,
        &payload.instance_url,
        &payload.access_token,
        &payload.api_version,
    );
    let item = SalesforceSource {
        id: uuid::Uuid::new_v4().to_string(),
        name: payload.name,
        source_type,
        config_json,
        instance_url: payload.instance_url.trim_end_matches('/').to_string(),
        access_token: payload.access_token,
        api_version: payload.api_version,
        created_at: now.clone(),
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO data_sources (id, name, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            item.id,
            item.name,
            item.source_type,
            item.config_json.to_string(),
            item.instance_url,
            item.access_token,
            item.api_version,
            item.created_at,
            item.updated_at
        ],
    )?;

    // 为兼容旧缓存表外键，写入/更新 legacy salesforce_sources 镜像记录。
    upsert_legacy_salesforce_source(connection, &item)?;

    Ok(item)
}

/// 更新现有数据源并返回最新记录。
pub fn update_source(
    connection: &Connection,
    id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let now = Utc::now().to_rfc3339();
    let source_type = normalize_source_type(Some(&payload.source_type));
    let normalized_instance_url = payload.instance_url.trim_end_matches('/').to_string();
    let config_json = build_source_config_json(
        &source_type,
        &payload.config_json,
        &normalized_instance_url,
        &payload.access_token,
        &payload.api_version,
    );
    connection.execute(
        "UPDATE data_sources SET name = ?2, source_type = ?3, config_json = ?4, instance_url = ?5, access_token = ?6, api_version = ?7, updated_at = ?8 WHERE id = ?1",
        params![
            id,
            payload.name,
            source_type,
            config_json.to_string(),
            normalized_instance_url,
            payload.access_token,
            payload.api_version,
            now
        ],
    )?;

    let item = get_source(connection, id)?;
    // 更新后同步 legacy 镜像，避免缓存表写入触发外键失败。
    upsert_legacy_salesforce_source(connection, &item)?;
    Ok(item)
}

/// 按固定 ID 进行写入，适用于 CLI 同步场景（重复同步只更新不新增）。
pub fn upsert_source_with_id(
    connection: &Connection,
    id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let now = Utc::now().to_rfc3339();
    let source_type = normalize_source_type(Some(&payload.source_type));
    let normalized_instance_url = payload.instance_url.trim_end_matches('/').to_string();
    let config_json = build_source_config_json(
        &source_type,
        &payload.config_json,
        &normalized_instance_url,
        &payload.access_token,
        &payload.api_version,
    );
    let created_at: Option<String> = connection
        .query_row(
            "SELECT created_at FROM data_sources WHERE id = ?1",
            [id],
            |row| row.get(0),
        )
        .optional()?;

    connection.execute(
        "INSERT INTO data_sources (id, name, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           source_type = excluded.source_type,
           config_json = excluded.config_json,
           instance_url = excluded.instance_url,
           access_token = excluded.access_token,
           api_version = excluded.api_version,
           updated_at = excluded.updated_at",
        params![
            id,
            payload.name,
            source_type,
            config_json.to_string(),
            normalized_instance_url,
            payload.access_token,
            payload.api_version,
            created_at.unwrap_or_else(|| now.clone()),
            now,
        ],
    )?;

    let item = get_source(connection, id)?;
    // UPSERT 后同步 legacy 镜像，保证旧外键链路始终可用。
    upsert_legacy_salesforce_source(connection, &item)?;
    Ok(item)
}

/// 清理本次 CLI 同步中不存在的旧 CLI 数据源，避免脏数据堆积。
pub fn prune_cli_sources(connection: &Connection, keep_ids: &[String]) -> Result<(), AppError> {
    if keep_ids.is_empty() {
        // 当 CLI 无任何可用账号时，直接清空全部 cli-* 来源及关联缓存。
        // 先删 legacy，利用外键级联自动清理缓存。
        connection.execute("DELETE FROM salesforce_sources WHERE id LIKE 'cli-%'", [])?;
        connection.execute(
            "DELETE FROM object_metadata_cache WHERE source_id LIKE 'cli-%'",
            [],
        )?;
        connection.execute(
            "DELETE FROM column_visibility_settings WHERE source_id LIKE 'cli-%'",
            [],
        )?;
        connection.execute(
            "DELETE FROM source_metadata_cache WHERE source_id LIKE 'cli-%'",
            [],
        )?;
        connection.execute("DELETE FROM data_sources WHERE id LIKE 'cli-%'", [])?;
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

    let metadata_sql = format!(
        "DELETE FROM source_metadata_cache WHERE source_id LIKE 'cli-%' AND source_id NOT IN ({})",
        placeholders
    );
    connection.execute(&metadata_sql, params_from_iter(keep_ids.iter()))?;

    let source_sql = format!(
        "DELETE FROM data_sources WHERE id LIKE 'cli-%' AND id NOT IN ({})",
        placeholders
    );
    connection.execute(&source_sql, params_from_iter(keep_ids.iter()))?;

    let legacy_source_sql = format!(
        "DELETE FROM salesforce_sources WHERE id LIKE 'cli-%' AND id NOT IN ({})",
        placeholders
    );
    connection.execute(&legacy_source_sql, params_from_iter(keep_ids.iter()))?;

    Ok(())
}

/// 删除数据源及其对象缓存、字段可见性配置。
pub fn delete_source(connection: &Connection, id: &str) -> Result<(), AppError> {
    // 先删除 legacy，利用外键级联删除缓存，避免残留孤儿数据。
    connection.execute("DELETE FROM salesforce_sources WHERE id = ?1", [id])?;
    connection.execute("DELETE FROM data_sources WHERE id = ?1", [id])?;
    connection.execute(
        "DELETE FROM object_metadata_cache WHERE source_id = ?1",
        [id],
    )?;
    connection.execute(
        "DELETE FROM column_visibility_settings WHERE source_id = ?1",
        [id],
    )?;
    connection.execute("DELETE FROM source_metadata_cache WHERE source_id = ?1", [id])?;
    Ok(())
}

/// 归一化数据源类型：空值/未知值在 M1 阶段统一回退为 salesforce。
fn normalize_source_type(source_type: Option<&str>) -> String {
    let normalized = source_type
        .map(|item| item.trim().to_lowercase())
        .unwrap_or_else(|| "salesforce".to_string());
    if normalized.is_empty() {
        "salesforce".to_string()
    } else {
        normalized
    }
}

/// 构建最终入库配置：优先使用外部传入 config_json，并对 Salesforce 自动补齐关键字段。
fn build_source_config_json(
    source_type: &str,
    incoming_config: &Value,
    instance_url: &str,
    access_token: &str,
    api_version: &str,
) -> Value {
    let mut config = if incoming_config.is_object() {
        incoming_config.clone()
    } else {
        json!({})
    };
    if source_type.eq_ignore_ascii_case("salesforce") {
        // Salesforce 配置在 M1 阶段仍以旧字段为主，写入 config_json 仅作为兼容过渡。
        config["instanceUrl"] = Value::String(instance_url.to_string());
        config["accessToken"] = Value::String(access_token.to_string());
        config["apiVersion"] = Value::String(api_version.to_string());
    }
    config
}

/// 从数据库恢复配置：若 config_json 缺失或无效，则使用旧字段构造兼容配置。
fn parse_or_build_source_config(
    raw_config: Option<&str>,
    instance_url: &str,
    access_token: &str,
    api_version: &str,
) -> Value {
    if let Some(raw) = raw_config {
        if let Ok(parsed) = serde_json::from_str::<Value>(raw) {
            if parsed.is_object() {
                return parsed;
            }
        }
    }
    json!({
        "instanceUrl": instance_url,
        "accessToken": access_token,
        "apiVersion": api_version
    })
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

/// 读取对象列表缓存（命中即返回，刷新动作负责失效策略）。
pub fn read_object_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<Option<Vec<SalesforceObject>>, AppError> {
    let mut statement = connection
        .prepare("SELECT payload FROM object_metadata_cache WHERE source_id = ?1")?;

    let cache = statement
        .query_row([source_id], |row| {
            Ok(CachedObjects {
                payload: row.get(0)?,
            })
        })
        .optional()?;

    if let Some(item) = cache {
        let parsed: Vec<SalesforceObject> = serde_json::from_str(&item.payload)?;
        return Ok(Some(parsed));
    }

    Ok(None)
}

/// 读取指定数据源/对象的元数据缓存字符串。
pub fn read_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
    metadata_type: &str,
    object_name: Option<&str>,
) -> Result<Option<String>, AppError> {
    let normalized_object_name = object_name.unwrap_or("").trim();
    let payload: Option<String> = connection
        .query_row(
            "SELECT payload FROM source_metadata_cache WHERE source_id = ?1 AND metadata_type = ?2 AND object_name = ?3",
            params![source_id, metadata_type, normalized_object_name],
            |row| row.get(0),
        )
        .optional()?;
    Ok(payload)
}

/// 写入指定数据源/对象的元数据缓存字符串（UPSERT）。
pub fn write_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
    metadata_type: &str,
    object_name: Option<&str>,
    payload: &str,
) -> Result<(), AppError> {
    let normalized_object_name = object_name.unwrap_or("").trim();
    let now = Utc::now().timestamp();
    connection.execute(
        "INSERT INTO source_metadata_cache (source_id, metadata_type, object_name, payload, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(source_id, metadata_type, object_name) DO UPDATE SET payload = excluded.payload, updated_at = excluded.updated_at",
        params![source_id, metadata_type, normalized_object_name, payload, now],
    )?;
    Ok(())
}

/// 删除指定数据源的全部元数据缓存（用于刷新数据源时失效旧元数据）。
pub fn clear_source_metadata_cache(connection: &Connection, source_id: &str) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM source_metadata_cache WHERE source_id = ?1",
        [source_id],
    )?;
    Ok(())
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
