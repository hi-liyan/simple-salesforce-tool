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

/// 打开认证子窗口(已存在时仅激活并聚焦)。
#[tauri::command]
pub async fn open_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("sf-auth") {
        set_main_window_enabled(&app, false);
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    set_main_window_enabled(&app, false);

    let mut builder = tauri::WebviewWindowBuilder::new(
        &app,
        "sf-auth",
        tauri::WebviewUrl::App("index.html".into()),
    )
    // 认证窗口标题：Linux 使用英文避免系统标题栏缺字导致方框。
    .title(resolve_window_title("Salesforce 登录", "Salesforce Login"))
    .inner_size(480.0, 360.0)
    .resizable(false)
    .focused(true)
    .skip_taskbar(false)
    .center()
    .visible(true);

    if let Some(main_window) = app.get_webview_window("main") {
        builder = builder
            .parent(&main_window)
            .map_err(|error| error.to_string())?;
    }

    let auth_window = match builder.build() {
        Ok(window) => window,
        Err(error) => {
            set_main_window_enabled(&app, true);
            return Err(error.to_string());
        }
    };

    if let Some(main_window) = app.get_webview_window("main") {
        let app_handle = app.clone();
        main_window.on_window_event(move |event| {
            if let tauri::WindowEvent::Focused(true) = event {
                if let Some(auth) = app_handle.get_webview_window("sf-auth") {
                    let _ = auth.show();
                    let _ = auth.set_focus();
                }
            }
        });
    }

    let app_handle = app.clone();
    auth_window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
            {
                let state = app_handle.state::<AppState>();
                cancel_cli_login_if_running(&state);
                clear_cli_login_cancel_token(&state);
            }
            set_main_window_enabled(&app_handle, true);
            if let Some(main_window) = app_handle.get_webview_window("main") {
                let _ = main_window.set_focus();
            }
        }
    });

    Ok(())
}

/// 关闭认证子窗口。
#[tauri::command]
pub fn close_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    {
        let state = app.state::<AppState>();
        cancel_cli_login_if_running(&state);
        clear_cli_login_cancel_token(&state);
    }
    if let Some(window) = app.get_webview_window("sf-auth") {
        window.close().map_err(|error| error.to_string())?;
    }
    set_main_window_enabled(&app, true);
    Ok(())
}

/// 调用 tauri-plugin-opener 打开 URL（跨平台：Windows/macOS/Linux）。
pub(super) fn open_url_with_system_browser(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
    app.opener()
        .open_url(url, None::<&str>)
        .map_err(|error| error.to_string())
}

/// 打开外部 URL(系统默认浏览器)。
#[tauri::command]
pub fn open_external_url(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    url: String,
) -> Result<(), String> {
    let normalized_url = url.trim().to_string();
    if normalized_url.is_empty() {
        return Err("URL 不能为空".to_string());
    }

    let parsed_url =
        reqwest::Url::parse(&normalized_url).map_err(|error| format!("URL 格式不正确: {error}"))?;
    // 仅允许网页协议，避免误执行本地协议。
    if !matches!(parsed_url.scheme(), "http" | "https") {
        return Err("仅支持 http/https 链接".to_string());
    }

    if let Err(detail) = open_url_with_system_browser(&app, parsed_url.as_str()) {
        write_system_log(
            &state,
            "ERROR",
            "SYSTEM",
            "open_external_url",
            None,
            Some(parsed_url.as_str()),
            false,
            "调用系统浏览器打开外部链接失败。",
            Some(&detail),
        );
        return Err(format!("打开外部链接失败: {detail}"));
    }

    write_system_log(
        &state,
        "INFO",
        "SYSTEM",
        "open_external_url",
        None,
        Some(parsed_url.as_str()),
        true,
        "已调用系统默认浏览器打开外部链接。",
        None,
    );
    Ok(())
}

#[derive(Clone, Serialize)]
struct FieldMetaWindowPayload {
    /// 字段 API 名称。
    field_name: String,
    /// 字段完整元数据。
    metadata: HashMap<String, serde_json::Value>,
}

