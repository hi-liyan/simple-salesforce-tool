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

/// 检测指定 Salesforce CLI 路径是否可用,并返回版本与更新状态（异步线程池执行，避免阻塞主线程）。
#[tauri::command]
pub async fn check_cli_path_status(
    app: tauri::AppHandle,
    cli_path: Option<String>,
) -> Result<CliPathStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let input = cli_path
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
            .or_else(|| read_configured_cli_path(&state))
            .or_else(|| sf_cli::resolve_effective_cli_path(None));
        Ok(sf_cli::check_cli_path_status(input))
    })
    .await
    .map_err(|e| format!("检测 CLI 状态线程失败: {e}"))?
}

/// 自动探测本地可用 CLI 路径,并返回可用于下拉选择的候选项（异步线程池执行，避免阻塞主线程）。
#[tauri::command]
pub async fn detect_local_cli_paths(app: tauri::AppHandle) -> Result<Vec<CliPathProbe>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        let custom = read_configured_cli_path(&state);
        Ok(sf_cli::detect_available_cli_paths(custom))
    })
    .await
    .map_err(|e| format!("探测本地 CLI 路径线程失败: {e}"))?
}

/// 读取 LLM 设置(apiKey 仅返回掩码与是否已配置；优先读取加密的默认 ai_config)。
#[tauri::command]
pub fn get_llm_settings(state: State<'_, AppState>) -> Result<LlmSettingsView, String> {
    let settings = read_llm_settings(&state)?;
    Ok(to_llm_settings_view(&settings))
}

/// 保存 LLM 设置(通过 ai_repo + secret_repo AEAD 加密落盘，不再明文存入 app_settings)。
#[tauri::command]
pub fn save_llm_settings(
    state: State<'_, AppState>,
    payload: SaveLlmSettingsPayload,
) -> Result<LlmSettingsView, String> {
    let base_url = payload.base_url.trim();
    let model = payload.model.trim();
    if base_url.is_empty() {
        return Err("LLM baseUrl 不能为空".to_string());
    }
    if model.is_empty() {
        return Err("LLM model 不能为空".to_string());
    }

    let existing = crate::storage::ai_repo::get_ai_config_with_secret(&state.storage, None)
        .map_err(AppError::to_string_error)?;

    let saved = crate::storage::ai_repo::upsert_ai_config(
        &state.storage,
        crate::storage::ai_repo::AiConfigUpsertPayload {
            id: existing.as_ref().map(|(c, _)| c.id.clone()),
            name: existing
                .as_ref()
                .map(|(c, _)| c.name.clone())
                .unwrap_or_else(|| "默认模型配置".to_string()),
            provider: existing
                .as_ref()
                .map(|(c, _)| c.provider.clone())
                .unwrap_or_else(|| "openai".to_string()),
            api_style: existing.as_ref().map(|(c, _)| c.api_style.clone()),
            base_url: base_url.to_string(),
            model: model.to_string(),
            api_key: payload.api_key,
            timeout_ms: payload.timeout_ms.map(|v| v as i64),
            is_default: Some(true),
        },
    )
    .map_err(AppError::to_string_error)?;

    Ok(LlmSettingsView {
        provider: saved.config.provider,
        base_url: saved.config.base_url,
        model: saved.config.model,
        api_key_configured: saved.api_key_configured,
        api_key_masked: saved.api_key_masked,
        timeout_ms: saved.config.timeout_ms as u64,
    })
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
    crate::ai::provider::cancel_stream(&normalized);
    cancel_llm_stream_by_request_id(&state, &normalized);
    Ok(())
}

#[tauri::command]
pub fn ai_stop_turn(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    stop_llm_stream_generation(state, request_id)
}

#[tauri::command]
pub fn ai_cancel_stream(state: State<'_, AppState>, session_id: String) -> Result<bool, String> {
    let normalized = session_id.trim().to_string();
    if normalized.is_empty() {
        return Ok(false);
    }
    let cancelled = crate::ai::provider::cancel_stream(&normalized);
    cancel_llm_stream_by_request_id(&state, &normalized);
    Ok(cancelled)
}

