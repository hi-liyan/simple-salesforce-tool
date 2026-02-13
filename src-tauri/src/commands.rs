use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde::Serialize;
use tauri::Emitter;
use tauri::State;
use tauri::Manager;

use crate::app_state::AppState;
use crate::db;
use crate::error::AppError;
use crate::llm::{openai_chat_json, openai_chat_json_stream, LlmChatMessage, LlmChatRole};
use crate::models::{
    CliPathProbe, CliPathSettings, CliPathStatus, LlmSettings, LlmSettingsView, ObjectDescribe, QueryResult,
    RecordMutationPayload, RecordSavePayload, SalesforceObject, SalesforceSource, SaveLlmSettingsPayload,
    SoqlConversationRequest, SoqlConversationResponse, SourceUpsertPayload, SystemLogPage,
};
use crate::sf_cli;

/// 写系统日志的统一入口。
/// 说明：日志写入失败不应影响主流程，因此这里吞掉错误。
fn write_system_log(
    state: &State<'_, AppState>,
    level: &str,
    category: &str,
    action: &str,
    source_id: Option<&str>,
    target: Option<&str>,
    success: bool,
    message: &str,
    detail: Option<&str>,
) {
    if let Ok(connection) = state.db.lock() {
        let _ = db::insert_system_log(
            &connection,
            level,
            category,
            action,
            source_id,
            target,
            success,
            message,
            detail,
        );
    }
}

const SF_CLI_PATH_SETTING_KEY: &str = "sf_cli_path";
const LLM_SETTINGS_KEY: &str = "llm.settings.openai";

/// 读取已配置的自定义 Salesforce CLI 路径。
fn read_configured_cli_path(state: &State<'_, AppState>) -> Option<String> {
    let connection = state.db.lock().ok()?;
    db::read_app_setting(&connection, SF_CLI_PATH_SETTING_KEY)
        .ok()
        .flatten()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

fn set_main_window_enabled(app: &tauri::AppHandle, enabled: bool) {
    // macOS 下禁用父窗口后，子窗口（parent 关系）可能也出现不可交互问题。
    // 仅在 macOS 跳过 set_enabled，避免主窗口和登录窗口同时“失焦/不可点击”。
    if cfg!(target_os = "macos") {
        return;
    }
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_enabled(enabled);
    }
}

fn create_cli_login_cancel_token(state: &State<'_, AppState>) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = state.cli_login_cancel.lock() {
        *slot = Some(token.clone());
    }
    token
}

fn cancel_cli_login_if_running(state: &State<'_, AppState>) {
    if let Ok(slot) = state.cli_login_cancel.lock() {
        if let Some(token) = slot.as_ref() {
            token.store(true, Ordering::Relaxed);
        }
    }
}

fn clear_cli_login_cancel_token(state: &State<'_, AppState>) {
    if let Ok(mut slot) = state.cli_login_cancel.lock() {
        *slot = None;
    }
}

fn set_llm_stream_cancel_token(state: &State<'_, AppState>, request_id: &str, token: Arc<AtomicBool>) {
    if let Ok(mut map) = state.llm_stream_cancels.lock() {
        map.insert(request_id.to_string(), token);
    }
}

fn cancel_llm_stream_by_request_id(state: &State<'_, AppState>, request_id: &str) {
    if let Ok(map) = state.llm_stream_cancels.lock() {
        if let Some(token) = map.get(request_id) {
            token.store(true, Ordering::Relaxed);
        }
    }
}

fn clear_llm_stream_cancel_token(state: &State<'_, AppState>, request_id: &str) {
    if let Ok(mut map) = state.llm_stream_cancels.lock() {
        map.remove(request_id);
    }
}
fn is_unauthorized_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Http(message)
            if message.contains("状态码 401")
                || message.contains("status code 401")
                || message.contains("401 Unauthorized")
    )
}

/// 判断流式输出是否出现可重试的传输层解码错误。
fn is_retryable_stream_decode_error(error: &AppError) -> bool {
    match error {
        AppError::Http(message) => {
            let normalized = message.to_lowercase();
            normalized.contains("读取 openai 流式响应失败")
                || normalized.contains("error decoding response body")
                || normalized.contains("connection reset")
                || normalized.contains("incomplete message")
        }
        _ => false,
    }
}

/// 仅针对 CLI 数据源：发生 401 后通过 CLI 刷新 token，并回写本地数据源。
async fn refresh_cli_source_token(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    action: &str,
    target: Option<&str>,
) -> Result<SalesforceSource, AppError> {
    let _ = app.emit_to(
        "main",
        "sf:token-refresh-start",
        serde_json::json!({ "sourceId": source_id, "action": action }),
    );
    write_system_log(
        state,
        "INFO",
        "SALESFORCE_CLI",
        action,
        Some(source_id),
        target,
        true,
        "检测到 401，开始通过 CLI 刷新 token。",
        None,
    );

    let result = async {
        let source_id_owned = source_id.to_string();
        let preferred_cli_path = read_configured_cli_path(state);
        let refreshed_seed = tauri::async_runtime::spawn_blocking(move || {
            sf_cli::refresh_cli_source_by_id(&source_id_owned, preferred_cli_path.as_deref())
        })
        .await
        .map_err(|error| AppError::Biz(format!("CLI 刷新线程失败: {error}")))??;

        let refreshed_source = {
            let connection = state
                .db
                .lock()
                .map_err(|error| AppError::Db(format!("Database lock failed: {error}")))?;
            db::upsert_source_with_id(&connection, &refreshed_seed.id, refreshed_seed.payload)?
        };

        write_system_log(
            state,
            "INFO",
            "SALESFORCE_CLI",
            action,
            Some(source_id),
            target,
            true,
            "通过 CLI 刷新 token 成功，准备重试请求。",
            None,
        );

        Ok::<SalesforceSource, AppError>(refreshed_source)
    }
    .await;

    if let Err(error) = &result {
        let detail = error.to_string();
        write_system_log(
            state,
            "ERROR",
            "SALESFORCE_CLI",
            action,
            Some(source_id),
            target,
            false,
            "通过 CLI 刷新 token 失败。",
            Some(&detail),
        );
    }

    let _ = app.emit_to(
        "main",
        "sf:token-refresh-end",
        serde_json::json!({ "sourceId": source_id, "action": action, "success": result.is_ok() }),
    );

    result
}

/// 查询全部数据源列表。
#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::list_sources(&connection).map_err(AppError::to_string_error)
}

/// 从 Salesforce CLI 同步认证账号到本地 SQLite。
#[tauri::command]
pub fn sync_cli_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
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
    let sources = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;

        // 逐条 upsert，保证同一个 org 重复同步只更新不新增。
        for seed in seeds {
            db::upsert_source_with_id(&connection, &seed.id, seed.payload)
                .map_err(AppError::to_string_error)?;
        }
        // 清理本次同步不存在的旧 cli-* 数据源及其缓存。
        db::prune_cli_sources(&connection, &keep_ids).map_err(AppError::to_string_error)?;
        db::list_sources(&connection).map_err(AppError::to_string_error)?
    };

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_CLI",
        "sync_cli_sources",
        None,
        None,
        true,
        &format!("同步 Salesforce CLI 数据源成功，共 {} 个。", sources.len()),
        None,
    );
    Ok(sources)
}

/// 调用 CLI 打开网页登录流程，登录成功后返回 orgId。
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

    // CLI 命令会阻塞，放入 blocking 线程池避免卡住 async runtime。
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

