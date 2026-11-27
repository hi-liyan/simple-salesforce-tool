use chrono::Utc;
use serde_json::{json, Value};

use crate::ai::events::{AiAssistantMode, ToolCall, ToolDefinition, ToolResult};
use crate::drivers::{DriverRegistry, ProviderCapabilities};
use crate::services::metadata_service::MetadataService;
use crate::services::query_service::QueryService;
use crate::services::source_service::SourceService;
use crate::services::sql_guard::{evaluate_sql_safety, SqlGuardContext, SqlGuardDecision};
use crate::storage::Storage;

/// 单次工具返回最大字符数（防止超大结果撑爆模型上下文）。
const MAX_TOOL_OUTPUT_CHARS: usize = 12_000;

/// Agent 运行时工具上下文（封装存储、驱动注册表与写操作确认快照）。
pub struct AgentToolContext<'a> {
    /// SQLite 存储入口。
    pub storage: &'a Storage,
    /// 数据源驱动注册表。
    pub driver_registry: &'a DriverRegistry,
    /// 目标数据源 ID。
    pub source_id: String,
    /// 数据源运行环境（default / prod 等）。
    pub environment: String,
    /// 数据源是否只读。
    pub read_only: bool,
    /// 驱动能力声明矩阵。
    pub capabilities: ProviderCapabilities,
    /// 前端已确认执行的精确写操作 SQL（Fail-Closed）。
    pub confirmed_write_sql: Option<String>,
    /// 前端确认时绑定的数据源 ID 快照。
    pub confirmed_source_id: Option<String>,
}

/// 截断过长的工具文本输出。
fn truncate_tool_output(raw: String) -> String {
    if raw.chars().count() <= MAX_TOOL_OUTPUT_CHARS {
        return raw;
    }
    let prefix: String = raw.chars().take(MAX_TOOL_OUTPUT_CHARS).collect();
    format!("{prefix}\n\n... [结果已截断，请缩小查询范围或增加 LIMIT]")
}

/// 规范化 SQL 文本以便进行写确认精确比对。
pub fn normalize_sql_for_confirmation(sql: &str) -> String {
    sql.split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim_end_matches(';')
        .trim()
        .to_string()
}

/// 校验写操作目标快照与精确 SQL 是否匹配（Fail-Closed）。
pub fn is_write_sql_confirmed(ctx: &AgentToolContext<'_>, sql: &str) -> bool {
    if ctx.read_only {
        return false;
    }
    let Some(confirmed_source) = ctx.confirmed_source_id.as_deref() else {
        return false;
    };
    if confirmed_source.trim() != ctx.source_id.trim() {
        return false;
    }
    let Some(confirmed_sql) = ctx.confirmed_write_sql.as_deref() else {
        return false;
    };
    !confirmed_sql.trim().is_empty()
        && normalize_sql_for_confirmation(confirmed_sql) == normalize_sql_for_confirmation(sql)
}

/// 检查工具调用是否触发未确认的写/高危 SQL 或只读/生产拦截。
pub enum WriteGateCheck {
    /// 允许直接执行。
    Allowed,
    /// 被只读或生产环境策略硬拦截。
    Blocked { sql: String, reason: String },
    /// 需要前端用户二次确认后才能执行。
    NeedsConfirmation { sql: String, reason: String },
}

/// 在执行 `execute_query` 工具前进行 Fail-Closed 安全检查。
pub fn check_tool_write_gate(ctx: &AgentToolContext<'_>, call: &ToolCall) -> WriteGateCheck {
    if call.name != "execute_query" {
        return WriteGateCheck::Allowed;
    }
    let sql = call
        .arguments
        .get("sql")
        .and_then(|v| v.as_str())
        .unwrap_or_default()
        .trim()
        .to_string();
    if sql.is_empty() {
        return WriteGateCheck::Allowed;
    }

    let confirmed = is_write_sql_confirmed(ctx, &sql);
    let decision = evaluate_sql_safety(
        &sql,
        &SqlGuardContext {
            environment: ctx.environment.clone(),
            read_only: ctx.read_only,
            confirmed,
        },
    );

    match decision {
        SqlGuardDecision::Allow { .. } => WriteGateCheck::Allowed,
        SqlGuardDecision::Deny { reason, .. } => WriteGateCheck::Blocked { sql, reason },
        SqlGuardDecision::RequireConfirmation { reason, .. } => {
            WriteGateCheck::NeedsConfirmation { sql, reason }
        }
    }
}

