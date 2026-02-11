use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::models::{CachedObjects, SalesforceObject, SalesforceSource, SourceUpsertPayload};

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
        "#,
    )?;

    Ok(())
}

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

pub fn delete_source(connection: &Connection, id: &str) -> Result<(), AppError> {
    connection.execute("DELETE FROM salesforce_sources WHERE id = ?1", [id])?;
    connection.execute("DELETE FROM object_metadata_cache WHERE source_id = ?1", [id])?;
    Ok(())
}

pub fn read_object_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<Option<Vec<SalesforceObject>>, AppError> {
    let mut statement = connection.prepare(
        "SELECT payload, updated_at FROM object_metadata_cache WHERE source_id = ?1",
    )?;

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
        if now - item.updated_at < OBJECT_CACHE_TTL_SECONDS {
            let parsed: Vec<SalesforceObject> = serde_json::from_str(&item.payload)?;
            return Ok(Some(parsed));
        }
    }

    Ok(None)
}

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
