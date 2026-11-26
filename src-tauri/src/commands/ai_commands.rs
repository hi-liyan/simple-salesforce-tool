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

/// 获取 Salesforce CLI 路径配置与自动探测结果。
#[tauri::command]
pub fn get_cli_path_settings(state: State<'_, AppState>) -> Result<CliPathSettings, String> {
    let custom = read_configured_cli_path(&state);
    Ok(sf_cli::read_cli_path_settings(custom))
}

/// 保存 Salesforce CLI 自定义路径(传空会清除配置)。
#[tauri::command]
pub fn save_cli_path_settings(
    state: State<'_, AppState>,
    custom_cli_path: Option<String>,
) -> Result<CliPathSettings, String> {
    let normalized = custom_cli_path
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());

    state
        .storage
        .write(|connection| {
            if let Some(path) = normalized.as_ref() {
                db::write_app_setting(connection, SF_CLI_PATH_SETTING_KEY, path)
            } else {
                db::delete_app_setting(connection, SF_CLI_PATH_SETTING_KEY)
            }
        })
        .map_err(AppError::to_string_error)?;

    Ok(sf_cli::read_cli_path_settings(normalized))
}

/// 检测指定 Salesforce CLI 路径是否可用,并返回版本与更新状态。
#[tauri::command]
pub fn check_cli_path_status(
    state: State<'_, AppState>,
    cli_path: Option<String>,
) -> Result<CliPathStatus, String> {
    let input = cli_path
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .or_else(|| read_configured_cli_path(&state))
        .or_else(|| sf_cli::resolve_effective_cli_path(None));
    Ok(sf_cli::check_cli_path_status(input))
}

/// 自动探测本地可用 CLI 路径,并返回可用于下拉选择的候选项。
#[tauri::command]
pub fn detect_local_cli_paths(state: State<'_, AppState>) -> Result<Vec<CliPathProbe>, String> {
    let custom = read_configured_cli_path(&state);
    Ok(sf_cli::detect_available_cli_paths(custom))
}

/// 读取 LLM 设置(apiKey 仅返回掩码与是否已配置)。
#[tauri::command]
pub fn get_llm_settings(state: State<'_, AppState>) -> Result<LlmSettingsView, String> {
    let settings = read_llm_settings(&state)?;
    Ok(to_llm_settings_view(&settings))
}

/// 保存 LLM 设置(apiKey 采用覆盖保存策略)。
#[tauri::command]
pub fn save_llm_settings(
    state: State<'_, AppState>,
    payload: SaveLlmSettingsPayload,
) -> Result<LlmSettingsView, String> {
    let mut current = read_llm_settings(&state)?;
    let base_url = payload.base_url.trim();
    let model = payload.model.trim();
    if base_url.is_empty() {
        return Err("LLM baseUrl 不能为空".to_string());
    }
    if model.is_empty() {
        return Err("LLM model 不能为空".to_string());
    }

    current.base_url = base_url.to_string();
    current.model = model.to_string();
    current.timeout_ms = payload.timeout_ms.unwrap_or(current.timeout_ms).max(1000);

    // 仅当用户输入了新值时覆盖 apiKey,空字符串视为不覆盖。
    if let Some(next_key) = payload.api_key {
        let trimmed = next_key.trim();
        if !trimmed.is_empty() {
            current.api_key = trimmed.to_string();
        }
    }

    let raw = serde_json::to_string(&current)
        .map_err(|error| AppError::to_string_error(error.into()))?;
    state
        .storage
        .write(|connection| db::write_app_setting(connection, LLM_SETTINGS_KEY, &raw))
        .map_err(AppError::to_string_error)?;

    Ok(to_llm_settings_view(&current))
}

/// 停止指定 requestId 的 LLM 流式生成。
#[tauri::command]
pub fn stop_llm_stream_generation(
    state: State<'_, AppState>,
    request_id: String,
) -> Result<(), String> {
    let normalized = request_id.trim().to_string();
    if normalized.is_empty() {
        return Err("requestId 不能为空".to_string());
    }
    cancel_llm_stream_by_request_id(&state, &normalized);
    Ok(())
}

