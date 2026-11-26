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

/// 执行 SOQL 查询并返回记录集。
#[tauri::command]
pub async fn query_records(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    soql: String,
    object_name: Option<String>,
) -> Result<QueryResult, String> {
    if soql.trim().is_empty() {
        return Err("查询语句不能为空".to_string());
    }
    let query_text = soql.trim().to_string();

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);
    let normalized_object_name = object_name
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let mysql_describe = if source.source_type.eq_ignore_ascii_case("mysql") {
        load_mysql_describe_for_query(
            &state,
            &source_id,
            &source,
            normalized_object_name.as_deref(),
        )
        .await
        .map_err(AppError::to_string_error)?
    } else {
        None
    };
    let query_detail = if source.is_salesforce() {
        build_salesforce_query_detail(&source.api_version, &query_text)
    } else {
        build_mysql_query_detail(&query_text)
    };

    let query_result = match provider
        .query_records(&source, &query_text, mysql_describe.as_ref())
        .await
    {
        Ok(result) => Ok(result),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "query_records", None)
                    .await
                    .map_err(AppError::to_string_error)?;
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
                .query_records(&refreshed_source, &query_text, mysql_describe.as_ref())
                .await
        }
        Err(error) => Err(error),
    };

    match query_result {
        Ok(result) => {
            write_system_log(
                &state,
                "INFO",
                log_category,
                "query_records",
                Some(&source_id),
                None,
                true,
                &format!("执行查询成功,返回 {} 条。", result.total_size),
                Some(&query_detail),
            );
            Ok(result)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = format!("{query_detail}\nerror={message}");
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "query_records",
                Some(&source_id),
                None,
                false,
                "执行查询失败。",
                Some(&detail),
            );
            Err(message)
        }
    }
}

/// 从 SQLite 元数据缓存读取对象 describe；命中失败时返回 None。
fn read_cached_object_describe(
    state: &State<'_, AppState>,
    source_id: &str,
    object_name: &str,
) -> Result<Option<ObjectDescribe>, AppError> {
    let payload = state.storage.read(|connection| {
        db::read_source_metadata_cache(
            connection,
            source_id,
            METADATA_TYPE_OBJECT_DESCRIBE,
            Some(object_name),
        )
    })?;
    let Some(payload) = payload else {
        return Ok(None);
    };
    serde_json::from_str::<ObjectDescribe>(&payload)
        .map(Some)
        .map_err(|error| AppError::Serde(error.to_string()))
}

/// MySQL 查询结果解码所需 describe：优先读 SQLite 缓存，未命中时回源目标数据源并写回缓存。
async fn load_mysql_describe_for_query(
    state: &State<'_, AppState>,
    source_id: &str,
    source: &SalesforceSource,
    object_name: Option<&str>,
) -> Result<Option<ObjectDescribe>, AppError> {
    let Some(object_name) = object_name.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };

    if let Some(cached) = read_cached_object_describe(state, source_id, object_name)? {
        return Ok(Some(cached));
    }

    let provider = provider_for_source(state.inner(), source)?;
    let describe = provider.describe_object(source, object_name).await?;

    let payload =
        serde_json::to_string(&describe).map_err(|error| AppError::Serde(error.to_string()))?;
    state.storage.write(|connection| {
        db::write_source_metadata_cache(
            connection,
            source_id,
            METADATA_TYPE_OBJECT_DESCRIBE,
            Some(object_name),
            &payload,
        )
    })?;

    Ok(Some(describe))
}

