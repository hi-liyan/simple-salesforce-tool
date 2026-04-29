use chrono::Utc;
use rusqlite::{params, Connection};

use crate::error::AppError;
use crate::models::{
    TerminalCommandGroup, TerminalCommandItem, TerminalCommandReorderPayload,
    TerminalCommandUpsertPayload,
};

/// 列出全部终端命令组与命令。
pub fn list_terminal_command_groups(
    connection: &Connection,
) -> Result<Vec<TerminalCommandGroup>, AppError> {
    let mut group_statement = connection.prepare(
        "SELECT id, name, created_at, updated_at
         FROM terminal_command_groups
         ORDER BY sort_order ASC, id ASC",
    )?;
    let group_rows = group_statement.query_map([], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, String>(2)?,
            row.get::<_, String>(3)?,
        ))
    })?;

    let mut result = Vec::new();
    for group_row in group_rows {
        let (group_id, group_name, created_at, updated_at) = group_row?;
        let mut command_statement = connection.prepare(
            "SELECT id, name, command_text, description, created_at, updated_at
             FROM terminal_commands
             WHERE group_id = ?1
             ORDER BY sort_order ASC, id ASC",
        )?;
        let command_rows = command_statement.query_map([&group_id], |row| {
            Ok(TerminalCommandItem {
                id: row.get(0)?,
                name: row.get(1)?,
                command: row.get(2)?,
                description: row.get(3)?,
                created_at: row.get(4)?,
                updated_at: row.get(5)?,
            })
        })?;
        result.push(TerminalCommandGroup {
            id: group_id,
            name: group_name,
            commands: command_rows.collect::<Result<Vec<_>, _>>()?,
            created_at,
            updated_at,
        });
    }
    Ok(result)
}

/// 创建终端命令组。
pub fn create_terminal_command_group(
    connection: &Connection,
    name: &str,
) -> Result<TerminalCommandGroup, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO terminal_command_groups (id, name, sort_order, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?4)",
        params![id, name.trim(), next_group_sort_order(connection)?, now],
    )?;
    Ok(TerminalCommandGroup {
        id,
        name: name.trim().to_string(),
        commands: Vec::new(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 更新终端命令组名称。
pub fn update_terminal_command_group(
    connection: &Connection,
    group_id: &str,
    name: &str,
) -> Result<TerminalCommandGroup, AppError> {
    connection.execute(
        "UPDATE terminal_command_groups SET name = ?2, updated_at = ?3 WHERE id = ?1",
        params![group_id, name.trim(), Utc::now().to_rfc3339()],
    )?;
    list_terminal_command_groups(connection)?
        .into_iter()
        .find(|item| item.id == group_id)
        .ok_or_else(|| AppError::Biz(format!("未找到命令组: {group_id}")))
}

/// 创建终端命令。
pub fn create_terminal_command(
    connection: &Connection,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    let id = uuid::Uuid::new_v4().to_string();
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "INSERT INTO terminal_commands (
            id, group_id, name, command_text, description, sort_order, created_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7)",
        params![
            id,
            payload.group_id,
            payload.name.trim(),
            payload.command.trim(),
            payload.description.trim(),
            next_command_sort_order(connection, &payload.group_id)?,
            now
        ],
    )?;
    Ok(TerminalCommandItem {
        id,
        name: payload.name.trim().to_string(),
        command: payload.command.trim().to_string(),
        description: payload.description.trim().to_string(),
        created_at: now.clone(),
        updated_at: now,
    })
}

/// 更新终端命令。
pub fn update_terminal_command(
    connection: &Connection,
    command_id: &str,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    connection.execute(
        "UPDATE terminal_commands
         SET group_id = ?2, name = ?3, command_text = ?4, description = ?5, updated_at = ?6
         WHERE id = ?1",
        params![
            command_id,
            payload.group_id,
            payload.name.trim(),
            payload.command.trim(),
            payload.description.trim(),
            Utc::now().to_rfc3339()
        ],
    )?;
    list_terminal_command_groups(connection)?
        .into_iter()
        .flat_map(|group| group.commands)
        .find(|item| item.id == command_id)
        .ok_or_else(|| AppError::Biz(format!("未找到命令: {command_id}")))
}

/// 删除单条终端命令。
pub fn delete_terminal_command(
    connection: &Connection,
    group_id: &str,
    command_id: &str,
) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM terminal_commands WHERE id = ?1 AND group_id = ?2",
        params![command_id, group_id],
    )?;
    normalize_command_sort_orders(connection, group_id)?;
    Ok(())
}

/// 删除终端命令组。
pub fn delete_terminal_command_group(
    connection: &Connection,
    group_id: &str,
) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM terminal_command_groups WHERE id = ?1",
        [group_id],
    )?;
    normalize_group_sort_orders(connection)?;
    Ok(())
}

/// 调整组内命令顺序。
pub fn reorder_terminal_commands(
    connection: &Connection,
    payload: &TerminalCommandReorderPayload,
) -> Result<(), AppError> {
    for (index, command_id) in payload.command_ids.iter().enumerate() {
        connection.execute(
            "UPDATE terminal_commands SET sort_order = ?2, updated_at = ?3 WHERE id = ?1 AND group_id = ?4",
            params![command_id, index as i64 + 1, Utc::now().to_rfc3339(), payload.group_id],
        )?;
    }
    normalize_command_sort_orders(connection, &payload.group_id)?;
    Ok(())
}

/// 读取下一个命令组排序号。
fn next_group_sort_order(connection: &Connection) -> Result<i64, AppError> {
    let value: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM terminal_command_groups",
        [],
        |row| row.get(0),
    )?;
    Ok(value.unwrap_or(0) + 1)
}

/// 读取组内下一个命令排序号。
fn next_command_sort_order(connection: &Connection, group_id: &str) -> Result<i64, AppError> {
    let value: Option<i64> = connection.query_row(
        "SELECT MAX(sort_order) FROM terminal_commands WHERE group_id = ?1",
        [group_id],
        |row| row.get(0),
    )?;
    Ok(value.unwrap_or(0) + 1)
}

/// 归一化命令组顺序。
fn normalize_group_sort_orders(connection: &Connection) -> Result<(), AppError> {
    let mut statement = connection.prepare(
        "SELECT id FROM terminal_command_groups ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    for (index, row) in rows.enumerate() {
        connection.execute(
            "UPDATE terminal_command_groups SET sort_order = ?2 WHERE id = ?1",
            params![row?, index as i64 + 1],
        )?;
    }
    Ok(())
}

/// 归一化组内命令顺序。
fn normalize_command_sort_orders(connection: &Connection, group_id: &str) -> Result<(), AppError> {
    let mut statement = connection.prepare(
        "SELECT id FROM terminal_commands WHERE group_id = ?1 ORDER BY sort_order ASC, created_at ASC, id ASC",
    )?;
    let rows = statement.query_map([group_id], |row| row.get::<_, String>(0))?;
    for (index, row) in rows.enumerate() {
        connection.execute(
            "UPDATE terminal_commands SET sort_order = ?2 WHERE id = ?1",
            params![row?, index as i64 + 1],
        )?;
    }
    Ok(())
}
