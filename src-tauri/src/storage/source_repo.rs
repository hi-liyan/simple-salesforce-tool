use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::{Map, Value};

use crate::error::AppError;
use crate::models::{SalesforceSource, SourceUpsertPayload};

/// 数据源持久化记录。
#[derive(Debug, Clone)]
pub struct SourceRecord {
    /// 数据源 ID。
    pub id: String,
    /// 数据源名称。
    pub name: String,
    /// 数据源类型。
    pub source_type: String,
    /// 环境名。
    pub environment: String,
    /// 数据源颜色。
    pub color: String,
    /// 排序号。
    pub sort_order: i64,
    /// 是否启用。
    pub enabled: bool,
    /// 结构化配置。
    pub config_json: Value,
    /// secret bundle ID。
    pub secret_bundle_id: Option<String>,
    /// 版本号。
    pub version: i64,
    /// 创建时间。
    pub created_at: String,
    /// 更新时间。
    pub updated_at: String,
    /// 归档时间。
    pub archived_at: Option<String>,
}

/// 列出全部未归档数据源。
pub fn list_sources(connection: &Connection) -> Result<Vec<SourceRecord>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            id, name, source_type, environment, color, sort_order, enabled,
            config_json, secret_bundle_id, version, created_at, updated_at, archived_at
         FROM data_sources
         WHERE archived_at IS NULL
         ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], map_source_record)?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取单个数据源。
pub fn get_source(connection: &Connection, id: &str) -> Result<SourceRecord, AppError> {
    let record = connection
        .query_row(
            "SELECT
                id, name, source_type, environment, color, sort_order, enabled,
                config_json, secret_bundle_id, version, created_at, updated_at, archived_at
             FROM data_sources
             WHERE id = ?1",
            [id],
            map_source_record,
        )
        .optional()?;
    record.ok_or_else(|| AppError::Biz(format!("未找到数据源: {id}")))
}

/// 新建数据源。
pub fn insert_source(
    tx: &Transaction<'_>,
    source_id: &str,
    payload: &SourceUpsertPayload,
    secret_bundle_id: Option<&str>,
) -> Result<SourceRecord, AppError> {
    let now = Utc::now().to_rfc3339();
    let config_json = build_source_config_json(payload);
    let color = config_json
        .get("color")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    tx.execute(
        "INSERT INTO data_sources (
            id, name, source_type, environment, color, sort_order, enabled,
            config_json, secret_bundle_id, version, created_at, updated_at, archived_at
        ) VALUES (?1, ?2, ?3, 'default', ?4, ?5, 1, ?6, ?7, 1, ?8, ?8, NULL)",
        params![
            source_id,
            payload.name.trim(),
            normalize_source_type(Some(&payload.source_type)),
            color,
            next_source_sort_order(tx)?,
            serde_json::to_string(&config_json)?,
            secret_bundle_id,
            now
        ],
    )?;
    get_source(tx, source_id)
}

/// 更新数据源。
pub fn update_source(
    tx: &Transaction<'_>,
    source_id: &str,
    payload: &SourceUpsertPayload,
    secret_bundle_id: Option<&str>,
) -> Result<SourceRecord, AppError> {
    let current = get_source(tx, source_id)?;
    let config_json = build_source_config_json(payload);
    let color = config_json
        .get("color")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    tx.execute(
        "UPDATE data_sources
         SET
           name = ?2,
           source_type = ?3,
           color = ?4,
           config_json = ?5,
           secret_bundle_id = ?6,
           version = ?7,
           updated_at = ?8
         WHERE id = ?1",
        params![
            source_id,
            payload.name.trim(),
            normalize_source_type(Some(&payload.source_type)),
            color,
            serde_json::to_string(&config_json)?,
            secret_bundle_id.or(current.secret_bundle_id.as_deref()),
            current.version + 1,
            Utc::now().to_rfc3339()
        ],
    )?;
    get_source(tx, source_id)
}

/// 通过指定 ID 执行 upsert：供 CLI 同步链路使用。
pub fn upsert_source_with_id(
    tx: &Transaction<'_>,
    source_id: &str,
    payload: &SourceUpsertPayload,
    secret_bundle_id: Option<&str>,
) -> Result<SourceRecord, AppError> {
    if get_source(tx, source_id).is_ok() {
        return update_source(tx, source_id, payload, secret_bundle_id);
    }
    insert_source(tx, source_id, payload, secret_bundle_id)
}

/// 删除数据源。
pub fn delete_source(tx: &Transaction<'_>, id: &str) -> Result<(), AppError> {
    tx.execute("DELETE FROM data_sources WHERE id = ?1", [id])?;
    Ok(())
}