/// 打开认证子窗口（已存在时仅激活并聚焦）。
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
        .title("Salesforce 登录")
        .inner_size(480.0, 360.0)
        .resizable(false)
        .focused(true)
        .skip_taskbar(false)
        .center()
        .visible(true);

    if let Some(main_window) = app.get_webview_window("main") {
        builder = builder.parent(&main_window).map_err(|error| error.to_string())?;
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

#[derive(Clone, Serialize)]
struct FieldMetaWindowPayload {
    /// 字段 API 名称。
    field_name: String,
    /// 字段完整元数据。
    metadata: HashMap<String, serde_json::Value>,
}

/// 打开字段元数据窗口，并向目标窗口发送当前字段 payload。
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
    .title(format!("{field_name} 字段元数据"))
    .inner_size(860.0, 620.0)
    .resizable(true)
    .build()
    .map_err(|error| error.to_string())?;

    app.emit_to("sf-field-meta", "sf:field-meta-open", payload.clone())
        .map_err(|error| error.to_string())?;

    let app_handle = app.clone();
    std::thread::spawn(move || {
        // 新窗口刚创建时可能尚未完成事件订阅，延迟重发一次确保前端能收到。
        std::thread::sleep(std::time::Duration::from_millis(220));
        let _ = app_handle.emit_to("sf-field-meta", "sf:field-meta-open", payload);
    });

    Ok(())
}

/// 分页查询系统日志（倒序）。
#[tauri::command]
pub fn list_system_logs(
    state: State<'_, AppState>,
    page: i64,
    page_size: i64,
) -> Result<SystemLogPage, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::list_system_logs(&connection, page, page_size).map_err(AppError::to_string_error)
}


/// 新建数据源。
#[tauri::command]
pub fn create_source(
    state: State<'_, AppState>,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, String> {
    validate_payload(&payload)?;
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::create_source(&connection, payload).map_err(AppError::to_string_error)
}

/// 更新数据源。
#[tauri::command]
pub fn update_source(
    state: State<'_, AppState>,
    id: String,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, String> {
    validate_payload(&payload)?;
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::update_source(&connection, &id, payload).map_err(AppError::to_string_error)
}

/// 删除数据源。
#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::delete_source(&connection, &id).map_err(AppError::to_string_error)
}

/// 读取对象字段可见性配置。
#[tauri::command]
pub fn get_column_visibility(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<HashMap<String, bool>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    let visibility = db::read_column_visibility(&connection, &source_id, &object_name)
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
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::write_column_visibility(&connection, &source_id, &object_name, &visibility)
        .map_err(AppError::to_string_error)
}

/// 读取对象列表（优先走缓存，缓存失效后再请求 Salesforce）。
#[tauri::command]
pub async fn list_objects(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let cached_objects = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::read_object_cache(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    if let Some(cached) = cached_objects {
        write_system_log(
            &state,
            "INFO",
            "SALESFORCE_API",
            "list_objects",
            Some(&source_id),
            None,
            true,
            &format!("命中对象缓存，共 {} 个。", cached.len()),
            None,
        );
        return Ok(cached);
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let objects_result = match state.sf_client.list_objects(&source).await {
        Ok(items) => Ok(items),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(&app, &state, &source_id, "list_objects", None)
                .await
                .map_err(AppError::to_string_error)?;
            state.sf_client.list_objects(&refreshed_source).await
        }
        Err(error) => Err(error),
    };

    let objects = match objects_result {
        Ok(items) => items,
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "list_objects",
                Some(&source_id),
                None,
                false,
                "拉取对象列表失败。",
                Some(&message),
            );
            return Err(message);
        }
    };

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        // 请求成功后写入缓存，后续短时间内避免重复调用远端接口。
        db::write_object_cache(&connection, &source_id, &objects)
            .map_err(AppError::to_string_error)?;
    }

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_API",
        "list_objects",
        Some(&source_id),
        None,
        true,
        &format!("拉取对象列表成功，共 {} 个。", objects.len()),
        None,
    );

    Ok(objects)
}

/// 获取 Salesforce CLI 路径配置与自动探测结果。
#[tauri::command]
pub fn get_cli_path_settings(state: State<'_, AppState>) -> Result<CliPathSettings, String> {
    let custom = read_configured_cli_path(&state);
    Ok(sf_cli::read_cli_path_settings(custom))
}

/// 保存 Salesforce CLI 自定义路径（传空会清除配置）。
#[tauri::command]
pub fn save_cli_path_settings(
    state: State<'_, AppState>,
    custom_cli_path: Option<String>,
) -> Result<CliPathSettings, String> {
    let normalized = custom_cli_path
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        if let Some(path) = normalized.as_ref() {
            db::write_app_setting(&connection, SF_CLI_PATH_SETTING_KEY, path)
                .map_err(AppError::to_string_error)?;
        } else {
            db::delete_app_setting(&connection, SF_CLI_PATH_SETTING_KEY)
                .map_err(AppError::to_string_error)?;
        }
    }

    Ok(sf_cli::read_cli_path_settings(normalized))
}

/// 检测指定 Salesforce CLI 路径是否可用，并返回版本与更新状态。
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

/// 自动探测本地可用 CLI 路径，并返回可用于下拉选择的候选项。
#[tauri::command]
pub fn detect_local_cli_paths(state: State<'_, AppState>) -> Result<Vec<CliPathProbe>, String> {
    let custom = read_configured_cli_path(&state);
    Ok(sf_cli::detect_available_cli_paths(custom))
}

/// 读取 LLM 设置（apiKey 仅返回掩码与是否已配置）。
#[tauri::command]
pub fn get_llm_settings(state: State<'_, AppState>) -> Result<LlmSettingsView, String> {
    let settings = read_llm_settings(&state)?;
    Ok(to_llm_settings_view(&settings))
}

/// 保存 LLM 设置（apiKey 采用覆盖保存策略）。
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

    // 仅当用户输入了新值时覆盖 apiKey，空字符串视为不覆盖。
    if let Some(next_key) = payload.api_key {
        let trimmed = next_key.trim();
        if !trimmed.is_empty() {
            current.api_key = trimmed.to_string();
        }
    }

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        let raw = serde_json::to_string(&current).map_err(|error| AppError::to_string_error(error.into()))?;
        db::write_app_setting(&connection, LLM_SETTINGS_KEY, &raw).map_err(AppError::to_string_error)?;
    }

    Ok(to_llm_settings_view(&current))
}

/// 停止指定 requestId 的 LLM 流式生成。
#[tauri::command]
pub fn stop_llm_stream_generation(state: State<'_, AppState>, request_id: String) -> Result<(), String> {
    let normalized = request_id.trim().to_string();
    if normalized.is_empty() {
        return Err("requestId 不能为空".to_string());
    }
    cancel_llm_stream_by_request_id(&state, &normalized);
    Ok(())
}