/// 列出全部加密存储的 AI 模型配置视图。
#[tauri::command]
pub fn ai_list_configs(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::ai_repo::AiConfigView>, String> {
    // 行内注释：首次读取时顺带将历史 app_settings 明文配置迁移到加密 ai_configs，并清理旧明文。
    let _ = migrate_legacy_llm_settings_if_needed(&state);
    crate::storage::ai_repo::list_ai_configs(&state.storage).map_err(AppError::to_string_error)
}

/// 新增或更新 AI 模型配置（apiKey 走 AEAD 加密）。
#[tauri::command]
pub fn ai_save_config(
    state: State<'_, AppState>,
    payload: crate::storage::ai_repo::AiConfigUpsertPayload,
) -> Result<crate::storage::ai_repo::AiConfigView, String> {
    crate::storage::ai_repo::upsert_ai_config(&state.storage, payload)
        .map_err(AppError::to_string_error)
}

/// 删除指定 AI 模型配置。
#[tauri::command]
pub fn ai_delete_config(state: State<'_, AppState>, config_id: String) -> Result<(), String> {
    crate::storage::ai_repo::delete_ai_config(&state.storage, &config_id)
        .map_err(AppError::to_string_error)
}

/// 将指定 AI 配置设为默认。
#[tauri::command]
pub fn ai_set_default_config(state: State<'_, AppState>, config_id: String) -> Result<(), String> {
    crate::storage::ai_repo::set_default_ai_config(&state.storage, &config_id)
        .map_err(AppError::to_string_error)
}

/// 测试指定 AI 模型配置的连通性。
#[tauri::command]
pub async fn ai_test_config_connection(
    state: State<'_, AppState>,
    config_id: String,
) -> Result<crate::ai::provider::AiConnectionTestResult, String> {
    let (config, api_key) =
        crate::storage::ai_repo::get_ai_config_with_secret(&state.storage, Some(&config_id))
            .map_err(AppError::to_string_error)?
            .ok_or_else(|| format!("未找到 AI 配置: {config_id}"))?;
    crate::ai::provider::test_ai_connection(&config, &api_key)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定 AI 配置的远端可用模型列表。
#[tauri::command]
pub async fn ai_list_config_models(
    state: State<'_, AppState>,
    config_id: String,
) -> Result<Vec<String>, String> {
    let (config, api_key) =
        crate::storage::ai_repo::get_ai_config_with_secret(&state.storage, Some(&config_id))
            .map_err(AppError::to_string_error)?
            .ok_or_else(|| format!("未找到 AI 配置: {config_id}"))?;
    crate::ai::provider::list_remote_models(&config, &api_key)
        .await
        .map_err(AppError::to_string_error)
}

/// 启动多轮流式 Agent 对话（通过 `ai-agent-event` 事件流实时推送至前端）。
#[tauri::command]
pub async fn ai_agent_stream(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    request: crate::ai::events::AiAgentStreamRequest,
) -> Result<(), String> {
    let _ = migrate_legacy_llm_settings_if_needed(&state);
    crate::ai::agent_loop::run_agent_stream(app, &state, request).await
}

/// 列出全部持久化的 AI 会话历史。
#[tauri::command]
pub fn ai_list_conversations(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::ai_repo::AiConversationRecord>, String> {
    crate::storage::ai_repo::list_ai_conversations(&state.storage)
        .map_err(AppError::to_string_error)
}

/// 保存或更新单条 AI 会话历史。
#[tauri::command]
pub fn ai_save_conversation(
    state: State<'_, AppState>,
    record: crate::storage::ai_repo::AiConversationRecord,
) -> Result<crate::storage::ai_repo::AiConversationRecord, String> {
    crate::storage::ai_repo::save_ai_conversation(&state.storage, record)
        .map_err(AppError::to_string_error)
}

/// 删除指定 AI 会话历史。
#[tauri::command]
pub fn ai_delete_conversation(
    state: State<'_, AppState>,
    conversation_id: String,
) -> Result<(), String> {
    crate::storage::ai_repo::delete_ai_conversation(&state.storage, &conversation_id)
        .map_err(AppError::to_string_error)
}

/// 列出全部自定义提示词模板。
#[tauri::command]
pub fn ai_list_prompt_templates(
    state: State<'_, AppState>,
) -> Result<Vec<crate::storage::ai_repo::AiPromptTemplateRecord>, String> {
    crate::storage::ai_repo::list_ai_prompt_templates(&state.storage)
        .map_err(AppError::to_string_error)
}

/// 新增或更新自定义提示词模板。
#[tauri::command]
pub fn ai_save_prompt_template(
    state: State<'_, AppState>,
    id: Option<String>,
    name: String,
    category: String,
    content: String,
) -> Result<crate::storage::ai_repo::AiPromptTemplateRecord, String> {
    crate::storage::ai_repo::save_ai_prompt_template(&state.storage, id, name, category, content)
        .map_err(AppError::to_string_error)
}

/// 删除自定义提示词模板。
#[tauri::command]
pub fn ai_delete_prompt_template(
    state: State<'_, AppState>,
    template_id: String,
) -> Result<(), String> {
    crate::storage::ai_repo::delete_ai_prompt_template(&state.storage, &template_id)
        .map_err(AppError::to_string_error)
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

/// 将历史明文 `app_settings["llm.settings.openai"]` 迁移至加密 `ai_configs` 并清理旧明文。
fn migrate_legacy_llm_settings_if_needed(state: &State<'_, AppState>) -> Result<(), AppError> {
    let existing = crate::storage::ai_repo::list_ai_configs(&state.storage)?;
    if !existing.is_empty() {
        return Ok(());
    }
    let raw = state
        .storage
        .read(|connection| db::read_app_setting(connection, LLM_SETTINGS_KEY))?
        .unwrap_or_default();
    if raw.trim().is_empty() {
        return Ok(());
    }
    if let Ok(parsed) = serde_json::from_str::<LlmSettings>(&raw) {
        if !parsed.base_url.trim().is_empty() && !parsed.model.trim().is_empty() {
            crate::storage::ai_repo::upsert_ai_config(
                &state.storage,
                crate::storage::ai_repo::AiConfigUpsertPayload {
                    id: None,
                    name: "默认模型配置".to_string(),
                    provider: if parsed.provider.trim().is_empty() {
                        "openai".to_string()
                    } else {
                        parsed.provider
                    },
                    api_style: None,
                    base_url: parsed.base_url,
                    model: parsed.model,
                    api_key: if parsed.api_key.trim().is_empty() {
                        None
                    } else {
                        Some(parsed.api_key)
                    },
                    timeout_ms: Some(parsed.timeout_ms as i64),
                    is_default: Some(true),
                },
            )?;
            let _ = state
                .storage
                .write(|connection| db::delete_app_setting(connection, LLM_SETTINGS_KEY));
        }
    }
    Ok(())
}

/// 读取 LLM 设置,未配置时返回默认值（优先读取加密 ai_configs）。
fn read_llm_settings(state: &State<'_, AppState>) -> Result<LlmSettings, String> {
    let _ = migrate_legacy_llm_settings_if_needed(state);
    if let Some((cfg, key)) = crate::storage::ai_repo::get_ai_config_with_secret(&state.storage, None)
        .map_err(AppError::to_string_error)?
    {
        return Ok(LlmSettings {
            provider: cfg.provider,
            base_url: cfg.base_url,
            model: cfg.model,
            api_key: key,
            timeout_ms: cfg.timeout_ms as u64,
        });
    }
    Ok(LlmSettings {
        provider: "openai".to_string(),
        base_url: "https://api.openai.com/v1".to_string(),
        model: "gpt-4.1-mini".to_string(),
        api_key: "".to_string(),
        timeout_ms: 60_000,
    })
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

