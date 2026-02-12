use std::collections::HashMap;
use serde::Serialize;
use tauri::Emitter;
use tauri::State;
use tauri::Manager;

use crate::app_state::AppState;
use crate::db;
use crate::error::AppError;
use crate::models::{
    ObjectDescribe, QueryResult, RecordMutationPayload, RecordSavePayload, SalesforceObject,
    SalesforceSource, SourceUpsertPayload, SystemLogPage,
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

fn set_main_window_enabled(app: &tauri::AppHandle, enabled: bool) {
    if let Some(main_window) = app.get_webview_window("main") {
        let _ = main_window.set_enabled(enabled);
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

/// 仅针对 CLI 数据源：发生 401 后通过 CLI 刷新 token，并回写本地数据源。
async fn refresh_cli_source_token(
    state: &State<'_, AppState>,
    source_id: &str,
    action: &str,
    target: Option<&str>,
) -> Result<SalesforceSource, AppError> {
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

    let source_id_owned = source_id.to_string();
    let refreshed_seed = tauri::async_runtime::spawn_blocking(move || {
        sf_cli::load_cli_source_by_id(&source_id_owned)
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

    Ok(refreshed_source)
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
    let seeds = match sf_cli::load_cli_sources() {
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

    // CLI 命令会阻塞，放入 blocking 线程池避免卡住 async runtime。
    let result = tauri::async_runtime::spawn_blocking(move || {
        sf_cli::login_web(trimmed.trim()).map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("登录线程失败: {error}"));

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
        let _ = window.set_always_on_top(true);
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
        .always_on_top(true)
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

    let app_handle = app.clone();
    auth_window.on_window_event(move |event| {
        if matches!(event, tauri::WindowEvent::Destroyed) {
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
            let refreshed_source = refresh_cli_source_token(&state, &source_id, "list_objects", None)
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

/// 读取对象字段元数据（Describe）。
#[tauri::command]
pub async fn describe_object(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<ObjectDescribe, String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let describe_result = match state.sf_client.describe_object(&source, &object_name).await {
        Ok(describe) => Ok(describe),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &state,
                &source_id,
                "describe_object",
                Some(&object_name),
            )
            .await
            .map_err(AppError::to_string_error)?;
            state.sf_client.describe_object(&refreshed_source, &object_name).await
        }
        Err(error) => Err(error),
    };

    match describe_result {
        Ok(describe) => {
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

/// 执行 SOQL 查询并返回记录集。
#[tauri::command]
pub async fn query_records(
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
            let refreshed_source = refresh_cli_source_token(&state, &source_id, "query_records", None)
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


