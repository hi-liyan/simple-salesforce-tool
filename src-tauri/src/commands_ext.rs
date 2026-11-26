use tauri::State;

use crate::app_state::AppState;
use crate::drivers::ProviderCapabilities;
use crate::error::AppError;
use crate::models::{MutationExecutionResult, RecordSaveWithDeletePayload};
use crate::services::audit_service::AuditService;
use crate::services::plugin_service::PluginService;
use crate::services::query_service::{GuardedQueryResponse, PreparedMutationPlanDto, QueryService};
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

/// 受安全网关保护的查询执行入口，返回实际下发 SQL 与审计结果。
#[tauri::command]
pub async fn execute_guarded_query(
    state: State<'_, AppState>,
    source_id: String,
    query_text: String,
    object_name: Option<String>,
    confirmed: Option<bool>,
) -> Result<GuardedQueryResponse, String> {
    QueryService::new(&state.storage, &state.driver_registry)
        .execute_guarded_query(
            &source_id,
            &query_text,
            object_name.as_deref(),
            confirmed.unwrap_or(false),
        )
        .await
        .map_err(AppError::to_string_error)
}

/// 两阶段提交 Phase 1：编译并缓存变更计划，返回 planId + planHash 与预览 SQL。
#[tauri::command]
pub async fn prepare_mutation_plan(
    state: State<'_, AppState>,
    payload: RecordSaveWithDeletePayload,
) -> Result<PreparedMutationPlanDto, String> {
    QueryService::new(&state.storage, &state.driver_registry)
        .prepare_mutation_plan(&state.mutation_plan_cache, payload)
        .await
        .map_err(AppError::to_string_error)
}

/// 两阶段提交 Phase 2：按 planId + planHash 原样执行已预览的变更计划。
#[tauri::command]
pub async fn commit_mutation_plan(
    state: State<'_, AppState>,
    plan_id: String,
    plan_hash: String,
) -> Result<MutationExecutionResult, String> {
    QueryService::new(&state.storage, &state.driver_registry)
        .commit_mutation_plan(&state.mutation_plan_cache, &plan_id, &plan_hash)
        .await
        .map_err(AppError::to_string_error)
}
