use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
use tauri_plugin_opener::OpenerExt;

use crate::ai::orchestrator::AiOrchestrator;
use crate::app_state::AppState;
use crate::db;
use crate::error::AppError;
use crate::models::{
    AiCapabilities, AiChatTurnV2Request, AiChatTurnV2Response, CliPathProbe, CliPathSettings,
    CliPathStatus, CurrentUserContext, LlmSettings, LlmSettingsView, ObjectDescribe, QueryResult,
    RecordMutationPayload, RecordSavePayload, SalesforceObject, SalesforceSource,
    SaveLlmSettingsPayload, SourceUpsertPayload, SystemLogPage,
};
use crate::sf_cli;

/// 写系统日志的统一入口。
/// 说明:日志写入失败不应影响主流程,因此这里吞掉错误。
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
    // macOS 下禁用父窗口后,子窗口(parent 关系)可能也出现不可交互问题。
    // 仅在 macOS 跳过 set_enabled,避免主窗口和登录窗口同时"失焦/不可点击"。
    if cfg!(target_os = "macos") {
        return;
    }
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_enabled(enabled);
    }
}

/// 生成跨平台窗口标题：Linux 缺少中文系统字体时回退英文，避免标题栏出现方框。
fn resolve_window_title(zh_title: &str, en_title: &str) -> String {
    // Linux 标题栏由系统窗口管理器绘制，不使用 WebView 内嵌字体。
    if cfg!(target_os = "linux") {
        return en_title.to_string();
    }
    zh_title.to_string()
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

fn cancel_llm_stream_by_request_id(state: &State<'_, AppState>, request_id: &str) {
    if let Ok(map) = state.llm_stream_cancels.lock() {
        if let Some(token) = map.get(request_id) {
            token.store(true, Ordering::Relaxed);
        }
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

/// 仅针对 CLI 数据源:发生 401 后通过 CLI 刷新 token,并回写本地数据源。
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
        "检测到 401,开始通过 CLI 刷新 token。",
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
            "通过 CLI 刷新 token 成功,准备重试请求。",
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

        // 逐条 upsert,保证同一个 org 重复同步只更新不新增。
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
        &format!("同步 Salesforce CLI 数据源成功,共 {} 个。", sources.len()),
        None,
    );
    Ok(sources)
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
fn open_url_with_system_browser(app: &tauri::AppHandle, url: &str) -> Result<(), String> {
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

/// 分页查询系统日志(倒序)。
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

/// 读取对象列表(优先走缓存,缓存失效后再请求 Salesforce)。
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
            &format!("命中对象缓存,共 {} 个。", cached.len()),
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
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "list_objects", None)
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
        // 请求成功后写入缓存,后续短时间内避免重复调用远端接口。
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
        &format!("拉取对象列表成功,共 {} 个。", objects.len()),
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

/// 保存 Salesforce CLI 自定义路径(传空会清除配置)。
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

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        let raw = serde_json::to_string(&current)
            .map_err(|error| AppError::to_string_error(error.into()))?;
        db::write_app_setting(&connection, LLM_SETTINGS_KEY, &raw)
            .map_err(AppError::to_string_error)?;
    }

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
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "refresh_objects", None)
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
        // 强制刷新成功后覆盖缓存,保证后续列表读取为最新远端快照。
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
        &format!("强制刷新对象列表成功,共 {} 个。", objects.len()),
        None,
    );

    Ok(objects)
}

/// 构建 frontdoor URL：`{instance}/secur/frontdoor.jsp?sid={token}&retURL={path}`。
fn build_frontdoor_url(source: &SalesforceSource, path: &str) -> String {
    let instance = source.instance_url.trim_end_matches('/');
    let sid = urlencoding::encode(&source.access_token);
    let ret_url = urlencoding::encode(path);
    format!("{instance}/secur/frontdoor.jsp?sid={sid}&retURL={ret_url}")
}

