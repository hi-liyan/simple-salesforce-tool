use tauri::State;

use crate::app_state::AppState;
use crate::drivers::ProviderCapabilities;
use crate::error::AppError;
use crate::services::audit_service::AuditService;
use crate::services::plugin_service::PluginService;
use crate::services::sql_guard::{evaluate_sql_safety, SqlGuardContext, SqlGuardDecision};
use crate::storage::audit_repo::SqlExecutionAuditEntry;

/// 读取插件隔离键值存储。
#[tauri::command]
pub fn get_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<Option<String>, String> {
    PluginService::new(&state.storage)
        .get_kv(&plugin_id, &key)
        .map_err(AppError::to_string_error)
}

/// 写入插件隔离键值存储。
#[tauri::command]
pub fn set_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
    value_json: String,
) -> Result<(), String> {
    PluginService::new(&state.storage)
        .set_kv(&plugin_id, &key, &value_json)
        .map_err(AppError::to_string_error)
}

/// 删除插件隔离键值存储。
#[tauri::command]
pub fn delete_plugin_kv(
    state: State<'_, AppState>,
    plugin_id: String,
    key: String,
) -> Result<(), String> {
    PluginService::new(&state.storage)
        .delete_kv(&plugin_id, &key)
        .map_err(AppError::to_string_error)
}

/// 列出全部已注册数据源驱动及其能力声明矩阵。
#[tauri::command]
pub fn list_driver_capabilities(
    state: State<'_, AppState>,
) -> Vec<(String, ProviderCapabilities)> {
    state.driver_registry.list_capabilities()
}

/// 在执行控制台 SQL 前调用后端安全网关进行风险评估。
#[tauri::command]
pub fn check_sql_safety(
    sql: String,
    environment: String,
    read_only: bool,
    confirmed: bool,
) -> SqlGuardDecision {
    evaluate_sql_safety(
        &sql,
        &SqlGuardContext {
            environment,
            read_only,
            confirmed,
        },
    )
}

/// 查询 SQL 执行审计日志。
#[tauri::command]
pub fn list_sql_execution_audits(
    state: State<'_, AppState>,
    source_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<SqlExecutionAuditEntry>, String> {
    AuditService::new(&state.storage)
        .list_sql_audits(source_id.as_deref(), limit.unwrap_or(100))
        .map_err(AppError::to_string_error)
}