/// 获取当前登录用户上下文（时区/地区），用于前端按 Salesforce 用户时区展示 datetime。
#[tauri::command]
pub async fn get_current_user_context(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<CurrentUserContext, String> {
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;

    let context_result = match provider.get_current_user_context(&source).await {
        Ok(context) => Ok(context),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source = refresh_cli_source_token(
                &app,
                &state,
                &source_id,
                "get_current_user_context",
                None,
            )
            .await
            .map_err(AppError::to_string_error)?;
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
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
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &payload.source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);

    let object_name = payload.object_name.clone();
    let values = payload.values.clone();
    let operation_detail = if source.is_salesforce() {
        build_salesforce_create_detail(&source.api_version, &object_name, &values, None)
    } else {
        match preview_create_record_sql(&source, &object_name, values.clone()).await {
            Ok(detail) => detail,
            Err(error) => fallback_mysql_log_detail(&error),
        }
    };
    let create_result = match provider
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
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
                .create_record(&refreshed_source, &object_name, values.clone())
                .await
        }
        Err(error) => Err(error),
    };

    match create_result {
        Ok(record_id) => {
            let detail = if source.is_salesforce() {
                format!("recordId={record_id}\n{operation_detail}")
            } else {
                build_mysql_single_log_detail(
                    "create",
                    &record_id,
                    &operation_detail,
                    Some(1),
                    true,
                    None,
                )
            };
            write_system_log(
                &state,
                "INFO",
                log_category,
                "create_record",
                Some(&payload.source_id),
                Some(&payload.object_name),
                true,
                "新增记录成功。",
                Some(&detail),
            );
            Ok(record_id)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = if source.is_salesforce() {
                format!("{operation_detail}\nerror={message}")
            } else {
                build_mysql_single_log_detail(
                    "create",
                    "",
                    &operation_detail,
                    None,
                    false,
                    Some(&message),
                )
            };
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "create_record",
                Some(&payload.source_id),
                Some(&payload.object_name),
                false,
                "新增记录失败。",
                Some(&detail),
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

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &payload.source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);

    let create_count = payload.creates.len();
    let update_count = payload.updates.len();
    let object_name = payload.object_name.clone();
    let creates = payload.creates.clone();
    let updates = payload.updates.clone();
    let (mysql_preview_items, mysql_preview_fallback_sql) = if source.is_salesforce() {
        (Vec::new(), String::new())
    } else {
        match preview_save_records_with_deletes_items(
            &source,
            &object_name,
            creates.clone(),
            updates.clone(),
            Vec::new(),
        )
        .await
        {
            Ok(items) => (items, String::new()),
            Err(error) => (Vec::new(), fallback_mysql_log_detail(&error)),
        }
    };
    let operation_detail = if source.is_salesforce() {
        build_salesforce_save_detail(&source.api_version, &object_name, &creates, &updates, None)
    } else {
        build_mysql_batch_log_detail(
            "save_records",
            &mysql_preview_items,
            None,
            None,
            &mysql_preview_fallback_sql,
        )
    };
    let save_result = match provider
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
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
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
            let detail = if source.is_salesforce() {
                operation_detail.clone()
            } else {
                operation_detail.clone()
            };
            write_system_log(
                &state,
                "INFO",
                log_category,
                "save_records",
                Some(&payload.source_id),
                Some(&payload.object_name),
                true,
                &format!(
                    "批量保存成功,新增 {} 条,更新 {} 条。",
                    create_count, update_count
                ),
                Some(&detail),
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = if source.is_salesforce() {
                format!("{operation_detail}\nerror={message}")
            } else {
                build_mysql_batch_log_detail(
                    "save_records",
                    &mysql_preview_items,
                    None,
                    Some(&message),
                    &mysql_preview_fallback_sql,
                )
            };
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "save_records",
                Some(&payload.source_id),
                Some(&payload.object_name),
                false,
                "批量保存失败。",
                Some(&detail),
            );
            Err(message)
        }
    }
}

/// 预览批量保存记录（新增+更新+删除）的 MySQL SQL，不执行写入。
#[tauri::command]
pub async fn preview_save_records_with_deletes(
    state: State<'_, AppState>,
    payload: RecordSaveWithDeletePayload,
) -> Result<Vec<MutationPreviewSqlItem>, String> {
    if payload.creates.is_empty() && payload.updates.is_empty() && payload.deletes.is_empty() {
        return Ok(Vec::new());
    }

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &payload.source_id))
        .map_err(AppError::to_string_error)?;
    if source.is_salesforce() {
        return Err("Salesforce 暂不支持单事务批量提交预览（含删除）。".to_string());
    }

    preview_save_records_with_deletes_items(
        &source,
        &payload.object_name,
        payload.creates,
        payload.updates,
        payload.deletes,
    )
    .await
    .map_err(AppError::to_string_error)
}