/// 打开字段元数据窗口,并向目标窗口发送当前字段 payload。
#[tauri::command]
pub async fn open_field_meta_window(
    app: tauri::AppHandle,
    field_name: String,
    metadata: HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let payload = FieldMetaWindowPayload {
        field_name: field_name.clone(),
        metadata,
    };

    if let Some(window) = app.get_webview_window("sf-field-meta") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        app.emit_to("sf-field-meta", "sf:field-meta-open", payload)
            .map_err(|error| error.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(
        &app,
        "sf-field-meta",
        tauri::WebviewUrl::App("index.html".into()),
    )
    // 字段元数据窗口标题：Linux 下改用英文后缀，避免系统标题栏中文方框。
    .title(if cfg!(target_os = "linux") {
        format!("Field Metadata - {field_name}")
    } else {
        format!("{field_name} 字段元数据")
    })
    .inner_size(860.0, 620.0)
    .resizable(true)
    .build()
    .map_err(|error| error.to_string())?;

    app.emit_to("sf-field-meta", "sf:field-meta-open", payload.clone())
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        // 新窗口刚创建时可能尚未完成事件订阅,延迟重发一次确保前端能收到。
        std::thread::sleep(std::time::Duration::from_millis(220));
        let _ = app_handle.emit_to("sf-field-meta", "sf:field-meta-open", payload);
    });

    Ok(())
}

/// 分页查询系统日志(倒序，异步线程池执行)。
#[tauri::command]
pub async fn list_system_logs(
    app: tauri::AppHandle,
    page: i64,
    page_size: i64,
) -> Result<SystemLogPage, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .read(|connection| db::list_system_logs(connection, page, page_size))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("查询系统日志线程失败: {e}"))?
}


/// 读取结构化工作区快照。
#[tauri::command]
pub fn load_workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshotDto, String> {
    state
        .storage
        .read(|connection| db::load_workspace_snapshot(connection))
        .map_err(AppError::to_string_error)
}

/// 保存结构化工作区快照。
#[tauri::command]
pub fn save_workspace_snapshot(
    state: State<'_, AppState>,
    payload: WorkspaceSnapshotDto,
) -> Result<(), String> {
    state
        .storage
        .write(|connection| db::save_workspace_snapshot(connection, &payload))
        .map_err(AppError::to_string_error)
}

/// 读取对象字段可见性配置。
#[tauri::command]
pub fn get_column_visibility(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<HashMap<String, bool>, String> {
    let visibility = state
        .storage
        .read(|connection| db::read_column_visibility(connection, &source_id, &object_name))
        .map_err(AppError::to_string_error)?;
    Ok(visibility.unwrap_or_default())
}

/// 保存对象字段可见性配置。
#[tauri::command]
pub fn save_column_visibility(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    visibility: HashMap<String, bool>,
) -> Result<(), String> {
    state
        .storage
        .write(|connection| db::write_column_visibility(connection, &source_id, &object_name, &visibility))
        .map_err(AppError::to_string_error)
}


#[tauri::command]
pub async fn open_object_list_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<(), String> {
    let normalized_object_name = object_name.trim().to_string();
    if normalized_object_name.is_empty() {
        return Err("Object 名称不能为空".to_string());
    }

    let object_segment = urlencoding::encode(&normalized_object_name);
    let list_path = format!("/lightning/o/{object_segment}/list");

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;

    open_salesforce_page(
        &app,
        &state,
        &source_id,
        &source,
        &list_path,
        "open_object_list_page",
        Some(&normalized_object_name),
    )
    .await
}

/// 打开 Salesforce Object 管理页(快速校验 token 后直接打开浏览器)。
#[tauri::command]
pub async fn open_object_edit_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<(), String> {
    let normalized_object_name = object_name.trim().to_string();
    if normalized_object_name.is_empty() {
        return Err("Object 名称不能为空".to_string());
    }

    let object_segment = urlencoding::encode(&normalized_object_name);
    let edit_path = format!("/lightning/setup/ObjectManager/{object_segment}/Details/view");

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;

    open_salesforce_page(
        &app,
        &state,
        &source_id,
        &source,
        &edit_path,
        "open_object_edit_page",
        Some(&normalized_object_name),
    )
    .await
}

/// 打开 Salesforce 记录详情页(快速校验 token 后直接打开浏览器)。
#[tauri::command]
pub async fn open_record_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    record_id: String,
) -> Result<(), String> {
    let normalized_object_name = object_name.trim().to_string();
    if normalized_object_name.is_empty() {
        return Err("Object 名称不能为空".to_string());
    }
    let normalized_record_id = record_id.trim().to_string();
    if normalized_record_id.is_empty() {
        return Err("记录 Id 不能为空".to_string());
    }

    let object_segment = urlencoding::encode(&normalized_object_name);
    let record_segment = urlencoding::encode(&normalized_record_id);
    let record_path = format!("/lightning/r/{object_segment}/{record_segment}/view");

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;

    open_salesforce_page(
        &app,
        &state,
        &source_id,
        &source,
        &record_path,
        "open_record_page",
        Some(&normalized_record_id),
    )
    .await
}

