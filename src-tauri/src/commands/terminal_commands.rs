#![allow(dead_code, unused_imports)]
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{Emitter, Manager, State};
use tauri_plugin_opener::OpenerExt;

use crate::ai::orchestrator::AiOrchestrator;
use crate::app_state::AppState;
use crate::command_storage as db;
use crate::error::AppError;
use crate::models::{
    AiCapabilities, AiChatTurnV2Request, AiChatTurnV2Response, CliPathProbe, CliPathSettings,
    CliPathStatus, CurrentUserContext, LlmSettings, LlmSettingsView, MutationExecutionResult,
    MutationPreviewSqlItem, ObjectDdl, ObjectDescribe, QueryResult, RecordMutationPayload,
    RecordSavePayload, RecordSaveWithDeletePayload, RecordUpdatePayload, SalesforceObject,
    SalesforceSource, SaveLlmSettingsPayload, SourceSecretView, SourceUpsertPayload, SystemLogPage,
    TerminalCommandGroup, TerminalCommandGroupUpsertPayload, TerminalCommandItem,
    TerminalCommandReorderPayload, TerminalCommandUpsertPayload, TerminalShellSettings,
    WorkspaceSnapshotDto,
};
use crate::providers::{
    preview_create_record_sql, preview_delete_record_sql, preview_save_records_with_deletes_items,
    preview_update_record_sql, provider_for_source,
};
use crate::services::source_service::SourceService;
use crate::sf_cli;
use crate::terminal::{self as terminal_runtime, TerminalSessionInfo, TerminalShellOption};
use super::common::*;

/// 读取全局终端命令组（含命令列表）。
#[tauri::command]
pub fn list_terminal_command_groups(
    state: State<'_, AppState>,
) -> Result<Vec<TerminalCommandGroup>, String> {
    state
        .storage
        .read(|connection| db::list_terminal_command_groups(connection))
        .map_err(AppError::to_string_error)
}

/// 创建终端命令组。
#[tauri::command]
pub fn create_terminal_command_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<TerminalCommandGroup, String> {
    let normalized_name = name.trim().to_string();
    if normalized_name.is_empty() {
        return Err("命令组名称不能为空".to_string());
    }

    state
        .storage
        .write(|connection| db::create_terminal_command_group(connection, &normalized_name))
        .map_err(AppError::to_string_error)
}

/// 更新终端命令组名称。
#[tauri::command]
pub fn update_terminal_command_group(
    state: State<'_, AppState>,
    group_id: String,
    payload: TerminalCommandGroupUpsertPayload,
) -> Result<TerminalCommandGroup, String> {
    let normalized_group_id = group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    state
        .storage
        .write(|connection| {
            db::update_terminal_command_group(connection, &normalized_group_id, &payload.name)
        })
        .map_err(AppError::to_string_error)
}

