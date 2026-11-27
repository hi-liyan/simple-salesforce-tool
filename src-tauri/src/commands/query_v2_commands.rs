use tauri::State;

use crate::app_state::AppState;
use crate::drivers::{ConsoleTransactionStatus, TransactionMode};
use crate::error::AppError;
use crate::models::{MutationExecutionResult, RecordSaveWithDeletePayload};
use crate::modules::sql_lsp::{diagnose_sql_ast, split_sql_statements, SqlDiagnostic};
use crate::services::query_service::{GuardedQueryResponse, PreparedMutationPlanDto, QueryService};

/// 单条多语句执行摘要。
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MultiStatementItemResult {
    /// 语句序号（0-based）。
    pub index: usize,
    /// 语句原文。
    pub sql: String,
    /// 单条执行响应。
    pub response: Option<GuardedQueryResponse>,
    /// 失败错误信息（成功时为空）。
    pub error: Option<String>,
}

/// 受安全网关保护的查询执行入口（支持通过 queryId 取消慢查询），返回实际下发 SQL 与审计结果。
#[tauri::command]
pub async fn execute_guarded_query(
    state: State<'_, AppState>,
    source_id: String,
    query_text: String,
    object_name: Option<String>,
    confirmed: Option<bool>,
    query_id: Option<String>,
    session_id: Option<String>,
    raw_sql: Option<String>,
) -> Result<GuardedQueryResponse, String> {
    let (cancel_tx, mut cancel_rx) = tokio::sync::watch::channel(false);
    if let Some(qid) = query_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        if let Ok(mut guard) = state.query_cancels.lock() {
            guard.insert(qid.to_string(), cancel_tx);
        }
    }

    let svc = QueryService::new(&state.storage, &state.driver_registry);
    let fut = svc.execute_guarded_query_with_session_and_raw(
        &source_id,
        &query_text,
        raw_sql.as_deref(),
        object_name.as_deref(),
        confirmed.unwrap_or(false),
        session_id.as_deref(),
    );

    let outcome = tokio::select! {
        res = fut => res.map_err(AppError::to_string_error),
        _ = cancel_rx.changed() => Err("查询已被用户手动取消".to_string()),
    };

    if let Some(qid) = query_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        if let Ok(mut guard) = state.query_cancels.lock() {
            guard.remove(qid);
        }
    }

    outcome
}

/// 取消正在执行中的慢查询。
#[tauri::command]
pub fn cancel_query(state: State<'_, AppState>, query_id: String) -> Result<bool, String> {
    let normalized = query_id.trim();
    if normalized.is_empty() {
        return Ok(false);
    }
    let sender = state
        .query_cancels
        .lock()
        .map_err(|error| format!("锁定查询取消表失败: {error}"))?
        .remove(normalized);
    if let Some(tx) = sender {
        let _ = tx.send(true);
        return Ok(true);
    }
    Ok(false)
}

/// 拆解并顺序执行多条 SQL 语句，返回每条语句的独立结果集与摘要。
#[tauri::command]
pub async fn execute_multi_statement_query(
    state: State<'_, AppState>,
    source_id: String,
    sql_batch: String,
    confirmed: Option<bool>,
    session_id: Option<String>,
) -> Result<Vec<MultiStatementItemResult>, String> {
    let statements = split_sql_statements(&sql_batch);
    let svc = QueryService::new(&state.storage, &state.driver_registry);
    let mut results = Vec::with_capacity(statements.len());

    for (index, stmt) in statements.into_iter().enumerate() {
        match svc
            .execute_guarded_query_with_session(
                &source_id,
                &stmt,
                None,
                confirmed.unwrap_or(false),
                session_id.as_deref(),
            )
            .await
        {
            Ok(resp) => results.push(MultiStatementItemResult {
                index,
                sql: stmt,
                response: Some(resp),
                error: None,
            }),
            Err(err) => results.push(MultiStatementItemResult {
                index,
                sql: stmt,
                response: None,
                error: Some(err.to_string()),
            }),
        }
    }
    Ok(results)
}

/// 基于 `sqlparser` 执行 SQL AST 实时语法诊断。
#[tauri::command]
pub fn diagnose_sql(sql: String, dialect: String) -> Vec<SqlDiagnostic> {
    diagnose_sql_ast(&sql, &dialect)
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

/// 按主键按需读取单个大字段完整内容（用于列表截断后的展开查看）。
#[tauri::command]
pub async fn read_cell_full_value(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
    primary_key_field: String,
    primary_key_value: String,
    column_name: String,
) -> Result<Option<String>, String> {
    let source = crate::services::source_service::SourceService::new(&state.storage)
        .get_runtime_source(&source_id)
        .map_err(AppError::to_string_error)?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .read_cell_full_value(
            &source,
            &object_name,
            &primary_key_field,
            &primary_key_value,
            &column_name,
        )
        .await
        .map_err(AppError::to_string_error)
}

/// 读取指定控制台会话的交互式事务状态。
#[tauri::command]
pub async fn get_console_transaction_status(
    state: State<'_, AppState>,
    source_id: String,
    session_id: String,
) -> Result<ConsoleTransactionStatus, String> {
    let source = crate::services::source_service::SourceService::new(&state.storage)
        .get_runtime_source(&source_id)
        .map_err(AppError::to_string_error)?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .get_console_transaction_status(&source, &session_id)
        .await
        .map_err(AppError::to_string_error)
}

/// 切换指定控制台会话的事务模式（auto / manual / smart）。
#[tauri::command]
pub async fn set_console_transaction_mode(
    state: State<'_, AppState>,
    source_id: String,
    session_id: String,
    mode: TransactionMode,
) -> Result<ConsoleTransactionStatus, String> {
    let source = crate::services::source_service::SourceService::new(&state.storage)
        .get_runtime_source(&source_id)
        .map_err(AppError::to_string_error)?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .set_console_transaction_mode(&source, &session_id, mode)
        .await
        .map_err(AppError::to_string_error)
}

/// 提交指定控制台会话中挂起的事务。
#[tauri::command]
pub async fn commit_console_transaction(
    state: State<'_, AppState>,
    source_id: String,
    session_id: String,
) -> Result<ConsoleTransactionStatus, String> {
    let source = crate::services::source_service::SourceService::new(&state.storage)
        .get_runtime_source(&source_id)
        .map_err(AppError::to_string_error)?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .commit_console_transaction(&source, &session_id)
        .await
        .map_err(AppError::to_string_error)
}

/// 回滚指定控制台会话中挂起的事务。
#[tauri::command]
pub async fn rollback_console_transaction(
    state: State<'_, AppState>,
    source_id: String,
    session_id: String,
) -> Result<ConsoleTransactionStatus, String> {
    let source = crate::services::source_service::SourceService::new(&state.storage)
        .get_runtime_source(&source_id)
        .map_err(AppError::to_string_error)?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(AppError::to_string_error)?;
    driver
        .rollback_console_transaction(&source, &session_id)
        .await
        .map_err(AppError::to_string_error)
}

/// 关闭或重置指定控制台会话（存在未提交事务时自动回滚）。
#[tauri::command]
pub async fn close_console_session(
    state: State<'_, AppState>,
    session_id: String,
) -> Result<(), String> {
    state.connection_manager.close_console_session(&session_id).await;
    Ok(())
}