/// 基于多轮对话生成 SOQL（仅允许读取 Salesforce 元数据，不允许触达数据接口）。
#[tauri::command]
pub async fn generate_soql_from_conversation(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: SoqlConversationRequest,
) -> Result<SoqlConversationResponse, String> {
    let user_message = payload.user_message.trim().to_string();
    if user_message.is_empty() {
        return Err("用户输入不能为空".to_string());
    }

    let llm_settings = read_llm_settings(&state)?;
    if llm_settings.api_key.trim().is_empty() {
        return Err("LLM apiKey 未配置，请先到设置页保存。".to_string());
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };
    // 对话模式与生成模式分流：只有命中“生成 SOQL”意图才走自动生成兜底。
    let generate_mode = should_generate_soql(&user_message);

    // 元数据阶段仅调用对象列表与字段 describe，严格禁止 query/data 写入接口。
    let all_objects = match state.sf_client.list_objects(&source).await {
        Ok(items) => items.into_iter().filter(|item| item.queryable).collect::<Vec<_>>(),
        Err(error) if is_unauthorized_error(&error) && payload.source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &payload.source_id,
                "generate_soql_from_conversation",
                None,
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .list_objects(&refreshed_source)
                .await
                .map_err(AppError::to_string_error)?
                .into_iter()
                .filter(|item| item.queryable)
                .collect::<Vec<_>>()
        }
        Err(error) => return Err(AppError::to_string_error(error)),
    };

    let candidate_objects = pick_candidate_objects(
        &all_objects,
        &user_message,
        payload.context_object_hint.as_deref(),
    );

    let object_name_map = all_objects
        .iter()
        .map(|item| (item.name.to_lowercase(), item.name.clone()))
        .collect::<HashMap<_, _>>();
    let mut object_metadata_map: HashMap<String, LlmObjectMetadataSummary> = HashMap::new();
    let mut described_set: HashSet<String> = HashSet::new();
    let mut describe_queue = candidate_objects
        .iter()
        .take(6)
        .cloned()
        .collect::<Vec<_>>();

    // 按候选对象逐步 describe，并把父引用对象加入队列，补齐子查询推导所需关系元数据。
    while let Some(next_object_name) = describe_queue.pop() {
        let normalized_name = next_object_name.to_lowercase();
        if described_set.contains(&normalized_name) {
            continue;
        }
        described_set.insert(normalized_name);

        let describe = match state.sf_client.describe_object(&source, &next_object_name).await {
            Ok(item) => item,
            Err(error) if is_unauthorized_error(&error) && payload.source_id.starts_with("cli-") => {
                let refreshed_source = refresh_cli_source_token(
                    &app,
                    &state,
                    &payload.source_id,
                    "generate_soql_from_conversation",
                    Some(&next_object_name),
                )
                .await
                .map_err(AppError::to_string_error)?;
                state
                    .sf_client
                    .describe_object(&refreshed_source, &next_object_name)
                    .await
                    .map_err(AppError::to_string_error)?
            }
            Err(_) => continue, // 个别对象 describe 失败时忽略，不阻塞整体生成流程。
        };

        let summary = build_object_metadata_summary(&describe);
        for reference in summary.reference_fields.iter() {
            for reference_to in reference.reference_to.iter() {
                let lookup_key = reference_to.to_lowercase();
                if let Some(canonical_name) = object_name_map.get(&lookup_key) {
                    let canonical_lower = canonical_name.to_lowercase();
                    if described_set.contains(&canonical_lower) {
                        continue;
                    }
                    if object_metadata_map.len() + describe_queue.len() >= 12 {
                        continue;
                    }
                    if !describe_queue
                        .iter()
                        .any(|item| item.eq_ignore_ascii_case(canonical_name))
                    {
                        describe_queue.push(canonical_name.clone());
                    }
                }
            }
        }

        object_metadata_map.insert(summary.object_name.clone(), summary);
        if object_metadata_map.len() >= 12 {
            break;
        }
    }

    let conversation_id = payload
        .conversation_id
        .filter(|item| !item.trim().is_empty())
        .unwrap_or_else(|| format!("conv-{}", uuid::Uuid::new_v4()));

    let mut history = {
        let map = state
            .llm_conversations
            .lock()
            .map_err(|error| format!("LLM 会话锁失败: {error}"))?;
        map.get(&conversation_id).cloned().unwrap_or_default()
    };
    history.push(LlmChatMessage {
        role: LlmChatRole::User,
        content: user_message.clone(),
    });

    let prompt_messages = build_llm_messages(
        &history,
        &all_objects,
        &object_metadata_map,
        payload.context_object_hint.as_deref(),
        generate_mode,
    );
    let stream_request_id = payload
        .stream_request_id
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty());
    let llm_raw = call_llm_with_optional_stream(
        &app,
        &state,
        &llm_settings,
        &prompt_messages,
        stream_request_id,
    )
    .await?;
    let mut parsed = parse_llm_soql_payload(&llm_raw);

    // 生成模式下若首轮未产出 SOQL，则自动做一次修复重试（不走流式，避免重复事件）。
    if generate_mode && parsed.soql.is_none() {
        let mut repair_messages = prompt_messages.clone();
        repair_messages.push(LlmChatMessage {
            role: LlmChatRole::System,
            content: "上一轮未产出可用 soql。请基于已有上下文修复，必须返回 mode=generate 且提供非空 soql；若确实无法生成则返回 mode=clarify 并给出最小问题列表。".to_string(),
        });
        if let Ok(retry_raw) = call_llm_with_optional_stream(
            &app,
            &state,
            &llm_settings,
            &repair_messages,
            None,
        )
        .await
        {
            let retried = parse_llm_soql_payload(&retry_raw);
            if retried.soql.is_some() || retried.mode == "clarify" {
                parsed = retried;
            }
        }
    }

    let response = if generate_mode {
        if let Some(soql) = parsed.soql.clone().filter(|item| !item.trim().is_empty()) {
            SoqlConversationResponse {
                conversation_id: conversation_id.clone(),
                mode: "generate".to_string(),
                status: "ready".to_string(),
                questions: vec![],
                soql: Some(soql),
                object_name: parsed.object_name.clone(),
                field_names: parsed.field_names.clone(),
                reason: if parsed.reason.trim().is_empty() {
                    "已按当前需求生成 SOQL。".to_string()
                } else {
                    parsed.reason.clone()
                },
                answer: parsed.answer.clone(),
            }
        } else {
            SoqlConversationResponse {
                conversation_id: conversation_id.clone(),
                mode: "clarify".to_string(),
                status: "clarify".to_string(),
                questions: if parsed.questions.is_empty() {
                    fallback_questions()
                } else {
                    parsed.questions.clone()
                },
                soql: None,
                object_name: parsed.object_name.clone(),
                field_names: parsed.field_names.clone(),
                reason: if parsed.reason.trim().is_empty() {
                    "当前信息仍不足以生成 SOQL，请按问题补充。".to_string()
                } else {
                    parsed.reason.clone()
                },
                answer: parsed.answer.clone(),
            }
        }
    } else if parsed.mode == "clarify" && !parsed.questions.is_empty() {
        SoqlConversationResponse {
            conversation_id: conversation_id.clone(),
            mode: "clarify".to_string(),
            status: "clarify".to_string(),
            questions: parsed.questions.clone(),
            soql: None,
            object_name: parsed.object_name.clone(),
            field_names: parsed.field_names.clone(),
            reason: parsed.reason.clone(),
            answer: parsed.answer.clone(),
        }
    } else {
        SoqlConversationResponse {
            conversation_id: conversation_id.clone(),
            mode: "answer".to_string(),
            status: "clarify".to_string(),
            questions: vec![],
            soql: None,
            object_name: parsed.object_name.clone(),
            field_names: parsed.field_names.clone(),
            reason: if parsed.reason.trim().is_empty() {
                "已按对话模式回答。若需要，请继续明确“生成 SOQL”。".to_string()
            } else {
                parsed.reason.clone()
            },
            answer: parsed.answer.clone(),
        }
    };

    history.push(LlmChatMessage {
        role: LlmChatRole::Assistant,
        content: serde_json::to_string(&response).unwrap_or_else(|_| "{}".to_string()),
    });
    compress_history_in_place(&mut history, 140_000); // 超上下文阈值时改为摘要压缩，而不是直接截断。
    {
        let mut map = state
            .llm_conversations
            .lock()
            .map_err(|error| format!("LLM 会话锁失败: {error}"))?;
        map.insert(conversation_id.clone(), history);
    }

    write_system_log(
        &state,
        "INFO",
        "LLM_SOQL",
        "generate_soql_from_conversation",
        Some(&payload.source_id),
        None,
        true,
        "SOQL 生成完成（仅元数据链路）。",
        Some(&format!("conversationId={conversation_id}, status={}", response.status)),
    );

    Ok(response)
}

