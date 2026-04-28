use chrono::Utc;
use rusqlite::{params, Connection, Transaction};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    ConsoleTabStateDto, QueryResultSetDto, QueryRowDraftDto, QueryTabStateDto, TerminalTabStateDto,
    ToolTabStateDto, WorkspaceSnapshotDto, WorkspaceTabDto,
};

/// 保存结构化工作区快照。
pub fn save_workspace_snapshot(
    tx: &Transaction<'_>,
    snapshot: &WorkspaceSnapshotDto,
) -> Result<(), AppError> {
    clear_workspace_tables(tx)?;

    for tab in &snapshot.tabs {
        tx.execute(
            "INSERT INTO workspace_tabs (
                tab_id, tab_kind, title, source_id, sort_order, is_active, payload_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                tab.tab_id,
                tab.tab_kind,
                tab.title,
                tab.source_id,
                tab.sort_order,
                tab.is_active,
                serde_json::to_string(&tab.payload_json)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for tab in &snapshot.query_tabs {
        tx.execute(
            "INSERT INTO query_tab_state (
                tab_id, binding_key, source_id, source_type, source_name, source_color, object_name,
                label, describe_json, where_clause, limit_value, sort_field, sort_direction, sort_clause,
                current_soql, soql_draft, show_query_bar, show_drawer, drawer_view, show_logs,
                column_visibility_json, notice_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, ?22, ?23)",
            params![
                tab.tab_id,
                tab.binding_key,
                tab.source_id,
                tab.source_type,
                tab.source_name,
                tab.source_color,
                tab.object_name,
                tab.label,
                tab.describe_json.as_ref().map(serde_json::to_string).transpose()?,
                tab.where_clause,
                tab.limit,
                tab.sort_field,
                tab.sort_direction,
                tab.sort_clause,
                tab.current_soql,
                tab.soql_draft,
                if tab.show_query_bar { 1 } else { 0 },
                if tab.show_drawer { 1 } else { 0 },
                tab.drawer_view,
                if tab.show_logs { 1 } else { 0 },
                serde_json::to_string(&tab.column_visibility)?,
                tab.notice_json.as_ref().map(serde_json::to_string).transpose()?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for result in &snapshot.query_results {
        tx.execute(
            "INSERT INTO query_result_sets (
                result_set_id, tab_id, result_status, total_size, records_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                result.result_set_id,
                result.tab_id,
                result.result_status,
                result.total_size,
                serde_json::to_string(&result.records_json)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for draft in &snapshot.query_row_drafts {
        tx.execute(
            "INSERT INTO query_row_drafts (
                tab_id, selected_record_ids_json, pending_delete_record_ids_json,
                dirty_cell_keys_json, baseline_records_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![
                draft.tab_id,
                serde_json::to_string(&draft.selected_record_ids_json)?,
                serde_json::to_string(&draft.pending_delete_record_ids_json)?,
                serde_json::to_string(&draft.dirty_cell_keys_json)?,
                serde_json::to_string(&draft.baseline_records_json)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for tab in &snapshot.console_tabs {
        tx.execute(
            "INSERT INTO console_tab_state (
                tab_id, source_id, source_type, source_name, source_color, name, soql_draft,
                selected_soql_text, result_json, notice_json, logs_json, selected_record_ids_json,
                show_bottom_panel, ai_conversation_id, ai_prompt_draft, ai_messages_json, ai_mode, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18)",
            params![
                tab.tab_id,
                tab.source_id,
                tab.source_type,
                tab.source_name,
                tab.source_color,
                tab.name,
                tab.soql_draft,
                tab.selected_soql_text,
                serde_json::to_string(&tab.result_json)?,
                tab.notice_json.as_ref().map(serde_json::to_string).transpose()?,
                serde_json::to_string(&tab.logs_json)?,
                serde_json::to_string(&tab.selected_record_ids_json)?,
                if tab.show_bottom_panel { 1 } else { 0 },
                tab.ai_conversation_id,
                tab.ai_prompt_draft,
                serde_json::to_string(&tab.ai_messages_json)?,
                if tab.ai_mode { 1 } else { 0 },
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for tab in &snapshot.tool_tabs {
        tx.execute(
            "INSERT INTO tool_tab_state (tab_id, tool_kind, name, payload_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                tab.tab_id,
                tab.tool_kind,
                tab.name,
                serde_json::to_string(&tab.payload_json)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for tab in &snapshot.terminal_tabs {
        tx.execute(
            "INSERT INTO terminal_tab_state (tab_id, name, input_draft, outputs_json, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                tab.tab_id,
                tab.name,
                tab.input_draft,
                serde_json::to_string(&tab.outputs_json)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    for (key, value) in &snapshot.ui_state {
        tx.execute(
            "INSERT INTO workspace_ui_state (state_key, value_json, updated_at)
             VALUES (?1, ?2, ?3)",
            params![key, serde_json::to_string(value)?, Utc::now().to_rfc3339()],
        )?;
    }

    Ok(())
}

/// 读取结构化工作区快照。
pub fn load_workspace_snapshot(connection: &Connection) -> Result<WorkspaceSnapshotDto, AppError> {
    let tabs = load_workspace_tabs(connection)?;
    let query_tabs = load_query_tabs(connection)?;
    let query_results = load_query_results(connection)?;
    let query_row_drafts = load_query_row_drafts(connection)?;
    let console_tabs = load_console_tabs(connection)?;
    let tool_tabs = load_tool_tabs(connection)?;
    let terminal_tabs = load_terminal_tabs(connection)?;
    let ui_state = load_ui_state(connection)?;
    Ok(WorkspaceSnapshotDto {
        tabs,
        query_tabs,
        query_results,
        query_row_drafts,
        console_tabs,
        tool_tabs,
        terminal_tabs,
        ui_state,
    })
}

/// 清理所有工作区表。
fn clear_workspace_tables(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute("DELETE FROM query_row_drafts", [])?;
    tx.execute("DELETE FROM query_result_sets", [])?;
    tx.execute("DELETE FROM query_tab_state", [])?;
    tx.execute("DELETE FROM console_tab_state", [])?;
    tx.execute("DELETE FROM tool_tab_state", [])?;
    tx.execute("DELETE FROM terminal_tab_state", [])?;
    tx.execute("DELETE FROM workspace_tabs", [])?;
    tx.execute("DELETE FROM workspace_ui_state", [])?;
    Ok(())
}

/// 读取工作区标签。
fn load_workspace_tabs(connection: &Connection) -> Result<Vec<WorkspaceTabDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT tab_id, tab_kind, title, source_id, sort_order, is_active, payload_json
         FROM workspace_tabs
         ORDER BY sort_order ASC, tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let payload_json: String = row.get(6)?;
        Ok(WorkspaceTabDto {
            tab_id: row.get(0)?,
            tab_kind: row.get(1)?,
            title: row.get(2)?,
            source_id: row.get(3)?,
            sort_order: row.get(4)?,
            is_active: row.get(5)?,
            payload_json: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取 Query 标签状态。
fn load_query_tabs(connection: &Connection) -> Result<Vec<QueryTabStateDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            tab_id, binding_key, source_id, source_type, source_name, source_color, object_name,
            label, describe_json, where_clause, limit_value, sort_field, sort_direction, sort_clause,
            current_soql, soql_draft, show_query_bar, show_drawer, drawer_view, show_logs,
            column_visibility_json, notice_json
         FROM query_tab_state
         ORDER BY tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let describe_json: Option<String> = row.get(8)?;
        let column_visibility_json: String = row.get(20)?;
        let notice_json: Option<String> = row.get(21)?;
        Ok(QueryTabStateDto {
            tab_id: row.get(0)?,
            binding_key: row.get(1)?,
            source_id: row.get(2)?,
            source_type: row.get(3)?,
            source_name: row.get(4)?,
            source_color: row.get(5)?,
            object_name: row.get(6)?,
            label: row.get(7)?,
            describe_json: describe_json.and_then(|value| serde_json::from_str(&value).ok()),
            where_clause: row.get(9)?,
            limit: row.get(10)?,
            sort_field: row.get(11)?,
            sort_direction: row.get(12)?,
            sort_clause: row.get(13)?,
            current_soql: row.get(14)?,
            soql_draft: row.get(15)?,
            show_query_bar: row.get::<_, i64>(16)? != 0,
            show_drawer: row.get::<_, i64>(17)? != 0,
            drawer_view: row.get(18)?,
            show_logs: row.get::<_, i64>(19)? != 0,
            column_visibility: serde_json::from_str(&column_visibility_json)
                .unwrap_or(Value::Object(serde_json::Map::new())),
            notice_json: notice_json.and_then(|value| serde_json::from_str(&value).ok()),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取 Query 结果集。
fn load_query_results(connection: &Connection) -> Result<Vec<QueryResultSetDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT result_set_id, tab_id, result_status, total_size, records_json
         FROM query_result_sets
         ORDER BY tab_id ASC, result_set_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let records_json: String = row.get(4)?;
        Ok(QueryResultSetDto {
            result_set_id: row.get(0)?,
            tab_id: row.get(1)?,
            result_status: row.get(2)?,
            total_size: row.get(3)?,
            records_json: serde_json::from_str(&records_json).unwrap_or(Value::Array(Vec::new())),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取 Query 草稿。
fn load_query_row_drafts(connection: &Connection) -> Result<Vec<QueryRowDraftDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT tab_id, selected_record_ids_json, pending_delete_record_ids_json, dirty_cell_keys_json, baseline_records_json
         FROM query_row_drafts
         ORDER BY tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let selected_json: String = row.get(1)?;
        let pending_json: String = row.get(2)?;
        let dirty_json: String = row.get(3)?;
        let baseline_json: String = row.get(4)?;
        Ok(QueryRowDraftDto {
            tab_id: row.get(0)?,
            selected_record_ids_json: serde_json::from_str(&selected_json)
                .unwrap_or(Value::Array(Vec::new())),
            pending_delete_record_ids_json: serde_json::from_str(&pending_json)
                .unwrap_or(Value::Array(Vec::new())),
            dirty_cell_keys_json: serde_json::from_str(&dirty_json)
                .unwrap_or(Value::Array(Vec::new())),
            baseline_records_json: serde_json::from_str(&baseline_json)
                .unwrap_or(Value::Object(serde_json::Map::new())),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取 Console 标签。
fn load_console_tabs(connection: &Connection) -> Result<Vec<ConsoleTabStateDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT
            tab_id, source_id, source_type, source_name, source_color, name, soql_draft,
            selected_soql_text, result_json, notice_json, logs_json, selected_record_ids_json,
            show_bottom_panel, ai_conversation_id, ai_prompt_draft, ai_messages_json, ai_mode
         FROM console_tab_state
         ORDER BY tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let result_json: String = row.get(8)?;
        let notice_json: Option<String> = row.get(9)?;
        let logs_json: String = row.get(10)?;
        let selected_ids_json: String = row.get(11)?;
        let ai_messages_json: String = row.get(15)?;
        Ok(ConsoleTabStateDto {
            tab_id: row.get(0)?,
            source_id: row.get(1)?,
            source_type: row.get(2)?,
            source_name: row.get(3)?,
            source_color: row.get(4)?,
            name: row.get(5)?,
            soql_draft: row.get(6)?,
            selected_soql_text: row.get(7)?,
            result_json: serde_json::from_str(&result_json).unwrap_or(Value::Null),
            notice_json: notice_json.and_then(|value| serde_json::from_str(&value).ok()),
            logs_json: serde_json::from_str(&logs_json).unwrap_or(Value::Array(Vec::new())),
            selected_record_ids_json: serde_json::from_str(&selected_ids_json)
                .unwrap_or(Value::Array(Vec::new())),
            show_bottom_panel: row.get::<_, i64>(12)? != 0,
            ai_conversation_id: row.get(13)?,
            ai_prompt_draft: row.get(14)?,
            ai_messages_json: serde_json::from_str(&ai_messages_json)
                .unwrap_or(Value::Array(Vec::new())),
            ai_mode: row.get::<_, i64>(16)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取工具标签。
fn load_tool_tabs(connection: &Connection) -> Result<Vec<ToolTabStateDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT tab_id, tool_kind, name, payload_json FROM tool_tab_state ORDER BY tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let payload_json: String = row.get(3)?;
        Ok(ToolTabStateDto {
            tab_id: row.get(0)?,
            tool_kind: row.get(1)?,
            name: row.get(2)?,
            payload_json: serde_json::from_str(&payload_json).unwrap_or(Value::Null),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取终端标签。
fn load_terminal_tabs(connection: &Connection) -> Result<Vec<TerminalTabStateDto>, AppError> {
    let mut statement = connection.prepare(
        "SELECT tab_id, name, input_draft, outputs_json FROM terminal_tab_state ORDER BY tab_id ASC",
    )?;
    let rows = statement.query_map([], |row| {
        let outputs_json: String = row.get(3)?;
        Ok(TerminalTabStateDto {
            tab_id: row.get(0)?,
            name: row.get(1)?,
            input_draft: row.get(2)?,
            outputs_json: serde_json::from_str(&outputs_json).unwrap_or(Value::Array(Vec::new())),
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 读取扩展 UI 状态。
fn load_ui_state(connection: &Connection) -> Result<HashMap<String, Value>, AppError> {
    let mut statement = connection
        .prepare("SELECT state_key, value_json FROM workspace_ui_state ORDER BY state_key ASC")?;
    let rows = statement.query_map([], |row| {
        let value_json: String = row.get(1)?;
        Ok((
            row.get::<_, String>(0)?,
            serde_json::from_str(&value_json).unwrap_or(Value::Null),
        ))
    })?;
    Ok(rows.collect::<Result<HashMap<_, _>, _>>()?)
}