/// 批量保存记录（新增+更新+删除，单事务）。
#[tauri::command]
pub async fn save_records_with_deletes(
    _app: tauri::AppHandle,
    state: State<'_, AppState>,
    payload: RecordSaveWithDeletePayload,
) -> Result<MutationExecutionResult, String> {
    if payload.creates.is_empty() && payload.updates.is_empty() && payload.deletes.is_empty() {
        return Ok(MutationExecutionResult {
            create_count: 0,
            update_count: 0,
            delete_count: 0,
            items: Vec::new(),
        });
    }

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &payload.source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);

    if source.is_salesforce() {
        // Salesforce 暂不支持单事务批量提交，直接返回错误并落日志。
        let message = "Salesforce 暂不支持单事务批量提交（含删除）。".to_string();
        write_system_log(
            &state,
            "ERROR",
            log_category,
            "save_records_with_deletes",
            Some(&payload.source_id),
            Some(&payload.object_name),
            false,
            "批量保存失败。",
            Some(&message),
        );
        return Err(message);
    }

    let create_count = payload.creates.len();
    let update_count = payload.updates.len();
    let delete_count = payload.deletes.len();
    let object_name = payload.object_name.clone();
    let creates = payload.creates.clone();
    let updates = payload.updates.clone();
    let deletes = payload.deletes.clone();
    let (preview_items, preview_fallback_sql) = match preview_save_records_with_deletes_items(
        &source,
        &object_name,
        creates.clone(),
        updates.clone(),
        deletes.clone(),
    )
    .await
    {
        Ok(items) => (items, String::new()),
        Err(error) => (Vec::new(), fallback_mysql_log_detail(&error)),
    };

    // MySQL 下执行单事务提交，失败时直接返回错误信息。
    let save_result = match provider
        .save_records_with_deletes(
            &source,
            &object_name,
            creates.clone(),
            updates.clone(),
            deletes.clone(),
        )
        .await
    {
        Ok(summary) => Ok(summary),
        Err(error) => Err(error),
    };

    match save_result {
        Ok(summary) => {
            let detail = build_mysql_batch_log_detail(
                "save_records_with_deletes",
                &preview_items,
                Some(&summary),
                None,
                &preview_fallback_sql,
            );
            write_system_log(
                &state,
                "INFO",
                log_category,
                "save_records_with_deletes",
                Some(&payload.source_id),
                Some(&payload.object_name),
                true,
                &format!(
                    "批量保存成功,新增 {} 条,更新 {} 条,删除 {} 条。",
                    create_count, update_count, delete_count
                ),
                Some(&detail),
            );
            Ok(summary)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = build_mysql_batch_log_detail(
                "save_records_with_deletes",
                &preview_items,
                None,
                Some(&message),
                &preview_fallback_sql,
            );
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "save_records_with_deletes",
                Some(&payload.source_id),
                Some(&payload.object_name),
                false,
                "批量保存失败。",
                Some(&detail),
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
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);
    let operation_detail = if source.is_salesforce() {
        build_salesforce_update_detail(&source.api_version, &object_name, &record_id, &values, None)
    } else {
        match preview_update_record_sql(&source, &object_name, &record_id, values.clone()).await {
            Ok(detail) => detail,
            Err(error) => fallback_mysql_log_detail(&error),
        }
    };

    let update_result = match provider
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
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
                .update_record(&refreshed_source, &object_name, &record_id, values.clone())
                .await
        }
        Err(error) => Err(error),
    };

    match update_result {
        Ok(()) => {
            let detail = if source.is_salesforce() {
                format!("recordId={record_id}\n{operation_detail}")
            } else {
                build_mysql_single_log_detail(
                    "update",
                    &record_id,
                    &operation_detail,
                    Some(1),
                    true,
                    None,
                )
            };
            write_system_log(
                &state,
                "INFO",
                log_category,
                "update_record",
                Some(&source_id),
                Some(&object_name),
                true,
                "更新记录成功。",
                Some(&detail),
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = if source.is_salesforce() {
                format!("{operation_detail}\nerror={message}")
            } else {
                build_mysql_single_log_detail(
                    "update",
                    &record_id,
                    &operation_detail,
                    Some(0),
                    false,
                    Some(&message),
                )
            };
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "update_record",
                Some(&source_id),
                Some(&object_name),
                false,
                "更新记录失败。",
                Some(&detail),
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
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = resolve_log_category(&source);
    let operation_detail = if source.is_salesforce() {
        build_salesforce_delete_detail(&source.api_version, &object_name, &record_id, None)
    } else {
        match preview_delete_record_sql(&source, &object_name, &record_id).await {
            Ok(detail) => detail,
            Err(error) => fallback_mysql_log_detail(&error),
        }
    };

    let delete_result = match provider
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
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
                .delete_record(&refreshed_source, &object_name, &record_id)
                .await
        }
        Err(error) => Err(error),
    };

    match delete_result {
        Ok(()) => {
            let detail = if source.is_salesforce() {
                format!("recordId={record_id}\n{operation_detail}")
            } else {
                build_mysql_single_log_detail(
                    "delete",
                    &record_id,
                    &operation_detail,
                    Some(1),
                    true,
                    None,
                )
            };
            write_system_log(
                &state,
                "INFO",
                log_category,
                "delete_record",
                Some(&source_id),
                Some(&object_name),
                true,
                "删除记录成功。",
                Some(&detail),
            );
            Ok(())
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            let detail = if source.is_salesforce() {
                format!("{operation_detail}\nerror={message}")
            } else {
                build_mysql_single_log_detail(
                    "delete",
                    &record_id,
                    &operation_detail,
                    Some(0),
                    false,
                    Some(&message),
                )
            };
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "delete_record",
                Some(&source_id),
                Some(&object_name),
                false,
                "删除记录失败。",
                Some(&detail),
            );
            Err(message)
        }
    }
}

