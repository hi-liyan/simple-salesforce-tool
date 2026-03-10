use chrono::Utc;
use rusqlite::{params, params_from_iter, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    CachedObjects, SalesforceObject, SalesforceSource, SourceUpsertPayload, SystemLogEntry,
    SystemLogPage, TerminalCommandGroup, TerminalCommandItem, TerminalCommandUpsertPayload,
};

/// 初始化数据库表结构。
pub fn init_schema(connection: &Connection) -> Result<(), AppError> {
    connection.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS data_sources (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
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

        CREATE TABLE IF NOT EXISTS terminal_command_groups (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS terminal_commands (
            id TEXT PRIMARY KEY,
            group_id TEXT NOT NULL,
            name TEXT NOT NULL,
            command_text TEXT NOT NULL,
            description TEXT NOT NULL DEFAULT '',
            sort_order INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            FOREIGN KEY(group_id) REFERENCES terminal_command_groups(id) ON DELETE CASCADE
        );

        CREATE INDEX IF NOT EXISTS idx_terminal_command_groups_sort
            ON terminal_command_groups(sort_order, id);
        CREATE INDEX IF NOT EXISTS idx_terminal_commands_group
            ON terminal_commands(group_id, sort_order, id);
        "#,
    )?;

    // 启动时将历史 Salesforce 表数据迁移到通用 data_sources，保证旧版本无缝升级。
    migrate_salesforce_sources_to_data_sources(connection)?;
    // 兼容历史版本：补齐 sort_order 字段并完成初始化序号。
    ensure_data_sources_sort_order_column(connection)?;
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

/// 确保 data_sources 存在 sort_order 字段，并为历史数据补齐连续序号。
fn ensure_data_sources_sort_order_column(connection: &Connection) -> Result<(), AppError> {
    let mut has_sort_order = false;
    {
        let mut statement = connection.prepare("PRAGMA table_info(data_sources)")?;
        let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
        for row in rows {
            if row?.eq_ignore_ascii_case("sort_order") {
                has_sort_order = true;
                break;
            }
        }
    }

    if !has_sort_order {
        connection.execute(
            "ALTER TABLE data_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0",
            [],
        )?;
    }

    normalize_source_sort_orders(connection)?;
    Ok(())
}

/// 将通用数据源回填到旧版 salesforce_sources（幂等执行）。
/// 说明：object_metadata_cache/column_visibility_settings 目前仍引用该旧表。
fn backfill_data_sources_to_legacy_salesforce_sources(
    connection: &Connection,
) -> Result<(), AppError> {
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

/// 计算命令组下一序号（全局维度）。
fn next_terminal_group_sort_order(connection: &Connection) -> Result<i64, AppError> {
    let max_sort_order: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM terminal_command_groups",
        [],
        |row| row.get(0),
    )?;
    Ok(max_sort_order.unwrap_or(0) + 1)
}

/// 计算命令下一序号（按命令组维度）。
fn next_terminal_command_sort_order(
    connection: &Connection,
    group_id: &str,
) -> Result<i64, AppError> {
    let max_sort_order: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM terminal_commands WHERE group_id = ?1",
        [group_id],
        |row| row.get(0),
    )?;
    Ok(max_sort_order.unwrap_or(0) + 1)
}

/// 读取全局终端命令组（含命令列表）。
pub fn list_terminal_command_groups(connection: &Connection) -> Result<Vec<TerminalCommandGroup>, AppError> {
    let mut group_statement = connection.prepare(
        "SELECT id, name, created_at, updated_at
         FROM terminal_command_groups
         ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;

    let group_rows = group_statement.query_map([], |row| {
        Ok(TerminalCommandGroup {
            id: row.get(0)?,
            name: row.get(1)?,
            commands: Vec::new(),
            created_at: row.get(2)?,
            updated_at: row.get(3)?,
        })
    })?;

    let mut groups: Vec<TerminalCommandGroup> = Vec::new();
    for row in group_rows {
        groups.push(row?);
    }
    if groups.is_empty() {
        return Ok(groups);
    }

    // 建立 group_id 到数组下标映射，便于后续批量装配命令列表。
    let mut group_index_by_id: HashMap<String, usize> = HashMap::new();
    for (index, group) in groups.iter().enumerate() {
        group_index_by_id.insert(group.id.clone(), index);
    }

    let mut command_statement = connection.prepare(
        "SELECT id, group_id, name, command_text, description, created_at, updated_at
         FROM terminal_commands
         ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;

    let command_rows = command_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(1)?,
            TerminalCommandItem {
                id: row.get(0)?,
                name: row.get(2)?,
                command: row.get(3)?,
                description: row.get(4)?,
                created_at: row.get(5)?,
                updated_at: row.get(6)?,
            },
        ))
    })?;

    for row in command_rows {
        let (group_id, command) = row?;
        if let Some(group_index) = group_index_by_id.get(&group_id) {
            groups[*group_index].commands.push(command);
        }
    }

    Ok(groups)
}