/// 根据数据源能力与运行模式动态构造可用工具列表（完全驱动无关）。
pub fn build_tools_for_mode(
    mode: AiAssistantMode,
    capabilities: &ProviderCapabilities,
) -> Vec<ToolDefinition> {
    let mut tools = vec![
        ToolDefinition {
            name: "list_objects".to_string(),
            description: "按关键词检索当前数据源下的表或对象列表（支持名称或标签模糊过滤）。"
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "keyword": { "type": "string", "description": "可选模糊搜索关键词，留空返回前 60 个对象" },
                    "limit": { "type": "integer", "description": "返回数量上限，默认 40，最大 100" }
                }
            }),
            parallel_ok: true,
        },
        ToolDefinition {
            name: "describe_object".to_string(),
            description: "获取指定表或对象的完整字段结构（列名、数据类型、是否可空、主键/读写属性及关联关系）。"
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "objectName": { "type": "string", "description": "目标表名或对象 API 名称" }
                },
                "required": ["objectName"]
            }),
            parallel_ok: true,
        },
        ToolDefinition {
            name: "get_current_time".to_string(),
            description: "获取当前系统 UTC 与本地时间，用于构造精确的日期时间过滤条件。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {}
            }),
            parallel_ok: true,
        },
    ];

    if capabilities.supports_ddl {
        tools.push(ToolDefinition {
            name: "get_object_ddl".to_string(),
            description: "获取关系型数据表的建表 DDL、索引与约束定义。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "objectName": { "type": "string", "description": "目标表名" }
                },
                "required": ["objectName"]
            }),
            parallel_ok: true,
        });
    }

    if mode == AiAssistantMode::Agent {
        tools.push(ToolDefinition {
            name: "get_sample_data".to_string(),
            description: "采样读取指定表或对象的前几行数据（最多 10 行），快速了解字段实际值格式。"
                .to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "objectName": { "type": "string", "description": "目标表名或对象名称" },
                    "limit": { "type": "integer", "description": "采样行数，默认 5，最大 10" }
                },
                "required": ["objectName"]
            }),
            parallel_ok: false,
        });

        tools.push(ToolDefinition {
            name: "execute_query".to_string(),
            description: format!(
                "在当前数据源执行 {} 语句（查询结果会自动限制展示条数；写操作/高危 DDL 会触发安全确认）。",
                capabilities.query_language.to_uppercase()
            ),
            parameters: json!({
                "type": "object",
                "properties": {
                    "sql": { "type": "string", "description": "待执行的完整 SQL 或 SOQL 语句" },
                    "objectName": { "type": "string", "description": "可选主表/主对象名（用于字段类型映射）" }
                },
                "required": ["sql"]
            }),
            parallel_ok: false,
        });

        if capabilities.supports_ddl {
            tools.push(ToolDefinition {
                name: "explain_query".to_string(),
                description: "对 SELECT 查询执行 EXPLAIN 执行计划分析，用于排查全表扫描与索引命中情况。"
                    .to_string(),
                parameters: json!({
                    "type": "object",
                    "properties": {
                        "sql": { "type": "string", "description": "待分析的 SELECT 查询语句" }
                    },
                    "required": ["sql"]
                }),
                parallel_ok: false,
            });
        }
    }

    tools
}

/// 执行单个工具调用，并返回给模型的结构化文本结果。
pub async fn execute_agent_tool(ctx: &AgentToolContext<'_>, call: &ToolCall) -> ToolResult {
    let res = match call.name.as_str() {
        "list_objects" => run_list_objects(ctx, &call.arguments).await,
        "describe_object" => run_describe_object(ctx, &call.arguments).await,
        "get_object_ddl" => run_get_object_ddl(ctx, &call.arguments).await,
        "get_current_time" => Ok(json!({
            "utc": Utc::now().to_rfc3339(),
            "local": chrono::Local::now().to_rfc3339()
        })
        .to_string()),
        "get_sample_data" => run_sample_data(ctx, &call.arguments).await,
        "execute_query" => run_execute_query(ctx, &call.arguments).await,
        "explain_query" => run_explain_query(ctx, &call.arguments).await,
        other => Err(format!("未知工具: {other}")),
    };

    match res {
        Ok(content) => ToolResult {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            content: truncate_tool_output(content),
            is_error: false,
        },
        Err(err) => ToolResult {
            tool_call_id: call.id.clone(),
            tool_name: call.name.clone(),
            content: err,
            is_error: true,
        },
    }
}

