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
use super::window_commands::open_url_with_system_browser;
use crate::terminal::{self as terminal_runtime, TerminalSessionInfo, TerminalShellOption};

/// 写系统日志的统一入口。
/// 说明:日志写入失败不应影响主流程,因此这里吞掉错误。
pub(super) fn write_system_log(
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
    let _ = state.storage.write(|connection| {
        db::insert_system_log(
            connection,
            level,
            category,
            action,
            source_id,
            target,
            success,
            message,
            detail,
        )
    });
}

/// MySQL 结构化日志 schema：供前端识别新版 mutation 日志详情。
pub(super) const MYSQL_MUTATION_LOG_SCHEMA: &str = "mysql-mutation-log/v1";

/// MySQL 单条变更日志项：对应一条 create/update/delete 的执行摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct MysqlMutationLogDetailItem {
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
pub(super) struct MysqlMutationLogDetail {
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
pub(super) struct MysqlMutationFailureContext {
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
pub(super) fn extract_numeric_marker(message: &str, marker: &str) -> Option<usize> {
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
pub(super) fn extract_text_marker(message: &str, marker: &str) -> String {
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
pub(super) fn parse_mysql_mutation_failure_context(message: &str) -> MysqlMutationFailureContext {
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
pub(super) fn fallback_mysql_log_detail(error: &AppError) -> String {
    format!("-- 执行预览 SQL 生成失败：{error}")
}

/// 生成单条日志项标签：例如 update#1。
pub(super) fn build_mysql_log_item_label(operation_type: &str, operation_index: Option<usize>) -> String {
    match operation_index {
        Some(index) => format!("{operation_type}#{index}"),
        None => operation_type.to_string(),
    }
}

/// 把结构化日志项汇总成可读的执行预览 SQL 文本。
pub(super) fn build_mysql_log_preview_sql(items: &[MysqlMutationLogDetailItem], fallback_sql: &str) -> String {
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
pub(super) fn serialize_mysql_log_detail(detail: &MysqlMutationLogDetail) -> String {
    serde_json::to_string(detail).unwrap_or_else(|error| {
        format!(
            "执行模式={}\n执行结果={}\n执行预览 SQL:\n{}\nerror={}",
            detail.execution_mode, detail.result, detail.preview_sql, error
        )
    })
}

/// 基于批量预览项构造结构化日志子项；失败时会把错误挂到对应失败项上。
pub(super) fn build_mysql_preview_log_items(
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
pub(super) fn build_mysql_execution_log_items(
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
pub(super) fn build_mysql_single_log_detail(
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
pub(super) fn build_mysql_batch_log_detail(
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

pub(super) const SF_CLI_PATH_SETTING_KEY: &str = "sf_cli_path";
pub(super) const LLM_SETTINGS_KEY: &str = "llm.settings.openai";
pub(super) const TERMINAL_SHELL_COMMAND_KEY: &str = "terminal.shell.command";
pub(super) const LEGACY_TERMINAL_SHELL_PREFERENCE_KEY: &str = "terminal.shell.preference";
pub(super) const METADATA_TYPE_OBJECT_DESCRIBE: &str = "object_describe";
pub(super) const METADATA_TYPE_OBJECT_DDL: &str = "object_ddl";

/// 读取已配置的自定义 Salesforce CLI 路径。
pub(super) fn read_configured_cli_path(state: &State<'_, AppState>) -> Option<String> {
    state
        .storage
        .read(|connection| db::read_app_setting(connection, SF_CLI_PATH_SETTING_KEY))
        .ok()
        .flatten()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
}

pub(super) fn set_main_window_enabled(app: &tauri::AppHandle, enabled: bool) {
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
pub(super) fn resolve_window_title(zh_title: &str, en_title: &str) -> String {
    // Linux 标题栏由系统窗口管理器绘制，不使用 WebView 内嵌字体。
    if cfg!(target_os = "linux") {
        return en_title.to_string();
    }
    zh_title.to_string()
}

pub(super) fn create_cli_login_cancel_token(state: &State<'_, AppState>) -> Arc<AtomicBool> {
    let token = Arc::new(AtomicBool::new(false));
    if let Ok(mut slot) = state.cli_login_cancel.lock() {
        *slot = Some(token.clone());
    }
    token
}

pub(super) fn cancel_cli_login_if_running(state: &State<'_, AppState>) {
    if let Ok(slot) = state.cli_login_cancel.lock() {
        if let Some(token) = slot.as_ref() {
            token.store(true, Ordering::Relaxed);
        }
    }
}

pub(super) fn clear_cli_login_cancel_token(state: &State<'_, AppState>) {
    if let Ok(mut slot) = state.cli_login_cancel.lock() {
        *slot = None;
    }
}

pub(super) fn cancel_llm_stream_by_request_id(state: &State<'_, AppState>, request_id: &str) {
    if let Ok(map) = state.llm_stream_cancels.lock() {
        if let Some(token) = map.get(request_id) {
            token.store(true, Ordering::Relaxed);
        }
    }
}
pub(super) fn is_unauthorized_error(error: &AppError) -> bool {
    matches!(
        error,
        AppError::Http(message)
            if message.contains("状态码 401")
                || message.contains("status code 401")
                || message.contains("401 Unauthorized")
    )
}

/// 按数据源类型返回系统日志分类。
pub(super) fn resolve_log_category(source: &SalesforceSource) -> &'static str {
    if source.is_salesforce() {
        "SALESFORCE_API"
    } else {
        "MYSQL_DB"
    }
}

/// 构造 Salesforce 查询日志详情。
pub(super) fn build_salesforce_query_detail(api_version: &str, soql: &str) -> String {
    format!("api=GET /services/data/{api_version}/query\nsoql={soql}")
}

/// 构造 MySQL 查询日志详情。
pub(super) fn build_mysql_query_detail(sql: &str) -> String {
    format!("raw_sql:\n{sql}")
}

/// 构造 Salesforce 可选 trace_soql 附加信息，明确标记其仅用于辅助排查。
pub(super) fn build_salesforce_optional_trace_detail(trace_soql: Option<String>) -> Option<String> {
    trace_soql.map(|item| {
        format!("optional_trace_soql={item}\ntrace_soql_note=辅助排查语句，非实际执行请求")
    })
}

/// 构造 Salesforce 新增日志详情：仅记录真实执行的 API 请求，trace_soql 为可选辅助信息。
pub(super) fn build_salesforce_create_detail(
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
pub(super) fn build_salesforce_update_detail(
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
pub(super) fn build_salesforce_delete_detail(
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
pub(super) fn build_salesforce_save_detail(
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
pub(super) async fn refresh_cli_source_token(
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

        let refreshed_source = state.storage.write(|connection| {
            db::upsert_source_with_id(connection, &refreshed_seed.id, refreshed_seed.payload)
        })?;

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



/// 构建 frontdoor URL：`{instance}/secur/frontdoor.jsp?sid={token}&retURL={path}`。
pub(super) fn build_frontdoor_url(source: &SalesforceSource, path: &str) -> String {
    let instance = source.instance_url.trim_end_matches('/');
    let sid = urlencoding::encode(&source.access_token);
    let ret_url = urlencoding::encode(path);
    format!("{instance}/secur/frontdoor.jsp?sid={sid}&retURL={ret_url}")
}

/// 快速校验 token → 无效则刷新 → 构建 frontdoor URL → 打开系统浏览器。
/// 统一走 frontdoor URL 方案,跳过缓慢的 CLI 子进程调用。
pub(super) async fn open_salesforce_page(
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