/// 读取对象字段元数据(Describe)。
/// 读取对象 describe,并在 CLI 数据源 401 时自动刷新 token 后重试。
pub(super) async fn load_object_describe_with_auto_refresh(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    source: &mut SalesforceSource,
    object_name: &str,
    action: &str,
) -> Result<ObjectDescribe, AppError> {
    let provider = provider_for_source(state.inner(), source)?;
    match provider.describe_object(source, object_name).await {
        Ok(describe) => Ok(describe),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(app, state, source_id, action, Some(object_name)).await?;
            // 刷新成功后覆盖当前 source,确保后续父对象 describe 复用最新 token。
            *source = refreshed_source.clone();
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)?;
            refreshed_provider
                .describe_object(&refreshed_source, object_name)
                .await
        }
        Err(error) => Err(error),
    }
}

/// 在后端补齐 reference 字段 childRelationshipName,前端仅负责展示。
pub(super) async fn hydrate_reference_field_child_relationship_names(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    source: &mut SalesforceSource,
    describe: &mut ObjectDescribe,
) -> Result<(), AppError> {
    let current_object_name = describe.name.trim().to_string();
    let mut parent_describe_cache: HashMap<String, ObjectDescribe> = HashMap::new();

    for field in describe.fields.iter_mut() {
        if !field.data_type.eq_ignore_ascii_case("reference") {
            continue;
        }
        let current_field_name = field.name.trim().to_string();

        // 使用当前字段 referenceTo 作为父对象候选。
        let reference_to_object_names = field
            .metadata
            .get("referenceTo")
            .and_then(|value| value.as_array())
            .map(|items| {
                items
                    .iter()
                    .filter_map(|item| item.as_str())
                    .map(|item| item.trim().to_string())
                    .filter(|item| !item.is_empty())
                    .collect::<Vec<_>>()
            })
            .unwrap_or_default();

        let mut relationship_names: Vec<String> = Vec::new();
        let mut seen_relationship_names: HashSet<String> = HashSet::new();

        for parent_object_name in &reference_to_object_names {
            if !parent_describe_cache.contains_key(parent_object_name) {
                match load_object_describe_with_auto_refresh(
                    app,
                    state,
                    source_id,
                    source,
                    parent_object_name,
                    "describe_object_parent",
                )
                .await
                {
                    Ok(parent_describe) => {
                        parent_describe_cache.insert(parent_object_name.clone(), parent_describe);
                    }
                    Err(_) => {
                        continue;
                    }
                }
            }

            if let Some(parent_describe) = parent_describe_cache.get(parent_object_name) {
                for child in parent_describe.child_relationships.iter() {
                    if child.deprecated_and_hidden {
                        continue;
                    }
                    // 严格匹配:childSObject 必须等于当前对象名。
                    if child.child_sobject.trim() != current_object_name {
                        continue;
                    }
                    // 严格匹配:field 必须等于当前字段名。
                    if child.field.trim() != current_field_name {
                        continue;
                    }
                    let relationship_name = child.relationship_name.trim();
                    if relationship_name.is_empty() {
                        continue;
                    }
                    if seen_relationship_names.insert(relationship_name.to_string()) {
                        relationship_names.push(relationship_name.to_string());
                    }
                }
            }
        }

        // 统一回写到字段元数据,前端直接展示该值。
        field.metadata.insert(
            "childRelationshipName".to_string(),
            serde_json::Value::String(relationship_names.join(", ")),
        );
    }
    Ok(())
}