/// 检索数据源对象/表列表（优先复用 SQLite 元数据缓存，未命中时自动回源）。
async fn run_list_objects(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    let keyword = args
        .get("keyword")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .to_lowercase();
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(40)
        .clamp(1, 100) as usize;

    let metadata_service = MetadataService::new(ctx.storage);
    let mut objects = metadata_service
        .list_cached_objects(&ctx.source_id)
        .map_err(|e| e.to_string())?;

    if objects.is_empty() {
        let source = SourceService::new(ctx.storage)
            .get_runtime_source(&ctx.source_id)
            .map_err(|e| e.to_string())?;
        let driver = ctx
            .driver_registry
            .get(&source.source_type)
            .map_err(|e| e.to_string())?;
        objects = driver
            .list_objects(&source)
            .await
            .map_err(|e| e.to_string())?;
        let _ = metadata_service.replace_cached_objects(&ctx.source_id, &objects, "ai_agent");
    }

    let matched: Vec<Value> = objects
        .into_iter()
        .filter(|obj| {
            keyword.is_empty()
                || obj.name.to_lowercase().contains(&keyword)
                || obj.label.to_lowercase().contains(&keyword)
        })
        .take(limit)
        .map(|obj| {
            json!({
                "name": obj.name,
                "label": obj.label,
                "queryable": obj.queryable
            })
        })
        .collect();

    Ok(json!({ "count": matched.len(), "objects": matched }).to_string())
}

/// 获取指定对象/表的字段元数据（优先缓存，缺失时自动回源）。
async fn run_describe_object(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    let object_name = args
        .get("objectName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if object_name.is_empty() {
        return Err("objectName 不能为空".to_string());
    }

    let metadata_service = MetadataService::new(ctx.storage);
    let mut describe = metadata_service
        .get_cached_describe(&ctx.source_id, object_name)
        .map_err(|e| e.to_string())?;

    if describe.is_none() {
        let source = SourceService::new(ctx.storage)
            .get_runtime_source(&ctx.source_id)
            .map_err(|e| e.to_string())?;
        let driver = ctx
            .driver_registry
            .get(&source.source_type)
            .map_err(|e| e.to_string())?;
        let fresh = driver
            .describe_object(&source, object_name)
            .await
            .map_err(|e| e.to_string())?;
        let _ = metadata_service.cache_describe(&ctx.source_id, &fresh, "ai_agent");
        describe = Some(fresh);
    }

    let desc = describe.ok_or_else(|| format!("未找到对象结构: {object_name}"))?;
    let fields: Vec<Value> = desc
        .fields
        .iter()
        .take(160)
        .map(|f| {
            let column_key = f
                .metadata
                .get("columnKey")
                .and_then(|v| v.as_str())
                .unwrap_or("");
            let column_type = f
                .metadata
                .get("columnType")
                .and_then(|v| v.as_str())
                .unwrap_or(&f.data_type);
            json!({
                "name": f.name,
                "label": f.label,
                "type": column_type,
                "nullable": f.nillable,
                "key": column_key,
                "relationshipName": f.metadata.get("relationshipName").cloned().unwrap_or(Value::Null),
                "referenceTo": f.metadata.get("referenceTo").cloned().unwrap_or(Value::Null)
            })
        })
        .collect();

    Ok(json!({
        "name": desc.name,
        "label": desc.label,
        "totalFields": desc.fields.len(),
        "fields": fields,
        "childRelationships": desc.child_relationships.iter().take(40).collect::<Vec<_>>()
    })
    .to_string())
}

/// 获取关系型数据表的 DDL（仅在驱动支持 DDL 时有效）。
async fn run_get_object_ddl(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    if !ctx.capabilities.supports_ddl {
        return Err("当前数据源不支持 DDL 读取".to_string());
    }
    let object_name = args
        .get("objectName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if object_name.is_empty() {
        return Err("objectName 不能为空".to_string());
    }

    let metadata_service = MetadataService::new(ctx.storage);
    if let Ok(Some(cached)) = metadata_service.get_cached_object_ddl(&ctx.source_id, object_name) {
        return Ok(serde_json::to_string(&cached).unwrap_or_default());
    }

    let source = SourceService::new(ctx.storage)
        .get_runtime_source(&ctx.source_id)
        .map_err(|e| e.to_string())?;
    let driver = ctx
        .driver_registry
        .get(&source.source_type)
        .map_err(|e| e.to_string())?;
    let ddl = driver
        .get_object_ddl(&source, object_name)
        .await
        .map_err(|e| e.to_string())?;
    let _ = metadata_service.cache_object_ddl(&ctx.source_id, object_name, &ddl);
    Ok(serde_json::to_string(&ddl).unwrap_or_default())
}

