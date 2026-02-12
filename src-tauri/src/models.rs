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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUpsertPayload {
    /// 数据源名称。
    pub name: String,
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

/// 对象列表缓存行（SQLite 内部结构）。
#[derive(Debug)]
pub struct CachedObjects {
    /// 缓存内容 JSON 字符串。
    pub payload: String,
    /// 缓存写入时间（Unix 秒）。
    pub updated_at: i64,
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
