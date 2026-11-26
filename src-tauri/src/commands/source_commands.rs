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

/// 查询全部数据源列表（异步线程池执行，避免阻塞 Tauri 窗口主线程）。
#[tauri::command]
pub async fn list_sources(app: tauri::AppHandle) -> Result<Vec<SalesforceSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        SourceService::new(&state.storage)
            .list_sources()
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("读取数据源列表线程失败: {e}"))?
}

/// 从 Salesforce CLI 同步认证账号到本地 SQLite（放入 blocking 线程池执行，严禁阻塞窗口消息循环）。
#[tauri::command]
pub async fn sync_cli_sources(app: tauri::AppHandle) -> Result<Vec<SalesforceSource>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let preferred_cli_path = read_configured_cli_path(&state);
        let seeds = match sf_cli::load_cli_sources(preferred_cli_path.as_deref()) {
            Ok(items) => items,
            Err(error) => {
                let message = AppError::to_string_error(error);
                write_system_log(
                    &state,
                    "ERROR",
                    "SALESFORCE_CLI",
                    "sync_cli_sources",
                    None,
                    None,
                    false,
                    "同步 Salesforce CLI 数据源失败。",
                    Some(&message),
                );
                return Err(message);
            }
        };

        let keep_ids: Vec<String> = seeds.iter().map(|item| item.id.clone()).collect();
        let sources = state
            .storage
            .write(|connection| {
                // 逐条 upsert,保证同一个 org 重复同步只更新不新增。
                for seed in seeds {
                    db::upsert_source_with_id(connection, &seed.id, seed.payload)?;
                }
                // 清理本次同步不存在的旧 cli-* 数据源及其缓存。
                db::prune_cli_sources(connection, &keep_ids)?;
                db::list_sources(connection)
            })
            .map_err(AppError::to_string_error)?;

        write_system_log(
            &state,
            "INFO",
            "SALESFORCE_CLI",
            "sync_cli_sources",
            None,
            None,
            true,
            &format!("同步 Salesforce CLI 数据源成功,共 {} 个。", sources.len()),
            None,
        );
        Ok(sources)
    })
    .await
    .map_err(|e| format!("同步 CLI 数据源线程失败: {e}"))?
}

/// 调用 CLI 打开网页登录流程,登录成功后返回 orgId。
#[tauri::command]
pub async fn login_cli_org(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    instance_url: String,
) -> Result<String, String> {
    let trimmed = instance_url.trim().to_string();
    if trimmed.is_empty() {
        return Err("Instance URL cannot be empty".to_string());
    }

    cancel_cli_login_if_running(&state);
    let cancel_token = create_cli_login_cancel_token(&state);
    let preferred_cli_path = read_configured_cli_path(&state);

    // CLI 命令会阻塞,放入 blocking 线程池避免卡住 async runtime。
    let result = tauri::async_runtime::spawn_blocking(move || {
        sf_cli::login_web(trimmed.trim(), cancel_token, preferred_cli_path.as_deref())
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("登录线程失败: {error}"));
    clear_cli_login_cancel_token(&state);

    let org_id = match result {
        Ok(Ok(item)) => item.org_id,
        Ok(Err(error)) => {
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_CLI",
                "login_cli_org",
                None,
                None,
                false,
                "Salesforce CLI 登录失败。",
                Some(&error),
            );
            return Err(error);
        }
        Err(error) => {
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_CLI",
                "login_cli_org",
                None,
                None,
                false,
                "Salesforce CLI 登录线程失败。",
                Some(&error),
            );
            return Err(error);
        }
    };

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_CLI",
        "login_cli_org",
        Some(&format!("cli-{org_id}")),
        None,
        true,
        "Salesforce CLI 登录成功。",
        None,
    );

    let _ = app.emit_to(
        "main",
        "sf:login-success",
        serde_json::json!({ "orgId": org_id.clone() }),
    );
    if let Some(window) = app.get_webview_window("sf-auth") {
        let _ = window.close();
    }
    set_main_window_enabled(&app, true);
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_focus();
    }

    Ok(org_id)
}


/// 统一通过 DriverRegistry 校验数据源配置。
fn validate_source_payload_with_registry(
    state: &AppState,
    payload: &SourceUpsertPayload,
) -> Result<(), String> {
    let driver = state
        .driver_registry
        .get(&payload.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .validate_config(payload)
        .map_err(AppError::to_string_error)
}

/// 新建数据源。
#[tauri::command]
pub fn create_source(
    state: State<'_, AppState>,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, String> {
    validate_source_payload_with_registry(state.inner(), &payload)?;
    SourceService::new(&state.storage)
        .create_source(payload)
        .map_err(AppError::to_string_error)
}

/// 读取单个数据源的公共信息。
#[tauri::command]
pub fn get_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SalesforceSource, String> {
    SourceService::new(&state.storage)
        .get_source(&source_id)
        .map_err(AppError::to_string_error)
}

/// 显式读取设置页编辑链路需要的 secret 明文。
#[tauri::command]
pub fn get_source_secret_view(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SourceSecretView, String> {
    SourceService::new(&state.storage)
        .get_source_secret_view(&source_id)
        .map_err(AppError::to_string_error)
}

/// 按前端传入顺序重排数据源序号。
#[tauri::command]
pub fn reorder_sources(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<Vec<SalesforceSource>, String> {
    SourceService::new(&state.storage)
        .reorder_sources(&ordered_ids)
        .map_err(AppError::to_string_error)
}

/// 测试数据源连接可用性（不写库）。
#[tauri::command]
pub async fn test_source_connection(
    state: State<'_, AppState>,
    payload: SourceUpsertPayload,
) -> Result<(), String> {
    validate_source_payload_with_registry(state.inner(), &payload)?;
    let probe_source = SalesforceSource {
        id: "probe".to_string(),
        name: payload.name.clone(),
        sort_order: 0,
        source_type: payload.source_type.clone(),
        config_json: payload.config_json.clone(),
        instance_url: payload.instance_url.clone(),
        access_token: payload.access_token.clone(),
        api_version: payload.api_version.clone(),
        created_at: "".to_string(),
        updated_at: "".to_string(),
    };
    let driver = state
        .driver_registry
        .get(&probe_source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .test_connection(&probe_source)
        .await
        .map_err(AppError::to_string_error)
}

/// 更新数据源。
#[tauri::command]
pub async fn update_source(
    state: State<'_, AppState>,
    id: String,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, String> {
    validate_source_payload_with_registry(state.inner(), &payload)?;
    let updated = SourceService::new(&state.storage)
        .update_source(&id, payload)
        .map_err(AppError::to_string_error)?;
    state.connection_manager.evict(&id).await;
    Ok(updated)
}

/// 删除数据源。
#[tauri::command]
pub async fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    SourceService::new(&state.storage)
        .delete_source(&id)
        .map_err(AppError::to_string_error)?;
    state.connection_manager.evict(&id).await;
    Ok(())
}