/// 快速校验 token → 无效则刷新 → 构建 frontdoor URL → 打开系统浏览器。
/// 统一走 frontdoor URL 方案,跳过缓慢的 CLI 子进程调用。
async fn open_salesforce_page(
    app: &tauri::AppHandle,
    state: &State<'_, AppState>,
    source_id: &str,
    source: &SalesforceSource,
    path: &str,
    action: &str,
    target: Option<&str>,
) -> Result<(), String> {
    // 快速校验:通过轻量级 API 请求检测 token 是否仍然有效。
    let token_valid = state.sf_client.validate_token(source).await;

    let effective_source = if token_valid {
        source.clone()
    } else if source_id.starts_with("cli-") {
        // Token 无效且为 CLI 数据源:尝试刷新 token。
        write_system_log(
            state,
            "INFO",
            "SALESFORCE_CLI",
            action,
            Some(source_id),
            target,
            true,
            "Token 校验失败(401),开始通过 CLI 刷新 token。",
            None,
        );
        match refresh_cli_source_token(app, state, source_id, action, target).await {
            Ok(refreshed) => refreshed,
            Err(error) => {
                let detail = error.to_string();
                write_system_log(
                    state,
                    "WARN",
                    "SALESFORCE_CLI",
                    action,
                    Some(source_id),
                    target,
                    false,
                    "刷新 token 失败,回退使用本地 token 构建 frontdoor 地址。",
                    Some(&detail),
                );
                source.clone()
            }
        }
    } else {
        // Token 无效且为非 CLI 数据源:使用缓存 token(用户可能看到登录页)。
        source.clone()
    };

    let final_url = build_frontdoor_url(&effective_source, path);

    if let Err(detail) = open_url_with_system_browser(app, &final_url) {
        write_system_log(
            state,
            "ERROR",
            "SYSTEM",
            action,
            Some(source_id),
            target,
            false,
            "调用系统浏览器打开 Salesforce 页面失败。",
            Some(&detail),
        );
        return Err(format!("打开浏览器失败: {detail}"));
    }

    write_system_log(
        state,
        "INFO",
        "SALESFORCE_API",
        action,
        Some(source_id),
        target,
        true,
        "已通过系统浏览器打开 Salesforce 页面。",
        None,
    );

    Ok(())
}

/// 打开 Salesforce 对象列表页(快速校验 token 后直接打开浏览器)。
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

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

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

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

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

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

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
            let refreshed_source =
                refresh_cli_source_token(app, state, source_id, action, Some(object_name)).await?;
            // 刷新成功后覆盖当前 source,确保后续父对象 describe 复用最新 token。
            *source = refreshed_source.clone();
            state
                .sf_client
                .describe_object(&refreshed_source, object_name)
                .await
        }
        Err(error) => Err(error),
    }
}

/// 在后端补齐 reference 字段 childRelationshipName,前端仅负责展示。
async fn hydrate_reference_field_child_relationship_names(
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
            if let Err(_) = hydrate_reference_field_child_relationship_names(
                &app,
                &state,
                &source_id,
                &mut source,
                &mut describe,
            )
            .await
            {}
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

/// 解析字段配置的 Child Relationship Name(优先使用 Tooling API)。
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
        .resolve_field_child_relationship_name(
            &source,
            &normalized_object_name,
            &normalized_field_name,
        )
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
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "query_records", None)
                    .await
                    .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .query_records(&refreshed_source, &soql)
                .await
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
                &format!("执行查询成功,返回 {} 条。", result.total_size),
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

/// 获取当前登录用户上下文（时区/地区），用于前端按 Salesforce 用户时区展示 datetime。
#[tauri::command]
pub async fn get_current_user_context(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<CurrentUserContext, String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let context_result = match state.sf_client.get_current_user_context(&source).await {
        Ok(context) => Ok(context),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "get_current_user_context", None)
                    .await
                    .map_err(AppError::to_string_error)?;
            state
                .sf_client
                .get_current_user_context(&refreshed_source)
                .await
        }
        Err(error) => Err(error),
    };

    match context_result {
        Ok(context) => {
            write_system_log(
                &state,
                "INFO",
                "SALESFORCE_API",
                "get_current_user_context",
                Some(&source_id),
                None,
                true,
                "获取当前用户上下文成功。",
                Some(&format!(
                    "timezoneSidKey={} localeSidKey={}",
                    context.timezone_sid_key.clone().unwrap_or_default(),
                    context.locale_sid_key.clone().unwrap_or_default()
                )),
            );
            Ok(context)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                "SALESFORCE_API",
                "get_current_user_context",
                Some(&source_id),
                None,
                false,
                "获取当前用户上下文失败。",
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

/// 批量保存记录(同时支持新增与更新)。
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
                .save_records(
                    &refreshed_source,
                    &object_name,
                    creates.clone(),
                    updates.clone(),
                )
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
                &format!(
                    "批量保存成功,新增 {} 条,更新 {} 条。",
                    create_count, update_count
                ),
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

/// 读取 LLM 设置,未配置时返回默认值。
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

/// 读取 UI 持久化状态（通用键值）。
#[tauri::command]
pub fn get_ui_state(state: State<'_, AppState>, key: String) -> Result<Option<String>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::read_app_setting(&connection, &key).map_err(AppError::to_string_error)
}

/// 写入 UI 持久化状态（通用键值）。
#[tauri::command]
pub fn save_ui_state(state: State<'_, AppState>, key: String, value: String) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::write_app_setting(&connection, &key, &value).map_err(AppError::to_string_error)
}

/// 校验数据源写入参数,避免保存明显非法值。
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
