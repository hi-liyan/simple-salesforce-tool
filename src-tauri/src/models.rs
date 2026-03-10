use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesforceSource {
    /// 数据源主键（本地 UUID 或 cli-<orgId>）。
    pub id: String,
    /// 数据源显示名称（用于前端下拉与提示）。
    pub name: String,
    /// 数据源序号（用于稳定排序与拖拽重排）。
    #[serde(default)]
    pub sort_order: i64,
    /// 数据源类型（如 salesforce/mysql）。
    #[serde(default = "default_source_type")]
    pub source_type: String,
    /// 通用配置 JSON（为后续多类型数据源扩展预留）。
    #[serde(default = "default_source_config")]
    pub config_json: Value,
    /// Salesforce 实例地址（如 https://xxx.my.salesforce.com）。
    pub instance_url: String,
    /// OAuth 访问令牌（当前版本直接持久化存储）。
    pub access_token: String,
    /// Salesforce REST API 版本（如 v61.0）。
    pub api_version: String,
    /// 创建时间（RFC3339 字符串）。
    pub created_at: String,
    /// 最后更新时间（RFC3339 字符串）。
    pub updated_at: String,
}

impl SalesforceSource {
    /// 当前数据源是否为 Salesforce 类型。
    pub fn is_salesforce(&self) -> bool {
        self.source_type.eq_ignore_ascii_case("salesforce")
    }
}

/// 默认数据源类型：保持历史版本行为不变，未显式指定时按 Salesforce 处理。
fn default_source_type() -> String {
    "salesforce".to_string()
}

