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
    CliPathStatus, CurrentUserContext, DatabaseCollation, DatabaseEvent, DatabaseRoutine,
    DatabaseTrigger, DatabaseUser, LlmSettings, LlmSettingsView, MutationExecutionResult,
    MutationPreviewSqlItem, ObjectDdl, ObjectDescribe, QueryResult, RecordMutationPayload,
    RecordSavePayload, RecordSaveWithDeletePayload, RecordUpdatePayload, SalesforceObject,
    SalesforceSource, SaveLlmSettingsPayload, SourceSecretView, SourceUpsertPayload, SystemLogPage,
    TerminalCommandGroup, TerminalCommandGroupUpsertPayload, TerminalCommandItem,
    TerminalCommandReorderPayload, TerminalCommandUpsertPayload, TerminalShellSettings,
    VirtualView, VirtualViewUpsertPayload, WorkspaceSnapshotDto,
};
use crate::providers::{
    preview_create_record_sql, preview_delete_record_sql, preview_save_records_with_deletes_items,
    preview_update_record_sql, provider_for_source,
};
use crate::services::source_service::SourceService;
use crate::sf_cli;
use crate::terminal::{self as terminal_runtime, TerminalSessionInfo, TerminalShellOption};
use super::common::*;
use super::window_commands::{hydrate_reference_field_child_relationship_names, load_object_describe_with_auto_refresh};