/// 强制刷新对象列表（跳过缓存，直接请求 Salesforce API 并回写缓存）。
#[tauri::command]
pub async fn refresh_objects(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let objects_result = match state.sf_client.list_objects(&source).await {
        Ok(items) => Ok(items),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(&app, &state, &source_id, "refresh_objects", None)
                .await
                .map_err(AppError::to_string_error)?;
            state.sf_client.list_objects(&refreshed_source).await
        }
        Err(error) => Err(error),
    };

    let objects = match objects_result {
        Ok(items) => items,
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "refresh_objects",
                Some(&source_id),
                None,
                false,
                "强制刷新对象列表失败。",
                Some(&message),
            );
            return Err(message);
        }
    };

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        // 强制刷新成功后覆盖缓存，保证后续列表读取为最新远端快照。
        db::write_object_cache(&connection, &source_id, &objects)
            .map_err(AppError::to_string_error)?;
    }

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_API",
        "refresh_objects",
        Some(&source_id),
        None,
        true,
        &format!("强制刷新对象列表成功，共 {} 个。", objects.len()),
        None,
    );

    Ok(objects)
}

/// 打开 Salesforce 对象列表页（混合方案：CLI 数据源优先走 CLI，非 CLI 走 frontdoor URL）。
#[tauri::command]
pub async fn open_object_list_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<Option<String>, String> {
    let normalized_object_name = object_name.trim().to_string();
    if normalized_object_name.is_empty() {
        return Err("Object 名称不能为空".to_string());
    }

    let object_segment = urlencoding::encode(&normalized_object_name);
    let list_path = format!("/lightning/o/{object_segment}/list");

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    // CLI 数据源：后端直接调用 CLI 打开系统浏览器。
    if source_id.starts_with("cli-") {
        let source_id_cloned = source_id.clone();
        let list_path_cloned = list_path.clone();
        let preferred_cli_path = read_configured_cli_path(&state);
        let cli_open_result = tauri::async_runtime::spawn_blocking(move || {
            sf_cli::open_org_path(
                &source_id_cloned,
                &list_path_cloned,
                preferred_cli_path.as_deref(),
            )
        })
        .await
        .map_err(|error| format!("打开 Salesforce 页面线程失败: {error}"));

        match cli_open_result {
            Ok(Ok(())) => {
                write_system_log(
                    &state,
                    "INFO",
                    "SALESFORCE_CLI",
                    "open_object_list_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    true,
                    "已通过 Salesforce CLI 打开对象列表页。",
                    None,
                );
                return Ok(None);
            }
            Ok(Err(error)) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_list_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "通过 Salesforce CLI 打开对象列表页失败，回退 frontdoor URL。",
                    Some(&detail),
                );
            }
            Err(error) => {
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_list_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "通过 Salesforce CLI 打开对象列表页线程失败，回退 frontdoor URL。",
                    Some(&error),
                );
            }
        }
    }

    // 回退策略：构建 frontdoor URL，交由前端打开（仍可自动带登录态）。
    let effective_source = if source_id.starts_with("cli-") {
        match refresh_cli_source_token(
            &app,
            &state,
            &source_id,
            "open_object_list_page",
            Some(&normalized_object_name),
        )
        .await
        {
            Ok(refreshed) => refreshed,
            Err(error) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_list_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "刷新 token 失败，回退使用本地 token 构建 frontdoor 地址。",
                    Some(&detail),
                );
                source.clone()
            }
        }
    } else {
        source.clone()
    };

    let instance = effective_source.instance_url.trim_end_matches('/');
    let sid = urlencoding::encode(&effective_source.access_token);
    let ret_url_encoded = urlencoding::encode(&list_path);
    let final_url = format!("{instance}/secur/frontdoor.jsp?sid={sid}&retURL={ret_url_encoded}");

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_API",
        "open_object_list_page",
        Some(&source_id),
        Some(&normalized_object_name),
        true,
        "已生成 frontdoor 对象列表页地址。",
        None,
    );

    Ok(Some(final_url))
}

/// 打开 Salesforce Object 管理页（混合方案：CLI 数据源优先走 CLI，非 CLI 走 frontdoor URL）。
#[tauri::command]
pub async fn open_object_edit_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<Option<String>, String> {
    let normalized_object_name = object_name.trim().to_string();
    if normalized_object_name.is_empty() {
        return Err("Object 名称不能为空".to_string());
    }

    let object_segment = urlencoding::encode(&normalized_object_name);
    let edit_path = format!("/lightning/setup/ObjectManager/{object_segment}/Details/view");

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    // CLI 数据源：后端直接调用 CLI 打开系统浏览器。
    if source_id.starts_with("cli-") {
        let source_id_cloned = source_id.clone();
        let edit_path_cloned = edit_path.clone();
        let preferred_cli_path = read_configured_cli_path(&state);
        let cli_open_result = tauri::async_runtime::spawn_blocking(move || {
            sf_cli::open_org_path(
                &source_id_cloned,
                &edit_path_cloned,
                preferred_cli_path.as_deref(),
            )
        })
        .await
        .map_err(|error| format!("打开 Salesforce 页面线程失败: {error}"));

        match cli_open_result {
            Ok(Ok(())) => {
                write_system_log(
                    &state,
                    "INFO",
                    "SALESFORCE_CLI",
                    "open_object_edit_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    true,
                    "已通过 Salesforce CLI 打开 Object 管理页。",
                    None,
                );
                return Ok(None);
            }
            Ok(Err(error)) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_edit_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "通过 Salesforce CLI 打开 Object 管理页失败，回退 frontdoor URL。",
                    Some(&detail),
                );
            }
            Err(error) => {
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_edit_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "通过 Salesforce CLI 打开 Object 管理页线程失败，回退 frontdoor URL。",
                    Some(&error),
                );
            }
        }
    }

    // 回退策略：构建 frontdoor URL，交由前端打开（仍可自动带登录态）。
    let effective_source = if source_id.starts_with("cli-") {
        match refresh_cli_source_token(
            &app,
            &state,
            &source_id,
            "open_object_edit_page",
            Some(&normalized_object_name),
        )
        .await
        {
            Ok(refreshed) => refreshed,
            Err(error) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_object_edit_page",
                    Some(&source_id),
                    Some(&normalized_object_name),
                    false,
                    "刷新 token 失败，回退使用本地 token 构建 frontdoor 地址。",
                    Some(&detail),
                );
                source.clone()
            }
        }
    } else {
        source.clone()
    };

    let instance = effective_source.instance_url.trim_end_matches('/');
    let sid = urlencoding::encode(&effective_source.access_token);
    let ret_url_encoded = urlencoding::encode(&edit_path);
    let final_url = format!("{instance}/secur/frontdoor.jsp?sid={sid}&retURL={ret_url_encoded}");

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_API",
        "open_object_edit_page",
        Some(&source_id),
        Some(&normalized_object_name),
        true,
        "已生成 frontdoor Object 管理页地址。",
        None,
    );

    Ok(Some(final_url))
}