/// 默认配置对象：保证新字段在旧数据读取时也有稳定结构。
fn default_source_config() -> Value {
    Value::Object(serde_json::Map::new())
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUpsertPayload {
    /// 数据源名称。
    pub name: String,
    /// 数据源类型（M1 阶段默认 salesforce）。
    #[serde(default = "default_source_type")]
    pub source_type: String,
    /// 通用配置 JSON（M1 阶段可为空对象）。
    #[serde(default = "default_source_config")]
    pub config_json: Value,
    /// 实例地址。
    pub instance_url: String,
    /// 访问令牌。
    pub access_token: String,
    /// API 版本。
    pub api_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesforceObject {
    /// Object API Name，例如 Account。
    pub name: String,
    /// Object Label（可读名称）。
    pub label: String,
    /// 是否可查询。
    pub queryable: bool,
    /// 是否可新增。
    pub createable: bool,
    /// 是否可更新。
    pub updateable: bool,
    /// 是否可删除。
    pub deletable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectField {
    /// 字段 API Name。
    pub name: String,
    /// 字段显示名称。
    pub label: String,
    /// 字段类型（string/picklist/boolean 等）。
    pub data_type: String,
    /// 是否允许为空。
    pub nillable: bool,
    /// 是否允许更新。
    pub updateable: bool,
    /// 是否允许创建时写入。
    pub createable: bool,
    /// 原始字段元数据（完整透传，供前端 tooltip/约束使用）。
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDescribe {
    /// 对象 API Name。
    pub name: String,
    /// 对象显示名称。
    pub label: String,
    /// 字段元数据列表。
    pub fields: Vec<ObjectField>,
    /// 子关系元数据列表（用于构建父对象子查询）。
    pub child_relationships: Vec<ObjectChildRelationship>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectChildRelationship {
    /// 子对象 API Name。
    pub child_sobject: String,
    /// 子对象上的父引用字段 API Name。
    pub field: String,
    /// 子查询 relationshipName（用于 SELECT (SELECT ... FROM <relationshipName>)）。
    pub relationship_name: String,
    /// 该关系是否被 Salesforce 标记为隐藏/废弃。
    pub deprecated_and_hidden: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CurrentUserContext {
    /// Salesforce 当前用户时区（如 America/Los_Angeles）。
    pub timezone_sid_key: Option<String>,
    /// Salesforce 当前用户地区设置（如 zh_CN）。
    pub locale_sid_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    /// 查询返回总条数（Salesforce totalSize）。
    pub total_size: usize,
    /// 记录列表（键为字段名，值为 JSON 值）。
    pub records: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDdl {
    /// 建表 DDL（SHOW CREATE TABLE）。
    pub create_table_ddl: String,
    /// 索引 DDL 列表（不含主键）。
    pub index_ddls: Vec<String>,
    /// 约束 DDL 列表（如 UNIQUE/FOREIGN KEY）。
    pub constraint_ddls: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordMutationPayload {
    /// 数据源 ID。
    pub source_id: String,
    /// 目标对象名称。
    pub object_name: String,
    /// 记录字段值。
    pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordUpdatePayload {
    /// 目标记录 Id。
    pub record_id: String,
    /// 需要更新的字段集合。
    pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSavePayload {
    /// 数据源 ID。
    pub source_id: String,
    /// 目标对象名称。
    pub object_name: String,
    /// 待新增记录列表。
    pub creates: Vec<HashMap<String, Value>>,
    /// 待更新记录列表。
    pub updates: Vec<RecordUpdatePayload>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandItem {
    /// 命令主键。
    pub id: String,
    /// 命令名称。
    pub name: String,
    /// 命令正文（执行时直接透传给终端会话）。
    pub command: String,
    /// 命令描述（可选）。
    pub description: String,
    /// 创建时间（RFC3339 字符串）。
    pub created_at: String,
    /// 最后更新时间（RFC3339 字符串）。
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandGroup {
    /// 命令组主键。
    pub id: String,
    /// 命令组名称。
    pub name: String,
    /// 组内命令列表（按 sort_order 升序）。
    pub commands: Vec<TerminalCommandItem>,
    /// 创建时间（RFC3339 字符串）。
    pub created_at: String,
    /// 最后更新时间（RFC3339 字符串）。
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandUpsertPayload {
    /// 所属命令组 ID。
    pub group_id: String,
    /// 命令名称。
    pub name: String,
    /// 命令正文。
    pub command: String,
    /// 命令描述（可空）。
    pub description: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandReorderPayload {
    /// 命令组 ID。
    pub group_id: String,
    /// 组内命令 ID 顺序列表。
    pub command_ids: Vec<String>,
}

/// 对象列表缓存行（SQLite 内部结构）。
#[derive(Debug)]
pub struct CachedObjects {
    /// 缓存内容 JSON 字符串。
    pub payload: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLogEntry {
    /// 自增主键。
    pub id: i64,
    /// 日志时间（RFC3339）。
    pub created_at: String,
    /// 日志级别（INFO/ERROR）。
    pub level: String,
    /// 日志分类（SALESFORCE_API/SALESFORCE_CLI）。
    pub category: String,
    /// 动作名称（query_records/save_records 等）。
    pub action: String,
    /// 关联数据源 ID（可空）。
    pub source_id: Option<String>,
    /// 关联目标（对象名等，可空）。
    pub target: Option<String>,
    /// 是否成功。
    pub success: bool,
    /// 简要信息。
    pub message: String,
    /// 详细内容（错误栈/请求体片段，可空）。
    pub detail: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemLogPage {
    /// 当前页数据。
    pub items: Vec<SystemLogEntry>,
    /// 页码（从 1 开始）。
    pub page: i64,
    /// 每页条数。
    pub page_size: i64,
    /// 总记录数。
    pub total: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathProbe {
    /// 候选 CLI 路径。
    pub path: String,
    /// 探测是否成功。
    pub ok: bool,
    /// 版本文本（成功时可能包含）。
    pub version: Option<String>,
    /// 探测详情（错误信息或 stdout 片段）。
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathSettings {
    /// 自定义 CLI 路径（未设置时为 None）。
    pub custom_cli_path: Option<String>,
    /// 当前最终生效的 CLI 路径（自动探测结果）。
    pub resolved_cli_path: Option<String>,
    /// 当前最终生效的 CLI 版本。
    pub resolved_cli_version: Option<String>,
    /// 本次探测的候选详情。
    pub probes: Vec<CliPathProbe>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CliPathStatus {
    /// 本次检测使用的 CLI 路径。
    pub path: Option<String>,
    /// 路径是否可用。
    pub ok: bool,
    /// 当前 CLI 版本文本。
    pub version: Option<String>,
    /// 是否存在可用更新（无法判断时为 None）。
    pub has_update: Option<bool>,
    /// 可用更新的最新版本号（无法获取时为 None）。
    pub latest_version: Option<String>,
    /// 诊断详情（错误或提示信息）。
    pub detail: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettings {
    /// 协议提供方，第一阶段固定为 openai。
    pub provider: String,
    /// OpenAI 接口基础地址。
    pub base_url: String,
    /// OpenAI 模型名称。
    pub model: String,
    /// OpenAI 密钥（仅后端持有明文）。
    pub api_key: String,
    /// 超时时间（毫秒）。
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmSettingsView {
    /// 协议提供方，前端展示用。
    pub provider: String,
    /// OpenAI 接口基础地址。
    pub base_url: String,
    /// OpenAI 模型名称。
    pub model: String,
    /// apiKey 是否已配置。
    pub api_key_configured: bool,
    /// apiKey 掩码文本。
    pub api_key_masked: String,
    /// 超时时间（毫秒）。
    pub timeout_ms: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SaveLlmSettingsPayload {
    /// OpenAI 接口基础地址。
    pub base_url: String,
    /// OpenAI 模型名称。
    pub model: String,
    /// 新的 apiKey（可空，空时表示不覆盖）。
    pub api_key: Option<String>,
    /// 超时时间（毫秒）。
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiUiContext {
    /// 当前激活 Tab 的 SOQL 草稿（可空）。
    pub current_tab_soql: Option<String>,
    /// 当前激活 Tab 的对象提示（可空）。
    pub context_object_hint: Option<String>,
    /// 当前激活 Tab 的字段提示列表（可空）。
    pub selected_fields: Option<Vec<String>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatTurnV2Request {
    /// Salesforce 数据源 ID。
    pub source_id: String,
    /// 多轮对话 ID（为空时由后端创建）。
    pub conversation_id: Option<String>,
    /// 用户本轮输入。
    pub message: String,
    /// 前端流式请求 ID（用于路由增量事件）。
    pub stream_request_id: Option<String>,
    /// 前端上下文（可选）。
    pub ui_context: Option<AiUiContext>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiActionItem {
    /// 动作类型：APPLY_CURRENT_TAB / APPLY_NEW_TAB / ASK_MORE。
    pub action_type: String,
    /// 动作展示文案。
    pub label: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiDiagnostics {
    /// 本轮使用的工具名称列表。
    pub tools_used: Vec<String>,
    /// 风险等级：low / medium / high。
    pub risk_level: String,
    /// 风险与提醒文案。
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiChatTurnV2Response {
    /// 多轮对话 ID。
    pub conversation_id: String,
    /// 当前状态：answer / clarify / ready。
    pub state: String,
    /// 助手消息文本。
    pub assistant_message: String,
    /// 追问问题列表（clarify 时返回）。
    pub questions: Vec<String>,
    /// 提议的 SOQL（ready 时返回）。
    pub proposed_soql: Option<String>,
    /// 助手动作列表。
    pub actions: Vec<AiActionItem>,
    /// 诊断信息。
    pub diagnostics: AiDiagnostics,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiCapabilities {
    /// 后端 AI API 版本号。
    pub version: String,
    /// 当前 provider。
    pub provider: String,
    /// 当前模型名称。
    pub model: String,
    /// 可用工具列表。
    pub tools: Vec<String>,
}
