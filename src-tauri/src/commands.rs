use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
#[cfg(target_os = "windows")]
use std::process::Command as StdCommand;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::Emitter;
use tauri::Manager;
use tauri::State;
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
use crate::sf_cli;
use crate::terminal::{self as terminal_runtime, TerminalSessionInfo, TerminalShellOption};

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
    if let Ok(connection) = state.storage.connection() {
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

/// MySQL 结构化日志 schema：供前端识别新版 mutation 日志详情。
const MYSQL_MUTATION_LOG_SCHEMA: &str = "mysql-mutation-log/v1";

/// MySQL 单条变更日志项：对应一条 create/update/delete 的执行摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MysqlMutationLogDetailItem {
    /// 操作类型：create/update/delete。
    operation_type: String,
    /// 同类操作内的顺序索引；未知时为空。
    operation_index: Option<usize>,
    /// 当前操作的记录定位值。
    record_locator: String,
    /// 当前操作影响行数；未知时为空。
    rows_affected: Option<u64>,
    /// 当前操作对应的执行预览 SQL。
    preview_sql: String,
    /// 当前操作错误信息；成功时为空字符串。
    error: String,
    /// 当前操作是否成功。
    success: bool,
}

/// MySQL 结构化日志详情：用于系统日志页增强展示与失败定位。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct MysqlMutationLogDetail {
    /// schema 版本：便于前端兼容不同 detail 结构。
    schema: String,
    /// 执行模式：批量提交为 transaction，单条操作为 single。
    execution_mode: String,
    /// 最终结果：success/failed。
    result: String,
    /// 顶层操作类型：如 create/update/delete/save_records_with_deletes。
    operation_type: String,
    /// 顶层失败或主操作的序号；未知时为空。
    operation_index: Option<usize>,
    /// 顶层失败或主操作的记录定位值。
    record_locator: String,
    /// 顶层失败或主操作的影响行数；未知时为空。
    rows_affected: Option<u64>,
    /// 汇总后的执行预览 SQL 文本。
    preview_sql: String,
    /// 顶层错误信息；成功时为空字符串。
    error: String,
    /// 批量提交时的逐条执行结果。
    items: Vec<MysqlMutationLogDetailItem>,
}

/// MySQL 失败上下文：从错误文本中提取序号、定位值与原因，便于写入结构化日志。
#[derive(Debug, Clone, Default)]
struct MysqlMutationFailureContext {
    /// 失败操作类型：create/update/delete。
    operation_type: String,
    /// 失败操作序号；未知时为空。
    operation_index: Option<usize>,
    /// 失败操作的记录定位值。
    record_locator: String,
    /// 失败原因文本。
    error: String,
}

/// 从错误文本中提取 marker 之后的连续 ASCII 数字。
fn extract_numeric_marker(message: &str, marker: &str) -> Option<usize> {
    let start = message.find(marker)? + marker.len();
    let digits: String = message[start..]
        .chars()
        .take_while(|ch| ch.is_ascii_digit())
        .collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<usize>().ok()
}

/// 从错误文本中提取 marker 之后直到分隔符的片段。
fn extract_text_marker(message: &str, marker: &str) -> String {
    let Some(start) = message.find(marker) else {
        return String::new();
    };
    message[start + marker.len()..]
        .chars()
        .take_while(|ch| !matches!(ch, '，' | ',' | '\n' | '\r'))
        .collect::<String>()
        .trim()
        .to_string()
}

/// 解析 MySQL 失败文本中的操作类型、序号与记录定位值。
fn parse_mysql_mutation_failure_context(message: &str) -> MysqlMutationFailureContext {
    let operation_type = if message.contains("MySQL create") {
        "create"
    } else if message.contains("MySQL update") {
        "update"
    } else if message.contains("MySQL delete") {
        "delete"
    } else {
        ""
    }
    .to_string();

    let error = if let Some(index) = message.find("原因：") {
        message[index + "原因：".len()..].trim().to_string()
    } else if let Some(index) = message.find("原因:") {
        message[index + "原因:".len()..].trim().to_string()
    } else {
        message.trim().to_string()
    };

    MysqlMutationFailureContext {
        operation_type,
        operation_index: extract_numeric_marker(message, "operation_index="),
        record_locator: extract_text_marker(message, "record_locator="),
        error,
    }
}

/// 统一构造“执行预览 SQL”回退文本，避免再误导为驱动层原始 SQL。
fn fallback_mysql_log_detail(error: &AppError) -> String {
    format!("-- 执行预览 SQL 生成失败：{error}")
}