/// 打开 Salesforce 记录详情页（混合方案：CLI 数据源优先走 CLI，非 CLI 走 frontdoor URL）。
#[tauri::command]
pub async fn open_record_page(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    record_id: String,
) -> Result<Option<String>, String> {
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

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    // CLI 数据源：后端直接调用 CLI 打开系统浏览器。
    if source_id.starts_with("cli-") {
        let source_id_cloned = source_id.clone();
        let record_path_cloned = record_path.clone();
        let preferred_cli_path = read_configured_cli_path(&state);
        let cli_open_result = tauri::async_runtime::spawn_blocking(move || {
            sf_cli::open_org_path(
                &source_id_cloned,
                &record_path_cloned,
                preferred_cli_path.as_deref(),
            )
        })
        .await
        .map_err(|error| format!("打开 Salesforce 页面线程失败: {error}"));

        match cli_open_result {
            Ok(Ok(())) => {
                write_system_log(
                    &state,
                    "INFO",
                    "SALESFORCE_CLI",
                    "open_record_page",
                    Some(&source_id),
                    Some(&normalized_record_id),
                    true,
                    "已通过 Salesforce CLI 打开记录详情页。",
                    None,
                );
                return Ok(None);
            }
            Ok(Err(error)) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_record_page",
                    Some(&source_id),
                    Some(&normalized_record_id),
                    false,
                    "通过 Salesforce CLI 打开记录详情页失败，回退 frontdoor URL。",
                    Some(&detail),
                );
            }
            Err(error) => {
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_record_page",
                    Some(&source_id),
                    Some(&normalized_record_id),
                    false,
                    "通过 Salesforce CLI 打开记录详情页线程失败，回退 frontdoor URL。",
                    Some(&error),
                );
            }
        }
    }

    // 回退策略：构建 frontdoor URL，交由前端打开（仍可自动带登录态）。
    let effective_source = if source_id.starts_with("cli-") {
        match refresh_cli_source_token(
            &app,
            &state,
            &source_id,
            "open_record_page",
            Some(&normalized_record_id),
        )
        .await
        {
            Ok(refreshed) => refreshed,
            Err(error) => {
                let detail = error.to_string();
                write_system_log(
                    &state,
                    "WARN",
                    "SALESFORCE_CLI",
                    "open_record_page",
                    Some(&source_id),
                    Some(&normalized_record_id),
                    false,
                    "刷新 token 失败，回退使用本地 token 构建 frontdoor 地址。",
                    Some(&detail),
                );
                source.clone()
            }
        }
    } else {
        source.clone()
    };

    let instance = effective_source.instance_url.trim_end_matches('/');
    let sid = urlencoding::encode(&effective_source.access_token);
    let ret_url_encoded = urlencoding::encode(&record_path);
    let final_url = format!("{instance}/secur/frontdoor.jsp?sid={sid}&retURL={ret_url_encoded}");

    write_system_log(
        &state,
        "INFO",
        "SALESFORCE_API",
        "open_record_page",
        Some(&source_id),
        Some(&normalized_record_id),
        true,
        "已生成 frontdoor 记录详情页地址。",
        None,
    );

    Ok(Some(final_url))
}

/// 读取对象字段元数据（Describe）。
/// 读取对象 describe，并在 CLI 数据源 401 时自动刷新 token 后重试。
async fn load_object_describe_with_auto_refresh(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    source: &mut SalesforceSource,
    object_name: &str,
    action: &str,
) -> Result<ObjectDescribe, AppError> {
    match state.sf_client.describe_object(source, object_name).await {
        Ok(describe) => Ok(describe),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                app,
                state,
                source_id,
                action,
                Some(object_name),
            )
            .await?;
            // 刷新成功后覆盖当前 source，确保后续父对象 describe 复用最新 token。
            *source = refreshed_source.clone();
            state.sf_client.describe_object(&refreshed_source, object_name).await
        }
        Err(error) => Err(error),
    }
}

/// 在后端补齐 reference 字段 childRelationshipName，前端仅负责展示。
async fn hydrate_reference_field_child_relationship_names(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    source: &mut SalesforceSource,
    describe: &mut ObjectDescribe,
) -> Result<(), AppError> {
    let current_object_name = describe.name.trim().to_string();
    let mut parent_describe_cache: HashMap<String, ObjectDescribe> = HashMap::new();
    println!(
        "[DEBUG][child-relationship] start object={} source={}",
        current_object_name, source_id
    );

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
        println!(
            "[DEBUG][child-relationship] field={} referenceTo={:?}",
            current_field_name, reference_to_object_names
        );

        let mut relationship_names: Vec<String> = Vec::new();
        let mut seen_relationship_names: HashSet<String> = HashSet::new();
        let mut matched_relation_details: Vec<String> = Vec::new();

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
                        println!(
                            "[DEBUG][child-relationship] parent describe loaded object={} childRelationships={}",
                            parent_object_name,
                            parent_describe.child_relationships.len()
                        );
                        parent_describe_cache.insert(parent_object_name.clone(), parent_describe);
                    }
                    Err(error) => {
                        eprintln!(
                            "[DEBUG][child-relationship] parent describe failed current={}.{} parent={} error={}",
                            current_object_name, current_field_name, parent_object_name, error
                        );
                        continue;
                    }
                }
            }

            if let Some(parent_describe) = parent_describe_cache.get(parent_object_name) {
                for child in parent_describe.child_relationships.iter() {
                    if child.deprecated_and_hidden {
                        continue;
                    }
                    // 严格匹配：childSObject 必须等于当前对象名。
                    if child.child_sobject.trim() != current_object_name {
                        continue;
                    }
                    // 严格匹配：field 必须等于当前字段名。
                    if child.field.trim() != current_field_name {
                        continue;
                    }
                    let relationship_name = child.relationship_name.trim();
                    if relationship_name.is_empty() {
                        continue;
                    }
                    if seen_relationship_names.insert(relationship_name.to_string()) {
                        relationship_names.push(relationship_name.to_string());
                        matched_relation_details.push(format!(
                            "{}.{} -> {}",
                            child.child_sobject, child.field, relationship_name
                        ));
                    }
                }
            }
        }

        // 统一回写到字段元数据，前端直接展示该值。
        field.metadata.insert(
            "childRelationshipName".to_string(),
            serde_json::Value::String(relationship_names.join(", ")),
        );

        // 未命中时输出样本，便于与 Postman 返回逐项对比。
        if relationship_names.is_empty() {
            for parent_object_name in &reference_to_object_names {
                if let Some(parent_describe) = parent_describe_cache.get(parent_object_name) {
                    let sample = parent_describe
                        .child_relationships
                        .iter()
                        .take(8)
                        .map(|item| {
                            format!(
                                "{{childSObject='{}', field='{}', deprecatedAndHidden={}, relationshipName='{}'}}",
                                item.child_sobject,
                                item.field,
                                item.deprecated_and_hidden,
                                item.relationship_name
                            )
                        })
                        .collect::<Vec<_>>()
                        .join(", ");
                    println!(
                        "[DEBUG][child-relationship] no-match sample current={}.{} parent={} sample=[{}]",
                        current_object_name, current_field_name, parent_object_name, sample
                    );
                }
            }
        }

        println!(
            "[DEBUG][child-relationship] resolved current={}.{} matched={} result={}",
            current_object_name,
            current_field_name,
            if matched_relation_details.is_empty() {
                "[]".to_string()
            } else {
                matched_relation_details.join(" | ")
            },
            relationship_names.join(", ")
        );
    }

    println!(
        "[DEBUG][child-relationship] finish object={}",
        current_object_name
    );
    Ok(())
}

