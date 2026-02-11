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
    SalesforceSource, SourceUpsertPayload,
};
use crate::sf_cli;

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::list_sources(&connection).map_err(AppError::to_string_error)
}

#[tauri::command]
pub fn sync_cli_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
    let seeds = sf_cli::load_cli_sources().map_err(AppError::to_string_error)?;

    let keep_ids: Vec<String> = seeds.iter().map(|item| item.id.clone()).collect();
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;

    for seed in seeds {
        db::upsert_source_with_id(&connection, &seed.id, seed.payload)
            .map_err(AppError::to_string_error)?;
    }
    db::prune_cli_sources(&connection, &keep_ids).map_err(AppError::to_string_error)?;
    db::list_sources(&connection).map_err(AppError::to_string_error)
}

#[tauri::command]
pub async fn login_cli_org(instance_url: String) -> Result<String, String> {
    let trimmed = instance_url.trim().to_string();
    if trimmed.is_empty() {
        return Err("Instance URL cannot be empty".to_string());
    }

    let result = tauri::async_runtime::spawn_blocking(move || {
        sf_cli::login_web(trimmed.trim()).map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("登录线程失败: {error}"))??;

    Ok(result.org_id)
}

#[tauri::command]
pub fn open_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("sf-auth") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
        return Ok(());
    }

    tauri::WebviewWindowBuilder::new(&app, "sf-auth", tauri::WebviewUrl::App("/auth".into()))
        .title("Salesforce 登录")
        .inner_size(480.0, 360.0)
        .resizable(false)
        .center()
        .build()
        .map(|_| ())
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub fn close_auth_window(app: tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("sf-auth") {
        window.close().map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[derive(Clone, Serialize)]
struct FieldMetaWindowPayload {
    field_name: String,
    metadata: HashMap<String, serde_json::Value>,
}

#[tauri::command]
pub fn open_field_meta_window(
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
        tauri::WebviewUrl::App("/field-meta".into()),
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
        std::thread::sleep(std::time::Duration::from_millis(220));
        let _ = app_handle.emit_to("sf-field-meta", "sf:field-meta-open", payload);
    });

    Ok(())
}


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

#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::delete_source(&connection, &id).map_err(AppError::to_string_error)
}

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

#[tauri::command]
pub async fn list_objects(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;

        if let Some(cached) =
            db::read_object_cache(&connection, &source_id).map_err(AppError::to_string_error)?
        {
            return Ok(cached);
        }

        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };

    let objects = state
        .sf_client
        .list_objects(&source)
        .await
        .map_err(AppError::to_string_error)?;

    {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::write_object_cache(&connection, &source_id, &objects)
            .map_err(AppError::to_string_error)?;
    }

    Ok(objects)
}

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

    state
        .sf_client
        .describe_object(&source, &object_name)
        .await
        .map_err(AppError::to_string_error)
}

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

    state
        .sf_client
        .query_records(&source, &soql)
        .await
        .map_err(AppError::to_string_error)
}

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

    state
        .sf_client
        .create_record(&source, &payload.object_name, payload.values)
        .await
        .map_err(AppError::to_string_error)
}

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

    state
        .sf_client
        .save_records(&source, &payload.object_name, payload.creates, payload.updates)
        .await
        .map_err(AppError::to_string_error)
}

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

    state
        .sf_client
        .update_record(&source, &object_name, &record_id, values)
        .await
        .map_err(AppError::to_string_error)
}

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

    state
        .sf_client
        .delete_record(&source, &object_name, &record_id)
        .await
        .map_err(AppError::to_string_error)
}

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