/// 生成单条日志项标签：例如 update#1。
fn build_mysql_log_item_label(operation_type: &str, operation_index: Option<usize>) -> String {
    match operation_index {
        Some(index) => format!("{operation_type}#{index}"),
        None => operation_type.to_string(),
    }
}

/// 把结构化日志项汇总成可读的执行预览 SQL 文本。
fn build_mysql_log_preview_sql(items: &[MysqlMutationLogDetailItem], fallback_sql: &str) -> String {
    if items.is_empty() {
        return fallback_sql.to_string();
    }
    items
        .iter()
        .map(|item| {
            format!(
                "[{}] {}",
                build_mysql_log_item_label(&item.operation_type, item.operation_index),
                item.preview_sql
            )
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// 将结构化日志对象序列化为 detail 文本；序列化失败时回退到可读字符串。
fn serialize_mysql_log_detail(detail: &MysqlMutationLogDetail) -> String {
    serde_json::to_string(detail).unwrap_or_else(|error| {
        format!(
            "执行模式={}\n执行结果={}\n执行预览 SQL:\n{}\nerror={}",
            detail.execution_mode, detail.result, detail.preview_sql, error
        )
    })
}

/// 基于批量预览项构造结构化日志子项；失败时会把错误挂到对应失败项上。
fn build_mysql_preview_log_items(
    preview_items: &[MutationPreviewSqlItem],
    failure_context: Option<&MysqlMutationFailureContext>,
    default_success: bool,
) -> Vec<MysqlMutationLogDetailItem> {
    preview_items
        .iter()
        .map(|item| {
            let matched_failure = failure_context.filter(|context| {
                context.operation_type == item.op
                    && context.operation_index == Some(item.operation_index)
            });
            MysqlMutationLogDetailItem {
                operation_type: item.op.clone(),
                operation_index: Some(item.operation_index),
                record_locator: matched_failure
                    .map(|context| context.record_locator.clone())
                    .unwrap_or_default(),
                rows_affected: None,
                preview_sql: item.preview_sql.clone(),
                error: matched_failure
                    .map(|context| context.error.clone())
                    .unwrap_or_default(),
                success: default_success && matched_failure.is_none(),
            }
        })
        .collect()
}

/// 基于真实执行结果构造结构化日志子项。
fn build_mysql_execution_log_items(
    execution_items: &[crate::models::MutationExecutionItem],
) -> Vec<MysqlMutationLogDetailItem> {
    execution_items
        .iter()
        .map(|item| MysqlMutationLogDetailItem {
            operation_type: item.op.clone(),
            operation_index: Some(item.operation_index),
            record_locator: item.row_locator.clone(),
            rows_affected: Some(item.rows_affected),
            preview_sql: item.preview_sql.clone(),
            error: item.error.clone(),
            success: item.success,
        })
        .collect()
}

/// 构造单条 MySQL mutation 的结构化日志详情。
fn build_mysql_single_log_detail(
    operation_type: &str,
    record_locator: &str,
    preview_sql: &str,
    rows_affected: Option<u64>,
    success: bool,
    error: Option<&str>,
) -> String {
    let item = MysqlMutationLogDetailItem {
        operation_type: operation_type.to_string(),
        operation_index: Some(0),
        record_locator: record_locator.to_string(),
        rows_affected,
        preview_sql: preview_sql.to_string(),
        error: error.unwrap_or_default().to_string(),
        success,
    };
    let preview_sql_text = build_mysql_log_preview_sql(std::slice::from_ref(&item), preview_sql);
    serialize_mysql_log_detail(&MysqlMutationLogDetail {
        schema: MYSQL_MUTATION_LOG_SCHEMA.to_string(),
        execution_mode: "single".to_string(),
        result: if success { "success" } else { "failed" }.to_string(),
        operation_type: operation_type.to_string(),
        operation_index: Some(0),
        record_locator: record_locator.to_string(),
        rows_affected,
        preview_sql: preview_sql_text,
        error: error.unwrap_or_default().to_string(),
        items: vec![item],
    })
}

/// 构造批量 MySQL mutation 的结构化日志详情。
fn build_mysql_batch_log_detail(
    operation_type: &str,
    preview_items: &[MutationPreviewSqlItem],
    execution_result: Option<&MutationExecutionResult>,
    error_message: Option<&str>,
    preview_fallback_sql: &str,
) -> String {
    let failure_context = error_message.map(parse_mysql_mutation_failure_context);
    let items = if let Some(summary) = execution_result {
        build_mysql_execution_log_items(&summary.items)
    } else {
        build_mysql_preview_log_items(
            preview_items,
            failure_context.as_ref(),
            error_message.is_none(),
        )
    };
    let failed_item = items.iter().find(|item| !item.success);
    let preview_sql = build_mysql_log_preview_sql(&items, preview_fallback_sql);
    let rows_affected_values = items
        .iter()
        .filter_map(|item| item.rows_affected)
        .collect::<Vec<_>>();
    let rows_affected = if let Some(item) = failed_item {
        item.rows_affected
    } else if rows_affected_values.is_empty() {
        None
    } else {
        Some(rows_affected_values.into_iter().sum())
    };

    serialize_mysql_log_detail(&MysqlMutationLogDetail {
        schema: MYSQL_MUTATION_LOG_SCHEMA.to_string(),
        execution_mode: "transaction".to_string(),
        result: if error_message.is_none() {
            "success"
        } else {
            "failed"
        }
        .to_string(),
        operation_type: operation_type.to_string(),
        operation_index: failed_item
            .and_then(|item| item.operation_index)
            .or(failure_context
                .as_ref()
                .and_then(|context| context.operation_index)),
        record_locator: failed_item
            .map(|item| item.record_locator.clone())
            .filter(|value| !value.is_empty())
            .or_else(|| {
                failure_context
                    .as_ref()
                    .map(|context| context.record_locator.clone())
                    .filter(|value| !value.is_empty())
            })
            .unwrap_or_default(),
        rows_affected,
        preview_sql,
        error: failed_item
            .map(|item| item.error.clone())
            .filter(|value| !value.is_empty())
            .or_else(|| error_message.map(|value| value.to_string()))
            .unwrap_or_default(),
        items,
    })
}

const SF_CLI_PATH_SETTING_KEY: &str = "sf_cli_path";
const LLM_SETTINGS_KEY: &str = "llm.settings.openai";
const TERMINAL_SHELL_COMMAND_KEY: &str = "terminal.shell.command";
const LEGACY_TERMINAL_SHELL_PREFERENCE_KEY: &str = "terminal.shell.preference";
const METADATA_TYPE_OBJECT_DESCRIBE: &str = "object_describe";
const METADATA_TYPE_OBJECT_DDL: &str = "object_ddl";

/// 读取已配置的自定义 Salesforce CLI 路径。
fn read_configured_cli_path(state: &State<'_, AppState>) -> Option<String> {
    let connection = state.storage.connection().ok()?;
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

/// 按数据源类型返回系统日志分类。
fn resolve_log_category(source: &SalesforceSource) -> &'static str {
    if source.is_salesforce() {
        "SALESFORCE_API"
    } else {
        "MYSQL_DB"
    }
}

/// 构造 Salesforce 查询日志详情。
fn build_salesforce_query_detail(api_version: &str, soql: &str) -> String {
    format!("api=GET /services/data/{api_version}/query\nsoql={soql}")
}

/// 构造 MySQL 查询日志详情。
fn build_mysql_query_detail(sql: &str) -> String {
    format!("raw_sql:\n{sql}")
}

/// 构造 Salesforce 可选 trace_soql 附加信息，明确标记其仅用于辅助排查。
fn build_salesforce_optional_trace_detail(trace_soql: Option<String>) -> Option<String> {
    trace_soql.map(|item| {
        format!("optional_trace_soql={item}\ntrace_soql_note=辅助排查语句，非实际执行请求")
    })
}

/// 构造 Salesforce 新增日志详情：仅记录真实执行的 API 请求，trace_soql 为可选辅助信息。
fn build_salesforce_create_detail(
    api_version: &str,
    object_name: &str,
    values: &HashMap<String, Value>,
    trace_soql: Option<String>,
) -> String {
    let payload = serde_json::to_string(values).unwrap_or_else(|_| "{}".to_string());
    let mut detail =
        format!("api=POST /services/data/{api_version}/sobjects/{object_name}\npayload={payload}");
    // 仅在显式需要白盒追踪时附加辅助语句，避免与真实执行请求混淆。
    if let Some(trace_detail) = build_salesforce_optional_trace_detail(trace_soql) {
        detail.push('\n');
        detail.push_str(&trace_detail);
    }
    detail
}

/// 构造 Salesforce 更新日志详情：仅记录真实执行的 API 请求，trace_soql 为可选辅助信息。
fn build_salesforce_update_detail(
    api_version: &str,
    object_name: &str,
    record_id: &str,
    values: &HashMap<String, Value>,
    trace_soql: Option<String>,
) -> String {
    let payload = serde_json::to_string(values).unwrap_or_else(|_| "{}".to_string());
    let mut detail = format!(
        "api=PATCH /services/data/{api_version}/sobjects/{object_name}/{record_id}\npayload={payload}"
    );
    // 仅在显式需要白盒追踪时附加辅助语句，避免与真实执行请求混淆。
    if let Some(trace_detail) = build_salesforce_optional_trace_detail(trace_soql) {
        detail.push('\n');
        detail.push_str(&trace_detail);
    }
    detail
}

/// 构造 Salesforce 删除日志详情：仅记录真实执行的 API 请求，trace_soql 为可选辅助信息。
fn build_salesforce_delete_detail(
    api_version: &str,
    object_name: &str,
    record_id: &str,
    trace_soql: Option<String>,
) -> String {
    let mut detail =
        format!("api=DELETE /services/data/{api_version}/sobjects/{object_name}/{record_id}");
    // 仅在显式需要白盒追踪时附加辅助语句，避免与真实执行请求混淆。
    if let Some(trace_detail) = build_salesforce_optional_trace_detail(trace_soql) {
        detail.push('\n');
        detail.push_str(&trace_detail);
    }
    detail
}

/// 构造 Salesforce 批量保存日志详情：记录真实执行的 Composite API 请求体。
fn build_salesforce_save_detail(
    api_version: &str,
    object_name: &str,
    creates: &[HashMap<String, Value>],
    updates: &[RecordUpdatePayload],
    trace_soql: Option<String>,
) -> String {
    let mut composite_request: Vec<Value> = Vec::with_capacity(creates.len() + updates.len());
    // 新增请求逐条映射为实际 Composite 子请求。
    for (index, item) in creates.iter().enumerate() {
        composite_request.push(serde_json::json!({
            "method": "POST",
            "url": format!("/services/data/{api_version}/sobjects/{object_name}"),
            "referenceId": format!("create_{index}"),
            "body": item,
        }));
    }
    // 更新请求逐条映射为实际 Composite 子请求。
    for (index, item) in updates.iter().enumerate() {
        composite_request.push(serde_json::json!({
            "method": "PATCH",
            "url": format!("/services/data/{api_version}/sobjects/{object_name}/{}", item.record_id),
            "referenceId": format!("update_{index}"),
            "body": item.values,
        }));
    }
    let payload = serde_json::json!({
        "allOrNone": true,
        "compositeRequest": composite_request,
    });
    let payload_text = serde_json::to_string(&payload).unwrap_or_else(|_| "{}".to_string());
    let mut detail =
        format!("api=POST /services/data/{api_version}/composite\npayload={payload_text}");
    // 仅在显式需要白盒追踪时附加辅助语句，避免与真实执行请求混淆。
    if let Some(trace_detail) = build_salesforce_optional_trace_detail(trace_soql) {
        detail.push('\n');
        detail.push_str(&trace_detail);
    }
    detail
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
                .storage
                .connection()
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
        .storage
        .connection()
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
            .storage
            .connection()
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
        .storage
        .connection()
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
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::create_source(&connection, payload).map_err(AppError::to_string_error)
}

/// 读取单个数据源的公共信息。
#[tauri::command]
pub fn get_source(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SalesforceSource, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    let sources = db::list_sources(&connection).map_err(AppError::to_string_error)?;
    sources
        .into_iter()
        .find(|item| item.id == source_id)
        .ok_or_else(|| format!("未找到数据源: {source_id}"))
}

/// 显式读取设置页编辑链路需要的 secret 明文。
#[tauri::command]
pub fn get_source_secret_view(
    state: State<'_, AppState>,
    source_id: String,
) -> Result<SourceSecretView, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::get_source_secret_view(&connection, &source_id).map_err(AppError::to_string_error)
}

/// 按前端传入顺序重排数据源序号。
#[tauri::command]
pub fn reorder_sources(
    state: State<'_, AppState>,
    ordered_ids: Vec<String>,
) -> Result<Vec<SalesforceSource>, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::reorder_sources(&connection, &ordered_ids).map_err(AppError::to_string_error)
}

/// 测试数据源连接可用性（不写库）。
#[tauri::command]
pub async fn test_source_connection(
    state: State<'_, AppState>,
    payload: SourceUpsertPayload,
) -> Result<(), String> {
    validate_payload(&payload)?;
    let probe_source = SalesforceSource {
        id: "probe".to_string(),
        name: payload.name.clone(),
        sort_order: 0,
        source_type: payload.source_type.clone(),
        config_json: payload.config_json.clone(),
        instance_url: payload.instance_url.clone(),
        access_token: payload.access_token.clone(),
        api_version: payload.api_version.clone(),
        created_at: "".to_string(),
        updated_at: "".to_string(),
    };
    let provider =
        provider_for_source(state.inner(), &probe_source).map_err(AppError::to_string_error)?;
    provider
        .test_connection(&probe_source)
        .await
        .map_err(AppError::to_string_error)
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
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::update_source(&connection, &id, payload).map_err(AppError::to_string_error)
}

/// 删除数据源。
#[tauri::command]
pub fn delete_source(state: State<'_, AppState>, id: String) -> Result<(), String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::delete_source(&connection, &id).map_err(AppError::to_string_error)
}

/// 读取结构化工作区快照。
#[tauri::command]
pub fn load_workspace_snapshot(state: State<'_, AppState>) -> Result<WorkspaceSnapshotDto, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::load_workspace_snapshot(&connection).map_err(AppError::to_string_error)
}

/// 保存结构化工作区快照。
#[tauri::command]
pub fn save_workspace_snapshot(
    state: State<'_, AppState>,
    payload: WorkspaceSnapshotDto,
) -> Result<(), String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::save_workspace_snapshot(&connection, &payload).map_err(AppError::to_string_error)
}