#[tauri::command]
pub async fn describe_object(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<ObjectDescribe, String> {
    let mut source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let describe_result = load_object_describe_with_auto_refresh(
        &app,
        &state,
        &source_id,
        &mut source,
        &object_name,
        "describe_object",
    )
    .await;

    match describe_result {
        Ok(mut describe) => {
            if let Err(error) = hydrate_reference_field_child_relationship_names(
                &app,
                &state,
                &source_id,
                &mut source,
                &mut describe,
            )
            .await
            {
                eprintln!(
                    "[DEBUG][child-relationship] hydrate failed object={} source={} error={}",
                    object_name, source_id, error
                );
            }
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "describe_object",
                Some(&source_id),
                Some(&object_name),
                true,
                "获取对象字段元数据成功。",
                None,
            );
            Ok(describe)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "describe_object",
                Some(&source_id),
                Some(&object_name),
                false,
                "获取对象字段元数据失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 解析字段配置的 Child Relationship Name（优先使用 Tooling API）。
#[tauri::command]
pub async fn resolve_field_child_relationship_name(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    field_name: String,
) -> Result<Option<String>, String> {
    let normalized_object_name = object_name.trim().to_string();
    let normalized_field_name = field_name.trim().to_string();
    if normalized_object_name.is_empty() || normalized_field_name.is_empty() {
        return Ok(None);
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let resolve_result = match state
        .sf_client
        .resolve_field_child_relationship_name(&source, &normalized_object_name, &normalized_field_name)
        .await
    {
        Ok(value) => Ok(value),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &source_id,
                "resolve_field_child_relationship_name",
                Some(&normalized_object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .resolve_field_child_relationship_name(
                    &refreshed_source,
                    &normalized_object_name,
                    &normalized_field_name,
                )
                .await
        }
        Err(error) => Err(error),
    };

    match resolve_result {
        Ok(relationship_name) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "resolve_field_child_relationship_name",
                Some(&source_id),
                Some(&normalized_object_name),
                true,
                "解析字段 Child Relationship Name 成功。",
                Some(&format!(
                    "field={} relationshipName={}",
                    normalized_field_name,
                    relationship_name.clone().unwrap_or_default()
                )),
            );
            Ok(relationship_name)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "resolve_field_child_relationship_name",
                Some(&source_id),
                Some(&normalized_object_name),
                false,
                "解析字段 Child Relationship Name 失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 执行 SOQL 查询并返回记录集。
#[tauri::command]
pub async fn query_records(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    soql: String,
) -> Result<QueryResult, String> {
    if soql.trim().is_empty() {
        return Err("SOQL cannot be empty".to_string());
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let query_result = match state.sf_client.query_records(&source, &soql).await {
        Ok(result) => Ok(result),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(&app, &state, &source_id, "query_records", None)
                .await
                .map_err(AppError::to_string_error)?;
            state.sf_client.query_records(&refreshed_source, &soql).await
        }
        Err(error) => Err(error),
    };

    match query_result {
        Ok(result) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "query_records",
                Some(&source_id),
                None,
                true,
                &format!("执行查询成功，返回 {} 条。", result.total_size),
                Some(&soql),
            );
            Ok(result)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "query_records",
                Some(&source_id),
                None,
                false,
                "执行查询失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 新增单条记录。
#[tauri::command]
pub async fn create_record(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: RecordMutationPayload,
) -> Result<String, String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };

    let object_name = payload.object_name.clone();
    let values = payload.values.clone();
    let create_result = match state
        .sf_client
        .create_record(&source, &object_name, values.clone())
        .await
    {
        Ok(record_id) => Ok(record_id),
        Err(error) if is_unauthorized_error(&error) && payload.source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &payload.source_id,
                "create_record",
                Some(&payload.object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .create_record(&refreshed_source, &object_name, values.clone())
                .await
        }
        Err(error) => Err(error),
    };

    match create_result {
        Ok(record_id) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "create_record",
                Some(&payload.source_id),
                Some(&payload.object_name),
                true,
                "新增记录成功。",
                Some(&format!("recordId={record_id}")),
            );
            Ok(record_id)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "create_record",
                Some(&payload.source_id),
                Some(&payload.object_name),
                false,
                "新增记录失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 批量保存记录（同时支持新增与更新）。
#[tauri::command]
pub async fn save_records(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: RecordSavePayload,
) -> Result<(), String> {
    if payload.creates.is_empty() && payload.updates.is_empty() {
        return Ok(());
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };

    let create_count = payload.creates.len();
    let update_count = payload.updates.len();
    let object_name = payload.object_name.clone();
    let creates = payload.creates.clone();
    let updates = payload.updates.clone();
    let save_result = match state
        .sf_client
        .save_records(&source, &object_name, creates.clone(), updates.clone())
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if is_unauthorized_error(&error) && payload.source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &payload.source_id,
                "save_records",
                Some(&payload.object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .save_records(&refreshed_source, &object_name, creates.clone(), updates.clone())
                .await
        }
        Err(error) => Err(error),
    };

    match save_result {
        Ok(()) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "save_records",
                Some(&payload.source_id),
                Some(&payload.object_name),
                true,
                &format!("批量保存成功，新增 {} 条，更新 {} 条。", create_count, update_count),
                None,
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "save_records",
                Some(&payload.source_id),
                Some(&payload.object_name),
                false,
                "批量保存失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 更新单条记录。
#[tauri::command]
pub async fn update_record(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    record_id: String,
    values: std::collections::HashMap<String, serde_json::Value>,
) -> Result<(), String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let update_result = match state
        .sf_client
        .update_record(&source, &object_name, &record_id, values.clone())
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &source_id,
                "update_record",
                Some(&object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .update_record(&refreshed_source, &object_name, &record_id, values.clone())
                .await
        }
        Err(error) => Err(error),
    };

    match update_result {
        Ok(()) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "update_record",
                Some(&source_id),
                Some(&object_name),
                true,
                "更新记录成功。",
                Some(&format!("recordId={record_id}")),
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "update_record",
                Some(&source_id),
                Some(&object_name),
                false,
                "更新记录失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 删除单条记录。
#[tauri::command]
pub async fn delete_record(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    record_id: String,
) -> Result<(), String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let delete_result = match state
        .sf_client
        .delete_record(&source, &object_name, &record_id)
        .await
    {
        Ok(()) => Ok(()),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &source_id,
                "delete_record",
                Some(&object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .delete_record(&refreshed_source, &object_name, &record_id)
                .await
        }
        Err(error) => Err(error),
    };

    match delete_result {
        Ok(()) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "delete_record",
                Some(&source_id),
                Some(&object_name),
                true,
                "删除记录成功。",
                Some(&format!("recordId={record_id}")),
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "delete_record",
                Some(&source_id),
                Some(&object_name),
                false,
                "删除记录失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

#[derive(Debug, Clone, Serialize)]
struct LlmReferenceFieldSummary {
    /// 查找/主从字段 API Name。
    field_name: String,
    /// 父对象候选 API Name 列表（referenceTo）。
    reference_to: Vec<String>,
    /// 父关系名（用于父字段访问，如 Parent__r.Name）。
    relationship_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct LlmChildRelationshipSummary {
    /// 子对象 API Name。
    child_object: String,
    /// 子对象上的父引用字段 API Name。
    field_name: String,
    /// 子查询 relationshipName（用于 SELECT (SELECT ... FROM relationshipName)）。
    relationship_name: String,
}

#[derive(Debug, Clone, Serialize)]
struct LlmObjectMetadataSummary {
    /// 对象 API Name。
    object_name: String,
    /// 对象标签。
    object_label: String,
    /// 字段 API Name 列表。
    field_names: Vec<String>,
    /// 引用关系字段摘要（用于自动推导父对象）。
    reference_fields: Vec<LlmReferenceFieldSummary>,
    /// 子关系摘要（用于自动推导子查询 relationshipName）。
    child_relationships: Vec<LlmChildRelationshipSummary>,
}

#[derive(Debug, Clone)]
struct ParsedSoqlPayload {
    /// 响应模式：answer/generate/clarify。
    mode: String,
    /// 需要继续确认的问题列表。
    questions: Vec<String>,
    /// 生成出的 SOQL。
    soql: Option<String>,
    /// 识别到的主对象名。
    object_name: Option<String>,
    /// 识别到的字段列表。
    field_names: Vec<String>,
    /// 解释文本。
    reason: String,
    /// 对用户问题的直接回答。
    answer: Option<String>,
}

/// 读取 LLM 设置，未配置时返回默认值。
fn read_llm_settings(state: &State<'_, AppState>) -> Result<LlmSettings, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    let raw = db::read_app_setting(&connection, LLM_SETTINGS_KEY)
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

/// 生成对前端安全的 LLM 设置视图（隐藏 apiKey 明文）。
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

/// 对 apiKey 做掩码处理，避免前端拿到明文。
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

/// 调用 LLM：可选开启流式事件推送。
async fn call_llm_with_optional_stream(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    llm_settings: &LlmSettings,
    messages: &[LlmChatMessage],
    stream_request_id: Option<&str>,
) -> Result<serde_json::Value, String> {
    if let Some(request_id) = stream_request_id {
        let cancel_token = Arc::new(AtomicBool::new(false));
        set_llm_stream_cancel_token(state, request_id, cancel_token.clone());
        let stream_result = openai_chat_json_stream(
            &llm_settings.base_url,
            &llm_settings.api_key,
            &llm_settings.model,
            messages,
            llm_settings.timeout_ms,
            |chunk| {
                app.emit_to(
                    "main",
                    "llm:soql-stream-chunk",
                    serde_json::json!({
                        "requestId": request_id,
                        "chunk": chunk
                    }),
                )
                .map_err(|error| AppError::Biz(format!("推送流式事件失败: {error}")))?;
                Ok(())
            },
            || cancel_token.load(Ordering::Relaxed),
        )
        .await;
        clear_llm_stream_cancel_token(state, request_id);
        match stream_result {
            Ok(value) => Ok(value),
            // 流式链路偶发“响应体解码失败”时，自动降级为非流式一次，避免误报配置问题。
            Err(error) if is_retryable_stream_decode_error(&error) => openai_chat_json(
                &llm_settings.base_url,
                &llm_settings.api_key,
                &llm_settings.model,
                messages,
                llm_settings.timeout_ms,
            )
            .await
            .map_err(AppError::to_string_error),
            Err(error) => Err(AppError::to_string_error(error)),
        }
    } else {
        openai_chat_json(
            &llm_settings.base_url,
            &llm_settings.api_key,
            &llm_settings.model,
            messages,
            llm_settings.timeout_ms,
        )
        .await
        .map_err(AppError::to_string_error)
    }
}

/// 从模型原始 JSON 解析结构化载荷，解析失败时降级为 clarify。
fn parse_llm_soql_payload(raw: &serde_json::Value) -> ParsedSoqlPayload {
    let mode = raw
        .get("mode")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let normalized_mode = match mode.as_str() {
        "answer" | "generate" | "clarify" => mode,
        _ => "".to_string(),
    };
    let questions = raw
        .get("questions")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let soql = raw
        .get("soql")
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let object_name = raw
        .get("object")
        .or_else(|| raw.get("objectName"))
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());
    let field_names = raw
        .get("fields")
        .and_then(|item| item.as_array())
        .map(|items| {
            items
                .iter()
                .filter_map(|item| item.as_str())
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let reason = raw
        .get("reason")
        .and_then(|item| item.as_str())
        .unwrap_or("")
        .trim()
        .to_string();
    let answer = raw
        .get("answer")
        .and_then(|item| item.as_str())
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty());

    ParsedSoqlPayload {
        mode: if normalized_mode.is_empty() {
            if soql.is_some() {
                "generate".to_string()
            } else if questions.is_empty() {
                "answer".to_string()
            } else {
                "clarify".to_string()
            }
        } else {
            normalized_mode
        },
        questions,
        soql,
        object_name,
        field_names,
        reason,
        answer,
    }
}

/// 将 describe 结果压缩为 LLM 需要的关系摘要，避免暴露无关噪声字段。
fn build_object_metadata_summary(describe: &ObjectDescribe) -> LlmObjectMetadataSummary {
    let field_names = describe
        .fields
        .iter()
        .map(|field| field.name.clone())
        .collect::<Vec<_>>();

    let reference_fields = describe
        .fields
        .iter()
        .filter_map(|field| {
            let references = field
                .metadata
                .get("referenceTo")
                .and_then(|item| item.as_array())
                .map(|items| {
                    items
                        .iter()
                        .filter_map(|item| item.as_str())
                        .map(|item| item.trim().to_string())
                        .filter(|item| !item.is_empty())
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();

            if references.is_empty() {
                return None;
            }

            let relationship_name = field
                .metadata
                .get("relationshipName")
                .and_then(|item| item.as_str())
                .unwrap_or("")
                .trim()
                .to_string();

            Some(LlmReferenceFieldSummary {
                field_name: field.name.clone(),
                reference_to: references,
                relationship_name,
            })
        })
        .collect::<Vec<_>>();

    let child_relationships = describe
        .child_relationships
        .iter()
        .filter(|item| !item.relationship_name.trim().is_empty() && !item.deprecated_and_hidden)
        .map(|item| LlmChildRelationshipSummary {
            child_object: item.child_sobject.clone(),
            field_name: item.field.clone(),
            relationship_name: item.relationship_name.clone(),
        })
        .collect::<Vec<_>>();

    LlmObjectMetadataSummary {
        object_name: describe.name.clone(),
        object_label: describe.label.clone(),
        field_names,
        reference_fields,
        child_relationships,
    }
}

/// 构造模型输入消息：包含系统约束、元数据摘要和多轮历史。
fn build_llm_messages(
    history: &[LlmChatMessage],
    all_objects: &[SalesforceObject],
    object_metadata_map: &HashMap<String, LlmObjectMetadataSummary>,
    context_object_hint: Option<&str>,
    generate_mode: bool,
) -> Vec<LlmChatMessage> {
    let mode_prompt = if generate_mode {
        "当前模式：生成模式。优先输出可执行 SOQL。"
    } else {
        "当前模式：对话模式。仅回答问题，不要输出 SOQL，除非用户明确要求“生成SOQL”。"
    };
    let system_prompt = format!(
        "{}\n{}",
        mode_prompt,
        r#"
你是 Salesforce SOQL 生成助手。
必须遵守：
1) 你是专业 Salesforce 工程师，先回答用户问题，再决定是否生成 SOQL。
2) 必须输出 mode：
   - answer: 只回答，不生成 SOQL
   - generate: 回答 + 生成 SOQL
   - clarify: 需求模糊，提出问题直到明确
3) 若用户明确要求“生成SOQL”，优先返回 mode=generate 且给出 soql。
4) 仅当“对象无法确定”或“业务冲突无法消解”时返回 mode=clarify。
5) 若用户要求“父对象 + 子对象”或给了子对象 API 名，先基于 metadata 中的 child_relationships / reference_fields 自动推导父对象 API 与子关系名，不要直接反问。
6) 如果 metadata 仍不足，才提问；提问必须使用中文。
7) 若用户说“全部数据/全量数据”，按 SOQL 特性处理：使用对象全部可用字段（不允许 SELECT *），默认附加 LIMIT 200 与可读排序（如 CreatedDate DESC）。
8) 除非用户明确要求，不要因为 IsDeleted/LIMIT/排序等默认边界反复追问；可在 reason 里说明默认假设。
9) 仅允许输出 SELECT 语句，可包含子查询、聚合、分组、排序、函数。
10) 禁止输出 INSERT/UPDATE/DELETE/UPSERT/MERGE。
11) 只能使用给定元数据中的对象与字段，不能臆造。
12) 仅输出 JSON 对象，不要输出额外文本。
JSON 结构：
{
  \"mode\": \"answer|generate|clarify\",
  \"status\": \"clarify|ready\",
  \"questions\": [\"...\"],
  \"answer\": \"...（对用户问题的专业回答）\",
  \"soql\": \"...\",
  \"object\": \"...\",
  \"fields\": [\"...\"],
  \"reason\": \"...\"
}
"#
        .trim()
    );

    let metadata_snapshot = build_layered_metadata_snapshot(all_objects, object_metadata_map, context_object_hint);

    let mut messages = vec![LlmChatMessage {
        role: LlmChatRole::System,
        content: system_prompt,
    }];
    messages.push(LlmChatMessage {
        role: LlmChatRole::System,
        content: format!("元数据上下文：{}", metadata_snapshot),
    });
    messages.extend_from_slice(history);
    messages
}