/// 创建终端命令。
#[tauri::command]
pub fn create_terminal_command(
    state: State<'_, AppState>,
    payload: TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, String> {
    state
        .storage
        .write(|connection| db::create_terminal_command(connection, &payload))
        .map_err(AppError::to_string_error)
}

/// 更新终端命令。
#[tauri::command]
pub fn update_terminal_command(
    state: State<'_, AppState>,
    command_id: String,
    payload: TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, String> {
    let normalized_command_id = command_id.trim().to_string();
    if normalized_command_id.is_empty() {
        return Err("commandId 不能为空".to_string());
    }

    state
        .storage
        .write(|connection| {
            db::update_terminal_command(connection, &normalized_command_id, &payload)
        })
        .map_err(AppError::to_string_error)
}

/// 删除终端命令。
#[tauri::command]
pub fn delete_terminal_command(
    state: State<'_, AppState>,
    group_id: String,
    command_id: String,
) -> Result<(), String> {
    let normalized_group_id = group_id.trim().to_string();
    let normalized_command_id = command_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }
    if normalized_command_id.is_empty() {
        return Err("commandId 不能为空".to_string());
    }

    state
        .storage
        .write(|connection| {
            db::delete_terminal_command(connection, &normalized_group_id, &normalized_command_id)
        })
        .map_err(AppError::to_string_error)
}

/// 删除终端命令组。
#[tauri::command]
pub fn delete_terminal_command_group(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<(), String> {
    let normalized_group_id = group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    state
        .storage
        .write(|connection| db::delete_terminal_command_group(connection, &normalized_group_id))
        .map_err(AppError::to_string_error)
}

/// 调整终端命令排序。
#[tauri::command]
pub fn reorder_terminal_commands(
    state: State<'_, AppState>,
    payload: TerminalCommandReorderPayload,
) -> Result<(), String> {
    let normalized_group_id = payload.group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    if payload.command_ids.is_empty() {
        return Err("commandIds 不能为空".to_string());
    }

    state
        .storage
        .write(|connection| db::reorder_terminal_commands(connection, &payload))
        .map_err(AppError::to_string_error)
}

/// 打开终端会话：每个前端 Tab 对应一个系统终端进程。
#[tauri::command]
pub fn open_terminal_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    initial_command: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    // 读取终端首选 shell 命令配置（动态路径，不限制固定版本）。
    let preferred_shell_command = read_terminal_shell_command(&state);

    terminal_runtime::open_terminal_session(
        &app_handle,
        &state.terminal_sessions,
        normalized_tab_id,
        cols.unwrap_or(120),
        rows.unwrap_or(36),
        preferred_shell_command.as_deref(),
        initial_command.as_deref(),
    )
}

/// 列出当前系统可用终端 Shell（用于设置页下拉选择）。
#[tauri::command]
pub fn list_available_terminal_shells() -> Result<Vec<TerminalShellOption>, String> {
    Ok(terminal_runtime::list_available_terminal_shells())
}

/// 读取终端 Shell 设置：包含当前保存值与旧版兼容字段。
#[tauri::command]
pub fn get_terminal_shell_settings(
    state: State<'_, AppState>,
) -> Result<TerminalShellSettings, String> {
    state
        .storage
        .read(|connection| {
            Ok(TerminalShellSettings {
                command_value: db::read_app_setting(connection, TERMINAL_SHELL_COMMAND_KEY)?,
                legacy_preference: db::read_app_setting(
                    connection,
                    LEGACY_TERMINAL_SHELL_PREFERENCE_KEY,
                )?,
            })
        })
        .map_err(AppError::to_string_error)
}

/// 保存终端 Shell 命令路径。
#[tauri::command]
pub fn save_terminal_shell_command(
    state: State<'_, AppState>,
    command: String,
) -> Result<(), String> {
    let normalized_command = command.trim().to_string();
    if normalized_command.is_empty() {
        return Err("终端 Shell 命令不能为空".to_string());
    }
    state
        .storage
        .write(|connection| {
            db::write_app_setting(connection, TERMINAL_SHELL_COMMAND_KEY, &normalized_command)
        })
        .map_err(AppError::to_string_error)
}

/// 向终端会话写入输入（真实终端键盘输入透传）。
#[tauri::command]
pub fn write_terminal_input(
    state: State<'_, AppState>,
    tab_id: String,
    input: String,
) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::write_terminal_input(&state.terminal_sessions, normalized_tab_id, &input)
}

/// 调整终端会话尺寸（与 xterm cols/rows 同步）。
#[tauri::command]
pub fn resize_terminal_session(
    state: State<'_, AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::resize_terminal_session(
        &state.terminal_sessions,
        normalized_tab_id,
        cols,
        rows,
    )
}

/// 关闭终端会话并终止对应进程。
#[tauri::command]
pub fn close_terminal_session(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::close_terminal_session(&state.terminal_sessions, normalized_tab_id)
}

/// 以管理员身份打开系统终端（仅 Windows）。
/// 说明：管理员进程受 UAC 隔离，无法附着到当前 PTY Tab，因此以新窗口方式打开。
#[tauri::command]
pub fn open_elevated_terminal(_state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 管理员终端同样遵循数据库中保存的终端 Shell 配置。
        let elevated_program = read_terminal_shell_command(&_state)
            .ok_or_else(|| "未配置终端 Shell，请到“设置-终端设置”中重新选择 Shell。".to_string())?;
        let escaped_program = elevated_program.replace('\'', "''");
        let guard_script = terminal_runtime::build_windows_parent_guard_script(std::process::id());
        let escaped_guard_script = guard_script.replace('\'', "''");
        let elevate_command = format!(
            "Start-Process -FilePath '{}' -Verb RunAs -ArgumentList '-NoExit','-NoLogo','-Command','{}'",
            escaped_program, escaped_guard_script
        );
        let output = StdCommand::new("powershell.exe")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(elevate_command)
            .output()
            .map_err(|error| format!("拉起管理员终端失败: {error}"))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format!(
            "拉起管理员终端失败，exit={:?}, stderr={stderr}, stdout={stdout}",
            output.status.code()
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持“以管理员身份打开终端”".to_string())
    }
}

/// 读取终端 shell 命令配置；兼容旧版 `terminal.shell.preference`（pwsh/powershell）。
fn read_terminal_shell_command(state: &State<'_, AppState>) -> Option<String> {
    let (command, legacy_raw) = state
        .storage
        .read(|connection| {
            let cmd = db::read_app_setting(connection, TERMINAL_SHELL_COMMAND_KEY)?
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty());
            let leg = db::read_app_setting(connection, LEGACY_TERMINAL_SHELL_PREFERENCE_KEY)?;
            Ok((cmd, leg))
        })
        .ok()?;
    if command.is_some() {
        return command;
    }

    let legacy = legacy_raw
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())?;
    if legacy == "powershell" {
        return Some("powershell.exe".to_string());
    }
    if legacy == "pwsh" {
        return Some("pwsh.exe".to_string());
    }
    Some(legacy)
}