/// 读取对象列表(优先走缓存,缓存失效后再请求 Salesforce)。
#[tauri::command]
pub async fn list_objects(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let cached_objects = state
        .storage
        .read(|connection| db::read_object_cache(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let is_mysql_source = source.source_type.eq_ignore_ascii_case("mysql");

    if let Some(cached) = cached_objects {
        // MySQL 旧缓存可能没有 comment 字段；若整批缓存都缺注释，则自动回源刷新。
        let should_reuse_cache = !is_mysql_source
            || cached.is_empty()
            || cached.iter().any(|item| {
                item.comment
                    .as_deref()
                    .is_some_and(|comment| !comment.trim().is_empty())
            });
        if should_reuse_cache {
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
        write_system_log(
            &state,
            "INFO",
            "SALESFORCE_API",
            "list_objects",
            Some(&source_id),
            None,
            true,
            "检测到 MySQL 对象缓存缺少表注释，已自动回源刷新。",
            None,
        );
    }
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;

    let objects_result = match provider.list_objects(&source).await {
        Ok(items) => Ok(items),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "list_objects", None)
                    .await
                    .map_err(AppError::to_string_error)?;
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider.list_objects(&refreshed_source).await
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

    state
        .storage
        .write(|connection| db::write_object_cache(connection, &source_id, &objects))
        .map_err(AppError::to_string_error)?;

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


#[tauri::command]
pub async fn refresh_objects(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;

    let objects_result = match provider.list_objects(&source).await {
        Ok(items) => Ok(items),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(&app, &state, &source_id, "refresh_objects", None)
                    .await
                    .map_err(AppError::to_string_error)?;
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider.list_objects(&refreshed_source).await
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

    state
        .storage
        .write(|connection| {
            // 强制刷新成功后覆盖对象列表缓存，并失效该数据源的对象级元数据缓存。
            db::write_object_cache(connection, &source_id, &objects)?;
            db::clear_source_metadata_cache(connection, &source_id)
        })
        .map_err(AppError::to_string_error)?;

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


#[tauri::command]
pub async fn describe_object(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<ObjectDescribe, String> {
    // 先读 SQLite 元数据缓存，命中时直接返回，避免重复请求远端。
    let cached_describe = state
        .storage
        .read(|connection| {
            db::read_source_metadata_cache(
                connection,
                &source_id,
                METADATA_TYPE_OBJECT_DESCRIBE,
                Some(&object_name),
            )
        })
        .map_err(AppError::to_string_error)?;
    if let Some(payload) = cached_describe {
        match serde_json::from_str::<ObjectDescribe>(&payload) {
            Ok(describe) => {
                write_system_log(
                    &state,
                    "INFO",
                    "SALESFORCE_API",
                    "describe_object",
                    Some(&source_id),
                    Some(&object_name),
                    true,
                    "命中对象字段元数据缓存。",
                    None,
                );
                return Ok(describe);
            }
            Err(parse_error) => {
                write_system_log(
                    &state,
                    "ERROR",
                    "SALESFORCE_API",
                    "describe_object",
                    Some(&source_id),
                    Some(&object_name),
                    false,
                    "对象字段元数据缓存解析失败，将回源重拉。",
                    Some(&parse_error.to_string()),
                );
            }
        }
    }

    let mut source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;

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
            {
                let payload = serde_json::to_string(&describe)
                    .map_err(|error| AppError::Serde(error.to_string()).to_string_error())?;
                state
                    .storage
                    .write(|connection| {
                        db::write_source_metadata_cache(
                            connection,
                            &source_id,
                            METADATA_TYPE_OBJECT_DESCRIBE,
                            Some(&object_name),
                            &payload,
                        )
                    })
                    .map_err(AppError::to_string_error)?;
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

/// 读取对象 DDL（MySQL 返回建表/索引/约束 DDL）。
#[tauri::command]
pub async fn get_object_ddl(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<ObjectDdl, String> {
    // 先读 SQLite 元数据缓存，命中时直接返回，避免重复请求数据库/远端。
    let cached_ddl = state
        .storage
        .read(|connection| {
            db::read_source_metadata_cache(
                connection,
                &source_id,
                METADATA_TYPE_OBJECT_DDL,
                Some(&object_name),
            )
        })
        .map_err(AppError::to_string_error)?;
    if let Some(payload) = cached_ddl {
        if let Ok(ddl) = serde_json::from_str::<ObjectDdl>(&payload) {
            return Ok(ddl);
        }
    }

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;
    let log_category = if source.is_salesforce() {
        "SALESFORCE_API"
    } else {
        "MYSQL_DB"
    };

    match provider.get_object_ddl(&source, &object_name).await {
        Ok(ddl) => {
            {
                let payload = serde_json::to_string(&ddl)
                    .map_err(|error| AppError::Serde(error.to_string()).to_string_error())?;
                state
                    .storage
                    .write(|connection| {
                        db::write_source_metadata_cache(
                            connection,
                            &source_id,
                            METADATA_TYPE_OBJECT_DDL,
                            Some(&object_name),
                            &payload,
                        )
                    })
                    .map_err(AppError::to_string_error)?;
            }
            write_system_log(
                &state,
                "INFO",
                log_category,
                "get_object_ddl",
                Some(&source_id),
                Some(&object_name),
                true,
                "读取对象 DDL 成功。",
                None,
            );
            Ok(ddl)
        }
        Err(error) => {
            let message = AppError::to_string_error(error);
            write_system_log(
                &state,
                "ERROR",
                log_category,
                "get_object_ddl",
                Some(&source_id),
                Some(&object_name),
                false,
                "读取对象 DDL 失败。",
                Some(&message),
            );
            Err(message)
        }
    }
}

/// 异步读取运行时数据源（含解密凭证），避免在命令主线程直接阻塞等待 SQLite 读锁。
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

    let source = state
        .storage
        .read(|connection| db::get_source(connection, &source_id))
        .map_err(AppError::to_string_error)?;
    let provider =
        provider_for_source(state.inner(), &source).map_err(AppError::to_string_error)?;

    let resolve_result = match provider
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
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)
                .map_err(AppError::to_string_error)?;
            refreshed_provider
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

/// 异步读取运行时数据源（含解密凭证），避免在命令主线程直接阻塞等待 SQLite 读锁。
async fn load_runtime_source_async(
    app: &tauri::AppHandle,
    source_id: String,
) -> Result<SalesforceSource, String> {
    let app_handle = app.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let state = app_handle.state::<AppState>();
        SourceService::new(&state.storage)
            .get_runtime_source(&source_id)
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("读取数据源任务执行失败: {error}"))?
}

/// 拉取指定数据源下的真实视图列表。
#[tauri::command]
pub async fn list_views(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<SalesforceObject>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_views(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定数据源下的字符集排序规则列表。
#[tauri::command]
pub async fn list_collations(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<DatabaseCollation>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_collations(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定数据源下的数据库用户账号列表。
#[tauri::command]
pub async fn list_users(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<DatabaseUser>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_users(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定数据源下的存储过程与函数列表。
#[tauri::command]
pub async fn list_routines(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<DatabaseRoutine>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_routines(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定数据源下的触发器列表。
#[tauri::command]
pub async fn list_triggers(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<DatabaseTrigger>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_triggers(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 拉取指定数据源下的定时事件列表。
#[tauri::command]
pub async fn list_events(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
) -> Result<Vec<DatabaseEvent>, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .list_events(&source)
        .await
        .map_err(AppError::to_string_error)
}

/// 读取存储过程/函数、触发器或定时事件的 DDL 定义。
#[tauri::command]
pub async fn get_schema_object_ddl(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
    source_id: String,
    object_kind: String,
    object_name: String,
    routine_type: Option<String>,
) -> Result<String, String> {
    let source = load_runtime_source_async(&app, source_id).await?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .get_schema_object_ddl(&source, &object_kind, &object_name, routine_type.as_deref())
        .await
        .map_err(AppError::to_string_error)
}

/// 列出指定数据源下的全部本地自定义虚拟视图。
#[tauri::command]
pub async fn list_virtual_views(
    app: tauri::AppHandle,
    source_id: String,
) -> Result<Vec<VirtualView>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .read(|conn| crate::storage::virtual_view_repo::list_virtual_views(conn, &source_id))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("读取虚拟视图列表任务失败: {error}"))?
}

/// 新建或更新本地自定义虚拟视图。
#[tauri::command]
pub async fn upsert_virtual_view(
    app: tauri::AppHandle,
    payload: VirtualViewUpsertPayload,
) -> Result<VirtualView, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::virtual_view_repo::upsert_virtual_view(conn, &payload))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("保存虚拟视图任务失败: {error}"))?
}

/// 删除指定本地自定义虚拟视图。
#[tauri::command]
pub async fn delete_virtual_view(app: tauri::AppHandle, id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        state
            .storage
            .write(|conn| crate::storage::virtual_view_repo::delete_virtual_view(conn, &id))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|error| format!("删除虚拟视图任务失败: {error}"))?
}