/// 构建分层元数据快照：对象摘要 + 重点对象字段 + 按需补充说明。
fn build_layered_metadata_snapshot(
    all_objects: &[SalesforceObject],
    object_metadata_map: &HashMap<String, LlmObjectMetadataSummary>,
    context_object_hint: Option<&str>,
) -> serde_json::Value {
    let object_summaries = all_objects
        .iter()
        .take(500)
        .map(|item| {
            serde_json::json!({
                "name": item.name,
                "label": item.label,
                "queryable": item.queryable
            })
        })
        .collect::<Vec<_>>();

    let focus_object_details = object_metadata_map
        .values()
        .map(|item| {
            let sample_fields = item.field_names.iter().take(60).cloned().collect::<Vec<_>>();
            let reference_fields = item
                .reference_fields
                .iter()
                .take(20)
                .map(|reference| {
                    serde_json::json!({
                        "field": reference.field_name,
                        "referenceTo": reference.reference_to,
                        "relationshipName": reference.relationship_name
                    })
                })
                .collect::<Vec<_>>();
            let child_relationships = item
                .child_relationships
                .iter()
                .take(20)
                .map(|child| {
                    serde_json::json!({
                        "childObject": child.child_object,
                        "field": child.field_name,
                        "relationshipName": child.relationship_name
                    })
                })
                .collect::<Vec<_>>();
            serde_json::json!({
                "object": item.object_name,
                "label": item.object_label,
                "fieldCount": item.field_names.len(),
                "sampleFields": sample_fields,
                "referenceFields": reference_fields,
                "childRelationships": child_relationships
            })
        })
        .collect::<Vec<_>>();

    serde_json::json!({
        "layer1ObjectSummaries": object_summaries,
        "layer2FocusObjectDetails": focus_object_details,
        "layer3OnDemandPolicy": "若字段不足，可在对话中向用户确认后按需补充；优先使用已提供字段生成或回答。",
        "contextObjectHint": context_object_hint.unwrap_or("")
    })
}