#[tauri::command]
pub fn ai_stop_turn(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    stop_llm_stream_generation(state, request_id)
}

#[tauri::command]
pub fn ai_get_capabilities(state: State<'_, AppState>) -> Result<AiCapabilities, String> {
    let llm_settings = read_llm_settings(&state)?;
    Ok(AiCapabilities {
        version: "v2".to_string(),
        provider: llm_settings.provider,
        model: llm_settings.model,
        tools: vec![
            TOOL_FIND_OBJECTS.to_string(),
            TOOL_GET_OBJECT_METADATA.to_string(),
            TOOL_SEARCH_OBJECT_FIELDS.to_string(),
            TOOL_GET_FIELD_METADATA.to_string(),
            TOOL_GET_OBJECT_RELATIONSHIP_GRAPH.to_string(),
        ],
    })
}

#[tauri::command]
pub async fn ai_chat_turn_v2(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: AiChatTurnV2Request,
) -> Result<AiChatTurnV2Response, String> {
    let llm_settings = read_llm_settings(&state)?;
    AiOrchestrator::run_turn(&app, &state, &llm_settings, &payload).await
}

/// 强制刷新对象列表(跳过缓存,直接请求 Salesforce API 并回写缓存)。

/// 读取 LLM 设置,未配置时返回默认值。
fn read_llm_settings(state: &State<'_, AppState>) -> Result<LlmSettings, String> {
    let raw = state
        .storage
        .read(|connection| db::read_app_setting(connection, LLM_SETTINGS_KEY))
        .map_err(AppError::to_string_error)?
        .unwrap_or_default();
    if raw.trim().is_empty() {
        return Ok(LlmSettings {
            provider: "openai".to_string(),
            base_url: "https://api.openai.com/v1".to_string(),
            model: "gpt-4.1-mini".to_string(),
            api_key: "".to_string(),
            timeout_ms: 30_000,
        });
    }

    let mut parsed: LlmSettings =
        serde_json::from_str(&raw).map_err(|error| AppError::to_string_error(error.into()))?;
    if parsed.provider.trim().is_empty() {
        parsed.provider = "openai".to_string();
    }
    if parsed.base_url.trim().is_empty() {
        parsed.base_url = "https://api.openai.com/v1".to_string();
    }
    if parsed.model.trim().is_empty() {
        parsed.model = "gpt-4.1-mini".to_string();
    }
    if parsed.timeout_ms == 0 {
        parsed.timeout_ms = 30_000;
    }
    Ok(parsed)
}

/// 生成对前端安全的 LLM 设置视图(隐藏 apiKey 明文)。
fn to_llm_settings_view(settings: &LlmSettings) -> LlmSettingsView {
    let configured = !settings.api_key.trim().is_empty();
    LlmSettingsView {
        provider: settings.provider.clone(),
        base_url: settings.base_url.clone(),
        model: settings.model.clone(),
        api_key_configured: configured,
        api_key_masked: mask_api_key(&settings.api_key),
        timeout_ms: settings.timeout_ms,
    }
}

/// 对 apiKey 做掩码处理,避免前端拿到明文。
fn mask_api_key(api_key: &str) -> String {
    let trimmed = api_key.trim();
    if trimmed.is_empty() {
        return "".to_string();
    }
    if trimmed.len() <= 8 {
        return "****".to_string();
    }
    let tail = &trimmed[trimmed.len() - 4..];
    format!("{}****{}", &trimmed[0..3], tail)
}

/// LLM 工具:按关键词检索对象列表。
const TOOL_FIND_OBJECTS: &str = "find_salesforce_objects";
/// LLM 工具:获取对象字段与关系元数据。
const TOOL_GET_OBJECT_METADATA: &str = "get_salesforce_object_metadata";
/// LLM 工具:按关键词搜索对象字段。
const TOOL_SEARCH_OBJECT_FIELDS: &str = "search_salesforce_object_fields";
/// LLM 工具:获取单个字段元数据。
const TOOL_GET_FIELD_METADATA: &str = "get_salesforce_field_metadata";
/// LLM 工具:获取对象关系图。
const TOOL_GET_OBJECT_RELATIONSHIP_GRAPH: &str = "get_salesforce_object_relationship_graph";