/// 调整数据源顺序。
pub fn reorder_sources(connection: &Connection, ordered_ids: &[String]) -> Result<(), AppError> {
    for (index, source_id) in ordered_ids.iter().enumerate() {
        connection.execute(
            "UPDATE data_sources SET sort_order = ?2, updated_at = ?3 WHERE id = ?1",
            params![source_id, index as i64 + 1, Utc::now().to_rfc3339()],
        )?;
    }
    normalize_source_sort_orders(connection)?;
    Ok(())
}

/// 清理未保留的 CLI 数据源。
pub fn prune_cli_sources(connection: &Connection, keep_ids: &[String]) -> Result<(), AppError> {
    let mut statement =
        connection.prepare("SELECT id FROM data_sources WHERE id LIKE 'cli-%' ORDER BY id ASC")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    for row in rows {
        let source_id = row?;
        if keep_ids.iter().any(|item| item == &source_id) {
            continue;
        }
        connection.execute("DELETE FROM data_sources WHERE id = ?1", [source_id])?;
    }
    normalize_source_sort_orders(connection)?;
    Ok(())
}

/// 将内部记录转换为前端公共 DTO。
pub fn into_public_source(record: SourceRecord, access_token: String) -> SalesforceSource {
    let raw_config = record
        .config_json
        .as_object()
        .cloned()
        .unwrap_or_else(Map::new);
    let instance_url = raw_config
        .get("instanceUrl")
        .and_then(Value::as_str)
        .unwrap_or("")
        .to_string();
    let api_version = raw_config
        .get("apiVersion")
        .and_then(Value::as_str)
        .unwrap_or_else(|| {
            if record.source_type.eq_ignore_ascii_case("mysql") {
                "mysql"
            } else {
                "v61.0"
            }
        })
        .to_string();
    SalesforceSource {
        id: record.id,
        name: record.name,
        sort_order: record.sort_order,
        source_type: record.source_type,
        config_json: Value::Object(raw_config),
        instance_url,
        access_token,
        api_version,
        created_at: record.created_at,
        updated_at: record.updated_at,
    }
}

/// 构造持久化配置 JSON：把普通配置与 secret 字段拆开保存。
pub fn build_source_config_json(payload: &SourceUpsertPayload) -> Value {
    let mut config = payload
        .config_json
        .as_object()
        .cloned()
        .unwrap_or_else(Map::new);
    config.insert(
        "instanceUrl".to_string(),
        Value::String(payload.instance_url.trim().to_string()),
    );
    config.insert(
        "apiVersion".to_string(),
        Value::String(payload.api_version.trim().to_string()),
    );
    config.remove("accessToken");
    config.remove("password");
    Value::Object(config)
}

/// 归一化数据源类型。
fn normalize_source_type(source_type: Option<&str>) -> String {
    let normalized = source_type.unwrap_or("salesforce").trim().to_lowercase();
    if normalized == "mysql" {
        return "mysql".to_string();
    }
    "salesforce".to_string()
}

/// 读取下一个排序号。
fn next_source_sort_order(connection: &Connection) -> Result<i64, AppError> {
    let value: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM data_sources WHERE archived_at IS NULL",
        [],
        |row| row.get(0),
    )?;
    Ok(value.unwrap_or(0) + 1)
}

/// 归一化数据源顺序。
fn normalize_source_sort_orders(connection: &Connection) -> Result<(), AppError> {
    let mut statement = connection.prepare(
        "SELECT id FROM data_sources WHERE archived_at IS NULL ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    for (index, row) in rows.enumerate() {
        connection.execute(
            "UPDATE data_sources SET sort_order = ?2 WHERE id = ?1",
            params![row?, index as i64 + 1],
        )?;
    }
    Ok(())
}

/// 将 SQL 行映射为 `SourceRecord`。
fn map_source_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<SourceRecord> {
    let raw_config: String = row.get(7)?;
    let config_json = serde_json::from_str(&raw_config).unwrap_or(Value::Object(Map::new()));
    Ok(SourceRecord {
        id: row.get(0)?,
        name: row.get(1)?,
        source_type: row.get(2)?,
        environment: row.get(3)?,
        color: row.get(4)?,
        sort_order: row.get(5)?,
        enabled: row.get::<_, i64>(6)? != 0,
        config_json,
        secret_bundle_id: row.get(8)?,
        version: row.get(9)?,
        created_at: row.get(10)?,
        updated_at: row.get(11)?,
        archived_at: row.get(12)?,
    })
}