/// 压缩上下文：超过阈值时，把旧消息汇总为摘要并保留最近消息。
fn compress_history_in_place(history: &mut Vec<LlmChatMessage>, max_chars: usize) {
    let total_chars = history.iter().map(|item| item.content.chars().count()).sum::<usize>();
    if total_chars <= max_chars || history.len() <= 24 {
        return;
    }

    let keep_recent = 18usize.min(history.len());
    let split_index = history.len().saturating_sub(keep_recent);
    let old_messages = history[..split_index].to_vec();
    let recent_messages = history[split_index..].to_vec();

    let mut summary_lines: Vec<String> = Vec::new();
    for item in old_messages.iter().rev().take(80).rev() {
        let role = match item.role {
            LlmChatRole::System => "System",
            LlmChatRole::User => "User",
            LlmChatRole::Assistant => "Assistant",
        };
        let snippet = item.content.chars().take(220).collect::<String>();
        summary_lines.push(format!("[{role}] {snippet}"));
    }
    let mut summary_text = format!(
        "【历史对话摘要（自动压缩）】\n{}\n【摘要结束】",
        summary_lines.join("\n")
    );
    if summary_text.chars().count() > 6000 {
        summary_text = summary_text.chars().take(6000).collect();
    }

    let mut next_history = vec![LlmChatMessage {
        role: LlmChatRole::System,
        content: summary_text,
    }];
    next_history.extend(recent_messages);
    *history = next_history;
}

/// 判断用户当前输入是否明确要求“生成/输出 SOQL”。
fn should_generate_soql(user_message: &str) -> bool {
    let lower = user_message.to_lowercase();
    let hit_keywords = [
        "生成soql",
        "输出soql",
        "写soql",
        "给我soql",
        "构造soql",
        "generate soql",
        "build soql",
        "select ",
        "查询",
        "查一下",
        "帮我查",
    ];
    hit_keywords.iter().any(|item| lower.contains(item))
}

/// 根据输入文本与上下文对象提示，筛选候选对象，避免 describe 全量对象导致性能开销过高。
fn pick_candidate_objects(
    objects: &[SalesforceObject],
    user_message: &str,
    context_object_hint: Option<&str>,
) -> Vec<String> {
    let mut picked: Vec<String> = Vec::new();
    let lower_message = user_message.to_lowercase();

    if let Some(hint) = context_object_hint.map(|item| item.trim()).filter(|item| !item.is_empty()) {
        if let Some(found) = objects
            .iter()
            .find(|item| item.name.eq_ignore_ascii_case(hint) || item.label.eq_ignore_ascii_case(hint))
        {
            picked.push(found.name.clone());
        }
    }

    for item in objects {
        let name_hit = lower_message.contains(&item.name.to_lowercase());
        let label_hit = lower_message.contains(&item.label.to_lowercase());
        if name_hit || label_hit {
            if !picked.iter().any(|name| name.eq_ignore_ascii_case(&item.name)) {
                picked.push(item.name.clone());
            }
        }
    }

    if picked.is_empty() {
        picked.extend(objects.iter().take(8).map(|item| item.name.clone()));
    }
    picked
}

/// 生成默认澄清问题，确保模糊场景下始终可继续对话。
fn fallback_questions() -> Vec<String> {
    vec![
        "请先明确要查询的 Salesforce 对象（例如 Account、Contact）。".to_string(),
        "如果对象已明确，我将按默认边界先生成可执行 SOQL（LIMIT 200、默认排序），你再按需调整。".to_string(),
    ]
}


/// 校验数据源写入参数，避免保存明显非法值。
fn validate_payload(payload: &SourceUpsertPayload) -> Result<(), String> {
    if payload.name.trim().is_empty() {
        return Err("Source name cannot be empty".to_string());
    }
    if payload.instance_url.trim().is_empty() {
        return Err("Instance URL cannot be empty".to_string());
    }
    if payload.access_token.trim().is_empty() {
        return Err("Access token cannot be empty".to_string());
    }
    if !payload.api_version.starts_with('v') {
        return Err("API version must start with v, e.g. v61.0".to_string());
    }
    Ok(())
}
