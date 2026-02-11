use tauri::State;

use crate::app_state::AppState;
use crate::db;
use crate::error::AppError;
use crate::models::{ObjectDescribe, QueryResult, RecordMutationPayload, SalesforceObject, SalesforceSource, SourceUpsertPayload};
use crate::sf_cli;

#[tauri::command]
pub fn list_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("数据库锁失败: {error}"))?;
    db::list_sources(&connection).map_err(AppError::to_string_error)
}

/// 从 Salesforce CLI 同步认证信息到本地数据源。
#[tauri::command]
pub fn sync_cli_sources(state: State<'_, AppState>) -> Result<Vec<SalesforceSource>, String> {
    let seeds = sf_cli::load_cli_sources().map_err(AppError::to_string_error)?;

    let keep_ids: Vec<String> = seeds.iter().map(|item| item.id.clone()).collect();
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("数据库锁失败: {error}"))?;

    for seed in seeds {
        db::upsert_source_with_id(&connection, &seed.id, seed.payload).map_err(AppError::to_string_error)?;
    }
    db::prune_cli_sources(&connection, &keep_ids).map_err(AppError::to_string_error)?;
    db::list_sources(&connection).map_err(AppError::to_string_error)
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
        .map_err(|error| format!("数据库锁失败: {error}"))?;
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
        .map_err(|error| format!("数据库锁失败: {error}"))?;
    db::update_source(&connection, &id, payload).map_err(AppError::to_string_error)
}

#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let connection = state
        .db
        .lock()
        .map_err(|error| format!("数据库锁失败: {error}"))?;
    db::delete_source(&connection, &id).map_err(AppError::to_string_error)
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;

        if let Some(cached) = db::read_object_cache(&connection, &source_id).map_err(AppError::to_string_error)? {
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;
        db::write_object_cache(&connection, &source_id, &objects).map_err(AppError::to_string_error)?;
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;
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
        return Err("SOQL 不能为空".to_string());
    }

    let source = {
        let connection = state
            .db
            .lock()
            .map_err(|error| format!("数据库锁失败: {error}"))?;
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };

    state
        .sf_client
        .create_record(&source, &payload.object_name, payload.values)
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;
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
            .map_err(|error| format!("数据库锁失败: {error}"))?;
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
        return Err("数据源名称不能为空".to_string());
    }
    if payload.instance_url.trim().is_empty() {
        return Err("Instance URL 不能为空".to_string());
    }
    if payload.access_token.trim().is_empty() {
        return Err("Access Token 不能为空".to_string());
    }
    if !payload.api_version.starts_with('v') {
        return Err("API Version 必须以 v 开头，例如 v61.0".to_string());
    }
    Ok(())
}