/// 新建终端命令组。
pub fn create_terminal_command_group(
    connection: &Connection,
    name: &str,
) -> Result<TerminalCommandGroup, AppError> {
    let normalized_name = name.trim();
    if normalized_name.is_empty() {
        return Err(AppError::Biz("命令组名称不能为空".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();
    let sort_order = next_terminal_group_sort_order(connection)?;
    connection.execute(
        "INSERT INTO terminal_command_groups (id, name, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5)",
        params![id, normalized_name, sort_order, now, now],
    )?;

    Ok(TerminalCommandGroup {
        id,
        name: normalized_name.to_string(),
        commands: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 新建命令并返回最新记录。
pub fn create_terminal_command(
    connection: &Connection,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    let normalized_group_id = payload.group_id.trim();
    let normalized_name = payload.name.trim();
    let normalized_command = payload.command.trim();
    let normalized_description = payload.description.trim();

    if normalized_group_id.is_empty() {
        return Err(AppError::Biz("groupId 不能为空".to_string()));
    }
    if normalized_name.is_empty() {
        return Err(AppError::Biz("命令名称不能为空".to_string()));
    }
    if normalized_command.is_empty() {
        return Err(AppError::Biz("命令内容不能为空".to_string()));
    }

    let group_exists: Option<i64> = connection
        .query_row(
            "SELECT 1 FROM terminal_command_groups WHERE id = ?1",
            params![normalized_group_id],
            |row| row.get(0),
        )
        .optional()?;
    if group_exists.is_none() {
        return Err(AppError::Biz("命令组不存在".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let id = uuid::Uuid::new_v4().to_string();
    let sort_order = next_terminal_command_sort_order(connection, normalized_group_id)?;
    connection.execute(
        "INSERT INTO terminal_commands (id, group_id, name, command_text, description, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
        params![
            id,
            normalized_group_id,
            normalized_name,
            normalized_command,
            normalized_description,
            sort_order,
            now,
            now
        ],
    )?;
    connection.execute(
        "UPDATE terminal_command_groups SET updated_at = ?2 WHERE id = ?1",
        params![normalized_group_id, now],
    )?;

    Ok(TerminalCommandItem {
        id,
        name: normalized_name.to_string(),
        command: normalized_command.to_string(),
        description: normalized_description.to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 更新命令并返回最新记录。
pub fn update_terminal_command(
    connection: &Connection,
    command_id: &str,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    let normalized_command_id = command_id.trim();
    let normalized_group_id = payload.group_id.trim();
    let normalized_name = payload.name.trim();
    let normalized_command = payload.command.trim();
    let normalized_description = payload.description.trim();

    if normalized_command_id.is_empty() {
        return Err(AppError::Biz("commandId 不能为空".to_string()));
    }
    if normalized_group_id.is_empty() {
        return Err(AppError::Biz("groupId 不能为空".to_string()));
    }
    if normalized_name.is_empty() {
        return Err(AppError::Biz("命令名称不能为空".to_string()));
    }
    if normalized_command.is_empty() {
        return Err(AppError::Biz("命令内容不能为空".to_string()));
    }

    let created_at: Option<String> = connection
        .query_row(
            "SELECT created_at FROM terminal_commands WHERE id = ?1 AND group_id = ?2",
            params![normalized_command_id, normalized_group_id],
            |row| row.get(0),
        )
        .optional()?;
    if created_at.is_none() {
        return Err(AppError::Biz("命令不存在或不属于当前分组".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let affected_rows = connection.execute(
        "UPDATE terminal_commands
         SET name = ?3, command_text = ?4, description = ?5, updated_at = ?6
         WHERE id = ?1 AND group_id = ?2",
        params![
            normalized_command_id,
            normalized_group_id,
            normalized_name,
            normalized_command,
            normalized_description,
            now
        ],
    )?;
    if affected_rows == 0 {
        return Err(AppError::Biz("命令不存在或不属于当前分组".to_string()));
    }

    connection.execute(
        "UPDATE terminal_command_groups SET updated_at = ?2 WHERE id = ?1",
        params![normalized_group_id, now],
    )?;

    Ok(TerminalCommandItem {
        id: normalized_command_id.to_string(),
        name: normalized_name.to_string(),
        command: normalized_command.to_string(),
        description: normalized_description.to_string(),
        created_at: created_at.unwrap_or_else(|| now.clone()),
        updated_at: now,
    })
}

/// 删除命令。
pub fn delete_terminal_command(
    connection: &Connection,
    group_id: &str,
    command_id: &str,
) -> Result<(), AppError> {
    let normalized_group_id = group_id.trim();
    let normalized_command_id = command_id.trim();
    if normalized_group_id.is_empty() {
        return Err(AppError::Biz("groupId 不能为空".to_string()));
    }
    if normalized_command_id.is_empty() {
        return Err(AppError::Biz("commandId 不能为空".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let affected_rows = connection.execute(
        "DELETE FROM terminal_commands WHERE id = ?1 AND group_id = ?2",
        params![normalized_command_id, normalized_group_id],
    )?;
    if affected_rows == 0 {
        return Err(AppError::Biz("命令不存在或已删除".to_string()));
    }
    connection.execute(
        "UPDATE terminal_command_groups SET updated_at = ?2 WHERE id = ?1",
        params![normalized_group_id, now],
    )?;
    Ok(())
}

/// 查询所有数据源，按序号升序返回。
pub fn list_sources(connection: &Connection) -> Result<Vec<SalesforceSource>, AppError> {
    // 每次读取前执行一次归一化，自动修复重复/缺失/乱序序号。
    normalize_source_sort_orders(connection)?;
    let mut statement = connection.prepare(
        "SELECT id, name, sort_order, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at FROM data_sources ORDER BY sort_order ASC, id ASC",
    )?;

    let rows = statement.query_map([], |row| {
        let source_type: Option<String> = row.get(3)?;
        let config_json_raw: Option<String> = row.get(4)?;
        let instance_url: String = row.get(5)?;
        let access_token: String = row.get(6)?;
        let api_version: String = row.get(7)?;
        Ok(SalesforceSource {
            id: row.get(0)?,
            name: row.get(1)?,
            sort_order: row.get(2)?,
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
            created_at: row.get(8)?,
            updated_at: row.get(9)?,
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
        "SELECT id, name, sort_order, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at FROM data_sources WHERE id = ?1",
    )?;

    let item = statement
        .query_row([id], |row| {
            let source_type: Option<String> = row.get(3)?;
            let config_json_raw: Option<String> = row.get(4)?;
            let instance_url: String = row.get(5)?;
            let access_token: String = row.get(6)?;
            let api_version: String = row.get(7)?;
            Ok(SalesforceSource {
                id: row.get(0)?,
                name: row.get(1)?,
                sort_order: row.get(2)?,
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
                created_at: row.get(8)?,
                updated_at: row.get(9)?,
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
    // 先归一化历史序号，再给新数据源分配“当前最大序号 + 1”。
    normalize_source_sort_orders(connection)?;
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
        sort_order: next_source_sort_order(connection)?,
        source_type,
        config_json,
        instance_url: payload.instance_url.trim_end_matches('/').to_string(),
        access_token: payload.access_token,
        api_version: payload.api_version,
        created_at: now.clone(),
        updated_at: now,
    };

    connection.execute(
        "INSERT INTO data_sources (id, name, sort_order, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            item.id,
            item.name,
            item.sort_order,
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
    // CLI 同步前先归一化，避免历史脏序号持续扩散。
    normalize_source_sort_orders(connection)?;
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
    let created_and_sort: Option<(String, i64)> = connection
        .query_row(
            "SELECT created_at, sort_order FROM data_sources WHERE id = ?1",
            [id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .optional()?;
    let sort_order = created_and_sort
        .as_ref()
        .map(|(_, sort_order)| *sort_order)
        .unwrap_or(next_source_sort_order(connection)?);
    let created_at = created_and_sort
        .map(|(created_at, _)| created_at)
        .unwrap_or_else(|| now.clone());

    connection.execute(
        "INSERT INTO data_sources (id, name, sort_order, source_type, config_json, instance_url, access_token, api_version, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
         ON CONFLICT(id) DO UPDATE SET
           name = excluded.name,
           sort_order = excluded.sort_order,
           source_type = excluded.source_type,
           config_json = excluded.config_json,
           instance_url = excluded.instance_url,
           access_token = excluded.access_token,
           api_version = excluded.api_version,
           updated_at = excluded.updated_at",
        params![
            id,
            payload.name,
            sort_order,
            source_type,
            config_json.to_string(),
            normalized_instance_url,
            payload.access_token,
            payload.api_version,
            created_at,
            now,
        ],
    )?;

    let item = get_source(connection, id)?;
    // UPSERT 后同步 legacy 镜像，保证旧外键链路始终可用。
    upsert_legacy_salesforce_source(connection, &item)?;
    Ok(item)
}

/// 按给定 ID 顺序重排数据源序号，并返回最新列表。
pub fn reorder_sources(
    connection: &Connection,
    ordered_ids: &[String],
) -> Result<Vec<SalesforceSource>, AppError> {
    if ordered_ids.is_empty() {
        return list_sources(connection);
    }

    // 拖拽重排必须传入完整且不重复的 ID 列表，避免局部更新造成序号冲突。
    let mut id_set = std::collections::HashSet::new();
    for id in ordered_ids {
        if !id_set.insert(id) {
            return Err(AppError::Biz("重排失败：存在重复的数据源 ID。".to_string()));
        }
    }

    let mut statement = connection.prepare("SELECT id FROM data_sources")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let mut all_ids = std::collections::HashSet::new();
    for row in rows {
        all_ids.insert(row?);
    }
    if all_ids.len() != ordered_ids.len() || !ordered_ids.iter().all(|id| all_ids.contains(id)) {
        return Err(AppError::Biz(
            "重排失败：传入的数据源集合与当前库中数据不一致，请刷新后重试。".to_string(),
        ));
    }

    for (index, source_id) in ordered_ids.iter().enumerate() {
        connection.execute(
            "UPDATE data_sources SET sort_order = ?2 WHERE id = ?1",
            params![source_id, (index + 1) as i64],
        )?;
    }

    // 重排后再次归一化，兜底修复潜在并发写入造成的空洞/重复。
    normalize_source_sort_orders(connection)?;
    list_sources(connection)
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
    connection.execute(
        "DELETE FROM source_metadata_cache WHERE source_id = ?1",
        [id],
    )?;
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

/// 计算下一个可用序号（当前最大序号 + 1）。
fn next_source_sort_order(connection: &Connection) -> Result<i64, AppError> {
    let max_sort_order: Option<i64> =
        connection.query_row("SELECT MAX(sort_order) FROM data_sources", [], |row| {
            row.get(0)
        })?;
    Ok(max_sort_order.unwrap_or(0) + 1)
}

/// 归一化全部数据源序号：按当前顺序重排为 1..N，修复重复、空洞和乱序。
fn normalize_source_sort_orders(connection: &Connection) -> Result<(), AppError> {
    let mut statement = connection.prepare(
        "SELECT id, sort_order, updated_at, created_at
         FROM data_sources
         ORDER BY sort_order ASC, updated_at DESC, created_at DESC, id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, i64>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    for (index, row) in rows.enumerate() {
        let (id, current_sort_order, _, _) = row?;
        let expected_sort_order = (index + 1) as i64;
        // 仅在序号不一致时写库，避免无意义更新。
        if current_sort_order != expected_sort_order {
            connection.execute(
                "UPDATE data_sources SET sort_order = ?2 WHERE id = ?1",
                params![id, expected_sort_order],
            )?;
        }
    }
    Ok(())
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
    let mut statement =
        connection.prepare("SELECT payload FROM object_metadata_cache WHERE source_id = ?1")?;

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
pub fn clear_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<(), AppError> {
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