/// 读取对象字段可见性配置。
#[tauri::command]
pub fn get_column_visibility(
    state: State<'_, AppState>,
    source_id: String,
    object_name: String,
) -> Result<HashMap<String, bool>, String> {
    let connection = state
        .storage
        .connection()
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
        .storage
        .connection()
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
    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
    let cached_objects = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::read_object_cache(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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

    {
        let connection = state
            .storage
            .connection()
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
            .storage
            .connection()
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
            .storage
            .connection()
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
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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

    {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        // 强制刷新成功后覆盖对象列表缓存，并失效该数据源的对象级元数据缓存。
        db::write_object_cache(&connection, &source_id, &objects)
            .map_err(AppError::to_string_error)?;
        db::clear_source_metadata_cache(&connection, &source_id)
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
    if !source.is_salesforce() {
        return Err("当前数据源不支持打开 Salesforce 页面。".to_string());
    }
    let provider = provider_for_source(state.inner(), source).map_err(AppError::to_string_error)?;
    // 快速校验:通过轻量级 API 请求检测 token 是否仍然有效。
    let token_valid = provider.validate_token(source).await;

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
            .storage
            .connection()
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
            .storage
            .connection()
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
            .storage
            .connection()
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
    let provider = provider_for_source(state.inner(), source)?;
    match provider.describe_object(source, object_name).await {
        Ok(describe) => Ok(describe),
        Err(error) if is_unauthorized_error(&error) && source_id.starts_with("cli-") => {
            let refreshed_source =
                refresh_cli_source_token(app, state, source_id, action, Some(object_name)).await?;
            // 刷新成功后覆盖当前 source,确保后续父对象 describe 复用最新 token。
            *source = refreshed_source.clone();
            let refreshed_provider = provider_for_source(state.inner(), &refreshed_source)?;
            refreshed_provider
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
    // 先读 SQLite 元数据缓存，命中时直接返回，避免重复请求远端。
    let cached_describe = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::read_source_metadata_cache(
            &connection,
            &source_id,
            METADATA_TYPE_OBJECT_DESCRIBE,
            Some(&object_name),
        )
        .map_err(AppError::to_string_error)?
    };
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

    let mut source = {
        let connection = state
            .storage
            .connection()
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
            {
                let connection = state
                    .storage
                    .connection()
                    .map_err(|error| format!("Database lock failed: {error}"))?;
                let payload = serde_json::to_string(&describe)
                    .map_err(|error| AppError::Serde(error.to_string()).to_string_error())?;
                db::write_source_metadata_cache(
                    &connection,
                    &source_id,
                    METADATA_TYPE_OBJECT_DESCRIBE,
                    Some(&object_name),
                    &payload,
                )
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
    let cached_ddl = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::read_source_metadata_cache(
            &connection,
            &source_id,
            METADATA_TYPE_OBJECT_DDL,
            Some(&object_name),
        )
        .map_err(AppError::to_string_error)?
    };
    if let Some(payload) = cached_ddl {
        if let Ok(ddl) = serde_json::from_str::<ObjectDdl>(&payload) {
            return Ok(ddl);
        }
    }

    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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
                let connection = state
                    .storage
                    .connection()
                    .map_err(|error| format!("Database lock failed: {error}"))?;
                let payload = serde_json::to_string(&ddl)
                    .map_err(|error| AppError::Serde(error.to_string()).to_string_error())?;
                db::write_source_metadata_cache(
                    &connection,
                    &source_id,
                    METADATA_TYPE_OBJECT_DDL,
                    Some(&object_name),
                    &payload,
                )
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
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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

    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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
    let connection = state
        .storage
        .connection()
        .map_err(|error| AppError::Biz(format!("Database lock failed: {error}")))?;
    let payload = db::read_source_metadata_cache(
        &connection,
        source_id,
        METADATA_TYPE_OBJECT_DESCRIBE,
        Some(object_name),
    )?;
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
    let connection = state
        .storage
        .connection()
        .map_err(|error| AppError::Biz(format!("Database lock failed: {error}")))?;
    db::write_source_metadata_cache(
        &connection,
        source_id,
        METADATA_TYPE_OBJECT_DESCRIBE,
        Some(object_name),
        &payload,
    )?;

    Ok(Some(describe))
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
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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
    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };
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

    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };
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

    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };
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

    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &payload.source_id).map_err(AppError::to_string_error)?
    };
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
    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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
    let source = {
        let connection = state
            .storage
            .connection()
            .map_err(|error| format!("Database lock failed: {error}"))?;
        db::get_source(&connection, &source_id).map_err(AppError::to_string_error)?
    };
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

/// 读取 LLM 设置,未配置时返回默认值。
fn read_llm_settings(state: &State<'_, AppState>) -> Result<LlmSettings, String> {
    let connection = state
        .storage
        .connection()
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

/// 读取全局终端命令组（含命令列表）。
#[tauri::command]
pub fn list_terminal_command_groups(
    state: State<'_, AppState>,
) -> Result<Vec<TerminalCommandGroup>, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::list_terminal_command_groups(&connection).map_err(AppError::to_string_error)
}

/// 创建终端命令组。
#[tauri::command]
pub fn create_terminal_command_group(
    state: State<'_, AppState>,
    name: String,
) -> Result<TerminalCommandGroup, String> {
    let normalized_name = name.trim().to_string();
    if normalized_name.is_empty() {
        return Err("命令组名称不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::create_terminal_command_group(&connection, &normalized_name)
        .map_err(AppError::to_string_error)
}

/// 更新终端命令组名称。
#[tauri::command]
pub fn update_terminal_command_group(
    state: State<'_, AppState>,
    group_id: String,
    payload: TerminalCommandGroupUpsertPayload,
) -> Result<TerminalCommandGroup, String> {
    let normalized_group_id = group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::update_terminal_command_group(&connection, &normalized_group_id, &payload.name)
        .map_err(AppError::to_string_error)
}

/// 创建终端命令。
#[tauri::command]
pub fn create_terminal_command(
    state: State<'_, AppState>,
    payload: TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::create_terminal_command(&connection, &payload).map_err(AppError::to_string_error)
}

/// 更新终端命令。
#[tauri::command]
pub fn update_terminal_command(
    state: State<'_, AppState>,
    command_id: String,
    payload: TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, String> {
    let normalized_command_id = command_id.trim().to_string();
    if normalized_command_id.is_empty() {
        return Err("commandId 不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::update_terminal_command(&connection, &normalized_command_id, &payload)
        .map_err(AppError::to_string_error)
}

/// 删除终端命令。
#[tauri::command]
pub fn delete_terminal_command(
    state: State<'_, AppState>,
    group_id: String,
    command_id: String,
) -> Result<(), String> {
    let normalized_group_id = group_id.trim().to_string();
    let normalized_command_id = command_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }
    if normalized_command_id.is_empty() {
        return Err("commandId 不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::delete_terminal_command(&connection, &normalized_group_id, &normalized_command_id)
        .map_err(AppError::to_string_error)
}

/// 删除终端命令组。
#[tauri::command]
pub fn delete_terminal_command_group(
    state: State<'_, AppState>,
    group_id: String,
) -> Result<(), String> {
    let normalized_group_id = group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::delete_terminal_command_group(&connection, &normalized_group_id)
        .map_err(AppError::to_string_error)
}

/// 调整终端命令排序。
#[tauri::command]
pub fn reorder_terminal_commands(
    state: State<'_, AppState>,
    payload: TerminalCommandReorderPayload,
) -> Result<(), String> {
    let normalized_group_id = payload.group_id.trim().to_string();
    if normalized_group_id.is_empty() {
        return Err("groupId 不能为空".to_string());
    }

    if payload.command_ids.is_empty() {
        return Err("commandIds 不能为空".to_string());
    }

    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::reorder_terminal_commands(&connection, &payload).map_err(AppError::to_string_error)
}

/// 打开终端会话：每个前端 Tab 对应一个系统终端进程。
#[tauri::command]
pub fn open_terminal_session(
    app_handle: tauri::AppHandle,
    state: State<'_, AppState>,
    tab_id: String,
    cols: Option<u16>,
    rows: Option<u16>,
    initial_command: Option<String>,
) -> Result<TerminalSessionInfo, String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    // 读取终端首选 shell 命令配置（动态路径，不限制固定版本）。
    let preferred_shell_command = read_terminal_shell_command(&state);

    terminal_runtime::open_terminal_session(
        &app_handle,
        &state.terminal_sessions,
        normalized_tab_id,
        cols.unwrap_or(120),
        rows.unwrap_or(36),
        preferred_shell_command.as_deref(),
        initial_command.as_deref(),
    )
}

/// 列出当前系统可用终端 Shell（用于设置页下拉选择）。
#[tauri::command]
pub fn list_available_terminal_shells() -> Result<Vec<TerminalShellOption>, String> {
    Ok(terminal_runtime::list_available_terminal_shells())
}

/// 读取终端 Shell 设置：包含当前保存值与旧版兼容字段。
#[tauri::command]
pub fn get_terminal_shell_settings(
    state: State<'_, AppState>,
) -> Result<TerminalShellSettings, String> {
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    Ok(TerminalShellSettings {
        command_value: db::read_app_setting(&connection, TERMINAL_SHELL_COMMAND_KEY)
            .map_err(AppError::to_string_error)?,
        legacy_preference: db::read_app_setting(&connection, LEGACY_TERMINAL_SHELL_PREFERENCE_KEY)
            .map_err(AppError::to_string_error)?,
    })
}

/// 保存终端 Shell 命令路径。
#[tauri::command]
pub fn save_terminal_shell_command(
    state: State<'_, AppState>,
    command: String,
) -> Result<(), String> {
    let normalized_command = command.trim().to_string();
    if normalized_command.is_empty() {
        return Err("终端 Shell 命令不能为空".to_string());
    }
    let connection = state
        .storage
        .connection()
        .map_err(|error| format!("Database lock failed: {error}"))?;
    db::write_app_setting(&connection, TERMINAL_SHELL_COMMAND_KEY, &normalized_command)
        .map_err(AppError::to_string_error)
}

/// 向终端会话写入输入（真实终端键盘输入透传）。
#[tauri::command]
pub fn write_terminal_input(
    state: State<'_, AppState>,
    tab_id: String,
    input: String,
) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::write_terminal_input(&state.terminal_sessions, normalized_tab_id, &input)
}

/// 调整终端会话尺寸（与 xterm cols/rows 同步）。
#[tauri::command]
pub fn resize_terminal_session(
    state: State<'_, AppState>,
    tab_id: String,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::resize_terminal_session(
        &state.terminal_sessions,
        normalized_tab_id,
        cols,
        rows,
    )
}

/// 关闭终端会话并终止对应进程。
#[tauri::command]
pub fn close_terminal_session(state: State<'_, AppState>, tab_id: String) -> Result<(), String> {
    let normalized_tab_id = tab_id.trim();
    if normalized_tab_id.is_empty() {
        return Err("Tab ID 不能为空".to_string());
    }
    terminal_runtime::close_terminal_session(&state.terminal_sessions, normalized_tab_id)
}

/// 以管理员身份打开系统终端（仅 Windows）。
/// 说明：管理员进程受 UAC 隔离，无法附着到当前 PTY Tab，因此以新窗口方式打开。
#[tauri::command]
pub fn open_elevated_terminal(_state: State<'_, AppState>) -> Result<(), String> {
    #[cfg(target_os = "windows")]
    {
        // 管理员终端同样遵循数据库中保存的终端 Shell 配置。
        let elevated_program = read_terminal_shell_command(&_state)
            .ok_or_else(|| "未配置终端 Shell，请到“设置-终端设置”中重新选择 Shell。".to_string())?;
        let escaped_program = elevated_program.replace('\'', "''");
        let guard_script = terminal_runtime::build_windows_parent_guard_script(std::process::id());
        let escaped_guard_script = guard_script.replace('\'', "''");
        let elevate_command = format!(
            "Start-Process -FilePath '{}' -Verb RunAs -ArgumentList '-NoExit','-NoLogo','-Command','{}'",
            escaped_program, escaped_guard_script
        );
        let output = StdCommand::new("powershell.exe")
            .arg("-NoProfile")
            .arg("-ExecutionPolicy")
            .arg("Bypass")
            .arg("-Command")
            .arg(elevate_command)
            .output()
            .map_err(|error| format!("拉起管理员终端失败: {error}"))?;

        if output.status.success() {
            return Ok(());
        }

        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        return Err(format!(
            "拉起管理员终端失败，exit={:?}, stderr={stderr}, stdout={stdout}",
            output.status.code()
        ));
    }

    #[cfg(not(target_os = "windows"))]
    {
        Err("当前平台不支持“以管理员身份打开终端”".to_string())
    }
}

/// 读取终端 shell 命令配置；兼容旧版 `terminal.shell.preference`（pwsh/powershell）。
fn read_terminal_shell_command(state: &State<'_, AppState>) -> Option<String> {
    let connection = state.storage.connection().ok()?;
    // 优先读取新版完整命令配置。
    let command = db::read_app_setting(&connection, TERMINAL_SHELL_COMMAND_KEY)
        .ok()
        .flatten()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if command.is_some() {
        return command;
    }

    // 回退读取旧版偏好配置，避免历史用户升级后失效。
    let legacy = db::read_app_setting(&connection, LEGACY_TERMINAL_SHELL_PREFERENCE_KEY)
        .ok()
        .flatten()
        .map(|value| value.trim().to_lowercase())
        .filter(|value| !value.is_empty())?;
    if legacy == "powershell" {
        return Some("powershell.exe".to_string());
    }
    if legacy == "pwsh" {
        return Some("pwsh.exe".to_string());
    }
    Some(legacy)
}

#[cfg(test)]
mod tests {
    use super::{
        build_salesforce_create_detail, build_salesforce_query_detail, build_salesforce_save_detail,
    };
    use crate::models::RecordUpdatePayload;
    use serde_json::json;
    use std::collections::HashMap;

    /// 构造测试用字段映射，减少重复样板代码。
    fn build_values(entries: &[(&str, serde_json::Value)]) -> HashMap<String, serde_json::Value> {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn salesforce_query_detail_logs_real_query_api_path() {
        let detail = build_salesforce_query_detail("v61.0", "SELECT Id FROM Account LIMIT 1");

        assert_eq!(
            detail,
            "api=GET /services/data/v61.0/query\nsoql=SELECT Id FROM Account LIMIT 1"
        );
    }

    #[test]
    fn salesforce_create_detail_omits_trace_soql_by_default() {
        let detail = build_salesforce_create_detail(
            "v61.0",
            "Account",
            &build_values(&[("Name", json!("Acme"))]),
            None,
        );

        assert!(detail.contains("api=POST /services/data/v61.0/sobjects/Account"));
        assert!(detail.contains("payload={\"Name\":\"Acme\"}"));
        assert!(!detail.contains("trace_soql"));
    }

    #[test]
    fn salesforce_save_detail_logs_real_composite_request_payload() {
        let creates = vec![build_values(&[("Name", json!("Acme"))])];
        let updates = vec![RecordUpdatePayload {
            record_id: "001xx000003DHP0AAO".to_string(),
            values: build_values(&[("Name", json!("Acme Updated"))]),
        }];
        let detail = build_salesforce_save_detail("v61.0", "Account", &creates, &updates, None);

        assert!(detail.contains("api=POST /services/data/v61.0/composite"));
        assert!(detail.contains("\"allOrNone\":true"));
        assert!(detail.contains("\"referenceId\":\"create_0\""));
        assert!(detail.contains("\"referenceId\":\"update_0\""));
        assert!(detail.contains("/services/data/v61.0/sobjects/Account"));
        assert!(detail.contains("/services/data/v61.0/sobjects/Account/001xx000003DHP0AAO"));
        assert!(!detail.contains("trace_soql"));
    }
}

/// 校验数据源写入参数,避免保存明显非法值。
fn validate_payload(payload: &SourceUpsertPayload) -> Result<(), String> {
    let source_type = payload.source_type.trim().to_lowercase();
    if payload.name.trim().is_empty() {
        return Err("Source name cannot be empty".to_string());
    }
    if source_type == "salesforce" {
        if payload.instance_url.trim().is_empty() {
            return Err("Instance URL cannot be empty".to_string());
        }
        if payload.access_token.trim().is_empty() {
            return Err("Access token cannot be empty".to_string());
        }
        if !payload.api_version.starts_with('v') {
            return Err("API version must start with v, e.g. v61.0".to_string());
        }
        return Ok(());
    }
    if source_type == "mysql" {
        let host = payload
            .config_json
            .get("host")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        let database = payload
            .config_json
            .get("database")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        let username = payload
            .config_json
            .get("username")
            .and_then(|item| item.as_str())
            .unwrap_or("")
            .trim();
        if host.is_empty() || database.is_empty() || username.is_empty() {
            return Err("MySQL config 缺少必填项：host/database/username".to_string());
        }
        return Ok(());
    }
    return Err(format!("当前版本不支持该数据源类型: {source_type}"));
}
