use tauri::{Manager, State};

use crate::app_state::AppState;
use crate::drivers::ProviderCapabilities;
use crate::error::AppError;
use crate::services::audit_service::AuditService;
use crate::services::sql_guard::{evaluate_sql_safety, SqlGuardContext, SqlGuardDecision};
use crate::storage::audit_repo::SqlExecutionAuditEntry;

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

/// 查询 SQL 执行审计日志（异步线程池执行）。
#[tauri::command]
pub async fn list_sql_execution_audits(
    app: tauri::AppHandle,
    source_id: Option<String>,
    limit: Option<i64>,
) -> Result<Vec<SqlExecutionAuditEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let state = app.state::<AppState>();
        AuditService::new(&state.storage)
            .list_sql_audits(source_id.as_deref(), limit.unwrap_or(100))
            .map_err(AppError::to_string_error)
    })
    .await
    .map_err(|e| format!("查询 SQL 审计线程失败: {e}"))?
}