/// 采样查询前几行数据（统一走 QueryService 受安全网关与审计保护）。
async fn run_sample_data(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    let object_name = args
        .get("objectName")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if object_name.is_empty() {
        return Err("objectName 不能为空".to_string());
    }
    let limit = args
        .get("limit")
        .and_then(|v| v.as_u64())
        .unwrap_or(5)
        .clamp(1, 10);

    let query = if ctx.capabilities.query_language.eq_ignore_ascii_case("soql") {
        // SOQL 需要显式字段列表，先从 describe 读取前 12 个字段。
        let desc_json = run_describe_object(ctx, &json!({ "objectName": object_name })).await?;
        let parsed: Value = serde_json::from_str(&desc_json).unwrap_or_default();
        let field_names: Vec<String> = parsed
            .get("fields")
            .and_then(|v| v.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("name").and_then(|n| n.as_str()).map(ToOwned::to_owned))
                    .take(12)
                    .collect()
            })
            .unwrap_or_else(|| vec!["Id".to_string()]);
        let select_cols = if field_names.is_empty() {
            "Id".to_string()
        } else {
            field_names.join(", ")
        };
        format!("SELECT {select_cols} FROM {object_name} LIMIT {limit}")
    } else {
        let safe_name = object_name.replace('`', "");
        format!("SELECT * FROM `{safe_name}` LIMIT {limit}")
    };

    run_execute_query(
        ctx,
        &json!({
            "sql": query,
            "objectName": object_name
        }),
    )
    .await
}

/// 执行 SQL/SOQL 语句（严格经由 QueryService + SqlGuard + 审计落盘）。
async fn run_execute_query(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    let sql = args
        .get("sql")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim();
    if sql.is_empty() {
        return Err("sql 不能为空".to_string());
    }
    let object_name = args
        .get("objectName")
        .and_then(|v| v.as_str())
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let confirmed = is_write_sql_confirmed(ctx, sql);
    let service = QueryService::new(ctx.storage, ctx.driver_registry);
    let response = service
        .execute_guarded_query(&ctx.source_id, sql, object_name, confirmed)
        .await
        .map_err(|e| e.to_string())?;

    if response.status == "confirmation_required" {
        return Err(
            response
                .guard_decision
                .reason()
                .unwrap_or("该写操作需要用户二次确认后才能执行。")
                .to_string(),
        );
    }

    let result = response.result.unwrap_or(crate::models::QueryResult {
        total_size: 0,
        records: Vec::new(),
        column_types: None,
        result_meta: None,
    });
    let sample_rows: Vec<_> = result.records.into_iter().take(30).collect();
    Ok(json!({
        "executedSql": response.executed_sql,
        "durationMs": response.duration_ms,
        "totalSize": result.total_size,
        "returnedRows": sample_rows.len(),
        "records": sample_rows
    })
    .to_string())
}

/// 执行 EXPLAIN 分析查询计划（仅在驱动支持时暴露）。
async fn run_explain_query(ctx: &AgentToolContext<'_>, args: &Value) -> Result<String, String> {
    if !ctx.capabilities.supports_ddl {
        return Err("当前数据源不支持 EXPLAIN 执行计划".to_string());
    }
    let sql = args
        .get("sql")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .trim()
        .trim_end_matches(';');
    if sql.is_empty() {
        return Err("sql 不能为空".to_string());
    }
    let explain_sql = if sql.to_ascii_lowercase().starts_with("explain") {
        sql.to_string()
    } else {
        format!("EXPLAIN {sql}")
    };
    run_execute_query(ctx, &json!({ "sql": explain_sql })).await
}

trait GuardReasonExt {
    fn reason(&self) -> Option<&str>;
}

impl GuardReasonExt for SqlGuardDecision {
    fn reason(&self) -> Option<&str> {
        match self {
            SqlGuardDecision::Allow { .. } => None,
            SqlGuardDecision::Deny { reason, .. } => Some(reason.as_str()),
            SqlGuardDecision::RequireConfirmation { reason, .. } => Some(reason.as_str()),
        }
    }
}
