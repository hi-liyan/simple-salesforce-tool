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
    /// OAuth 访问令牌（公共列表为空，运行时由 secrets 域按需注入）。
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

/// 数据源 secret 明文视图：仅供显式编辑链路使用。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct SourceSecretView {
    /// 数据源 ID。
    pub source_id: String,
    /// Salesforce accessToken 明文；非 Salesforce 数据源时为空。
    pub access_token: String,
    /// MySQL 密码明文；未使用时为空。
    pub password: String,
}

/// secret 访问审计记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAuditRecord {
    /// bundle ID。
    pub bundle_id: String,
    /// secret item ID。
    pub secret_item_id: Option<String>,
    /// 动作名。
    pub action: String,
    /// 触发来源。
    pub trigger_source: String,
    /// 是否成功。
    pub success: bool,
    /// 摘要说明。
    pub message: String,
    /// 关联 ID。
    #[serde(default)]
    pub correlation_id: String,
    /// 结构化详情。
    #[serde(default)]
    pub detail_json: Value,
}

/// secret 审计列表项。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SecretAuditEntry {
    /// 审计主键。
    pub id: i64,
    /// bundle ID。
    pub bundle_id: String,
    /// secret item ID。
    pub secret_item_id: Option<String>,
    /// 动作名。
    pub action: String,
    /// 触发来源。
    pub trigger_source: String,
    /// 是否成功。
    pub success: bool,
    /// 摘要说明。
    pub message: String,
    /// 关联 ID。
    pub correlation_id: String,
    /// 结构化详情。
    pub detail_json: Value,
    /// 创建时间。
    pub created_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesforceObject {
    /// Object API Name，例如 Account。
    pub name: String,
    /// Object Label（可读名称）。
    pub label: String,
    /// MySQL 表注释；Salesforce 对象为空。
    #[serde(default)]
    pub comment: Option<String>,
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

/// 元数据对象记录：用于结构化对象快照表。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceObjectRecord {
    /// 数据源 ID。
    pub source_id: String,
    /// 对象名。
    pub object_name: String,
    /// 标签。
    pub label: String,
    /// 注释。
    pub comment: Option<String>,
    /// 是否可查询。
    pub queryable: bool,
    /// 是否可新增。
    pub createable: bool,
    /// 是否可更新。
    pub updateable: bool,
    /// 是否可删除。
    pub deletable: bool,
    /// schema 版本。
    pub schema_version: i64,
    /// 快照版本。
    pub snapshot_version: i64,
    /// 身份哈希。
    pub identity_hash: String,
    /// 刷新原因。
    pub refresh_reason: String,
}

impl SourceObjectRecord {
    /// 便捷构造 Salesforce 对象记录。
    pub fn salesforce(name: &str, label: &str) -> Self {
        Self {
            source_id: String::new(),
            object_name: name.to_string(),
            label: label.to_string(),
            comment: None,
            queryable: true,
            createable: true,
            updateable: true,
            deletable: true,
            schema_version: 1,
            snapshot_version: 1,
            identity_hash: String::new(),
            refresh_reason: String::new(),
        }
    }
}

/// 元数据字段记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceObjectFieldRecord {
    /// 数据源 ID。
    pub source_id: String,
    /// 对象名。
    pub object_name: String,
    /// 字段名。
    pub field_name: String,
    /// 标签。
    pub label: String,
    /// 数据类型。
    pub data_type: String,
    /// 是否允许为空。
    pub nillable: bool,
    /// 是否可更新。
    pub updateable: bool,
    /// 是否可创建。
    pub createable: bool,
    /// 原始 metadata。
    pub metadata: HashMap<String, Value>,
    /// 排序号。
    pub sort_order: i64,
}

impl SourceObjectFieldRecord {
    /// 构造文本字段记录。
    pub fn text(object_name: &str, field_name: &str, sort_order: i64) -> Self {
        Self {
            source_id: String::new(),
            object_name: object_name.to_string(),
            field_name: field_name.to_string(),
            label: field_name.to_string(),
            data_type: "string".to_string(),
            nillable: true,
            updateable: true,
            createable: true,
            metadata: HashMap::new(),
            sort_order,
        }
    }
}

/// 元数据关系记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceObjectRelationRecord {
    /// 数据源 ID。
    pub source_id: String,
    /// 对象名。
    pub object_name: String,
    /// 关系名。
    pub relation_name: String,
    /// 子对象名。
    pub child_sobject: String,
    /// 字段名。
    pub field_name: String,
    /// relationshipName。
    pub relationship_name: String,
    /// 是否隐藏。
    pub deprecated_and_hidden: bool,
    /// 关系类型。
    pub relation_type: String,
    /// 排序号。
    pub sort_order: i64,
}

/// 元数据 blob 记录。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceMetadataBlobRecord {
    /// blob ID。
    pub id: String,
    /// 数据源 ID。
    pub source_id: String,
    /// 对象名。
    pub object_name: String,
    /// blob 类型。
    pub blob_type: String,
    /// 原始载荷。
    pub payload_json: String,
    /// schema 版本。
    pub schema_version: i64,
    /// 快照版本。
    pub snapshot_version: i64,
}

impl SourceMetadataBlobRecord {
    /// 构造 describe blob。
    pub fn describe(object_name: &str, payload_json: &str) -> Self {
        Self {
            id: uuid::Uuid::new_v4().to_string(),
            source_id: String::new(),
            object_name: object_name.to_string(),
            blob_type: "describe".to_string(),
            payload_json: payload_json.to_string(),
            schema_version: 1,
            snapshot_version: 1,
        }
    }
}

/// 结构化元数据快照写入载荷。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MetadataSnapshotUpsert {
    /// 数据源 ID。
    pub source_id: String,
    /// 对象名。
    pub object_name: String,
    /// schema 版本。
    pub schema_version: i64,
    /// 快照版本。
    pub snapshot_version: i64,
    /// 身份哈希。
    pub identity_hash: String,
    /// 刷新原因。
    pub refresh_reason: String,
    /// 对象记录。
    pub object: SourceObjectRecord,
    /// 字段记录列表。
    pub fields: Vec<SourceObjectFieldRecord>,
    /// 索引记录列表。
    pub indexes: Vec<Value>,
    /// 约束记录列表。
    pub constraints: Vec<Value>,
    /// 关系记录列表。
    pub relations: Vec<SourceObjectRelationRecord>,
    /// blob 列表。
    pub blobs: Vec<SourceMetadataBlobRecord>,
    /// 可选 DDL。
    #[serde(default)]
    pub ddl: Option<ObjectDdl>,
}

/// 单对象结构化快照。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectSnapshot {
    /// 对象记录。
    pub object: SourceObjectRecord,
    /// 字段列表。
    pub fields: Vec<SourceObjectFieldRecord>,
    /// 关系列表。
    pub relations: Vec<SourceObjectRelationRecord>,
    /// blob 列表。
    pub blobs: Vec<SourceMetadataBlobRecord>,
    /// 可选 DDL。
    pub ddl: Option<ObjectDdl>,
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

/// 工作区标签 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceTabDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 标签类型。
    pub tab_kind: String,
    /// 标题。
    pub title: String,
    /// 数据源 ID。
    pub source_id: Option<String>,
    /// 排序号。
    pub sort_order: i64,
    /// 是否激活。
    pub is_active: i64,
    /// 扩展载荷。
    #[serde(default)]
    pub payload_json: Value,
}

impl WorkspaceTabDto {
    /// 构造 query 标签。
    pub fn query(tab_id: &str, title: &str, source_id: &str) -> Self {
        Self {
            tab_id: tab_id.to_string(),
            tab_kind: "query".to_string(),
            title: title.to_string(),
            source_id: Some(source_id.to_string()),
            sort_order: 1,
            is_active: 1,
            payload_json: Value::Object(serde_json::Map::new()),
        }
    }
}

/// Query 标签状态 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryTabStateDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 绑定键。
    pub binding_key: String,
    /// 数据源 ID。
    pub source_id: String,
    /// 数据源类型。
    pub source_type: String,
    /// 数据源名称。
    pub source_name: String,
    /// 数据源颜色。
    pub source_color: String,
    /// 对象名。
    pub object_name: String,
    /// 标签显示名。
    pub label: String,
    /// describe。
    pub describe_json: Option<Value>,
    /// where 草稿。
    pub where_clause: String,
    /// limit。
    pub limit: i64,
    /// 排序字段。
    pub sort_field: String,
    /// 排序方向。
    pub sort_direction: String,
    /// 排序表达式。
    pub sort_clause: String,
    /// 当前查询。
    pub current_soql: String,
    /// 草稿查询。
    pub soql_draft: String,
    /// 是否展示查询栏。
    pub show_query_bar: bool,
    /// 是否展示抽屉。
    pub show_drawer: bool,
    /// 抽屉视图。
    pub drawer_view: String,
    /// 是否展示日志。
    pub show_logs: bool,
    /// 列可见性。
    pub column_visibility: Value,
    /// 提示。
    pub notice_json: Option<Value>,
}

impl QueryTabStateDto {
    /// 构造最小 seed。
    pub fn seed(tab_id: &str, source_id: &str, object_name: &str) -> Self {
        Self {
            tab_id: tab_id.to_string(),
            binding_key: format!("{source_id}::{object_name}"),
            source_id: source_id.to_string(),
            source_type: "salesforce".to_string(),
            source_name: String::new(),
            source_color: String::new(),
            object_name: object_name.to_string(),
            label: object_name.to_string(),
            describe_json: None,
            where_clause: String::new(),
            limit: 200,
            sort_field: String::new(),
            sort_direction: "DESC".to_string(),
            sort_clause: String::new(),
            current_soql: String::new(),
            soql_draft: String::new(),
            show_query_bar: true,
            show_drawer: false,
            drawer_view: "salesforce".to_string(),
            show_logs: false,
            column_visibility: Value::Object(serde_json::Map::new()),
            notice_json: None,
        }
    }
}

/// Query 结果集 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryResultSetDto {
    /// 结果集 ID。
    pub result_set_id: String,
    /// 标签 ID。
    pub tab_id: String,
    /// 恢复状态：fresh/stale/invalid。
    pub result_status: String,
    /// 总条数。
    pub total_size: i64,
    /// 记录列表。
    pub records_json: Value,
}

impl QueryResultSetDto {
    /// 构造 stale seed。
    pub fn stale_seed(
        result_set_id: &str,
        tab_id: &str,
        _source_id: &str,
        _object_name: &str,
    ) -> Self {
        Self {
            result_set_id: result_set_id.to_string(),
            tab_id: tab_id.to_string(),
            result_status: "stale".to_string(),
            total_size: 0,
            records_json: Value::Array(Vec::new()),
        }
    }
}

/// Query 行草稿 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct QueryRowDraftDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 已勾选记录。
    pub selected_record_ids_json: Value,
    /// 待删除记录。
    pub pending_delete_record_ids_json: Value,
    /// 脏单元格键。
    pub dirty_cell_keys_json: Value,
    /// baseline。
    pub baseline_records_json: Value,
}

/// Console 标签状态 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ConsoleTabStateDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 数据源 ID。
    pub source_id: String,
    /// 数据源类型。
    pub source_type: String,
    /// 数据源名称。
    pub source_name: String,
    /// 数据源颜色。
    pub source_color: String,
    /// 标签名。
    pub name: String,
    /// 草稿。
    pub soql_draft: String,
    /// 选中文本。
    pub selected_soql_text: String,
    /// 查询结果。
    pub result_json: Value,
    /// 提示。
    pub notice_json: Option<Value>,
    /// 日志列表。
    pub logs_json: Value,
    /// 已选记录。
    pub selected_record_ids_json: Value,
    /// 是否显示底部面板。
    pub show_bottom_panel: bool,
    /// AI 会话 ID。
    pub ai_conversation_id: String,
    /// AI 提示词草稿。
    pub ai_prompt_draft: String,
    /// AI 消息列表。
    pub ai_messages_json: Value,
    /// 是否 AI 模式。
    pub ai_mode: bool,
}

/// 工具标签状态 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct ToolTabStateDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 工具类型。
    pub tool_kind: String,
    /// 标签名。
    pub name: String,
    /// 结构化载荷。
    pub payload_json: Value,
}

/// 终端标签状态 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct TerminalTabStateDto {
    /// 标签 ID。
    pub tab_id: String,
    /// 标签名。
    pub name: String,
    /// 输入草稿。
    pub input_draft: String,
    /// 输出列表。
    pub outputs_json: Value,
}

/// 工作区快照 DTO。
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceSnapshotDto {
    /// 全部工作区标签。
    pub tabs: Vec<WorkspaceTabDto>,
    /// Query 标签状态。
    pub query_tabs: Vec<QueryTabStateDto>,
    /// Query 结果集。
    pub query_results: Vec<QueryResultSetDto>,
    /// Query 草稿。
    pub query_row_drafts: Vec<QueryRowDraftDto>,
    /// Console 标签状态。
    pub console_tabs: Vec<ConsoleTabStateDto>,
    /// 工具标签状态。
    pub tool_tabs: Vec<ToolTabStateDto>,
    /// 终端标签状态。
    pub terminal_tabs: Vec<TerminalTabStateDto>,
    /// 工作区 UI 扩展状态。
    #[serde(default)]
    pub ui_state: HashMap<String, Value>,
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
pub struct RecordSaveWithDeletePayload {
    /// 数据源 ID。
    pub source_id: String,
    /// 目标对象名称。
    pub object_name: String,
    /// 待新增记录列表。
    pub creates: Vec<HashMap<String, Value>>,
    /// 待更新记录列表。
    pub updates: Vec<RecordUpdatePayload>,
    /// 待删除记录 Id 列表。
    pub deletes: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationPreviewSqlItem {
    /// 操作类型：create/update/delete。
    pub op: String,
    /// 同类操作内的顺序索引：用于前端把 SQL 回填到对应预览项。
    pub operation_index: usize,
    /// 预览 SQL 文本。
    pub preview_sql: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationExecutionItem {
    /// 操作类型：create/update/delete。
    pub op: String,
    /// 同类操作内的顺序索引：用于前端映射执行结果。
    pub operation_index: usize,
    /// 当前操作的记录定位值；create 场景通常为空字符串。
    pub row_locator: String,
    /// 当前操作影响行数。
    pub rows_affected: u64,
    /// 当前操作是否执行成功。
    pub success: bool,
    /// 与真实执行共用归一化逻辑构造的预览 SQL。
    pub preview_sql: String,
    /// 失败原因；成功时返回空字符串。
    pub error: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MutationExecutionResult {
    /// 新增操作数量。
    pub create_count: usize,
    /// 更新操作数量。
    pub update_count: usize,
    /// 删除操作数量。
    pub delete_count: usize,
    /// 单条执行结果列表。
    pub items: Vec<MutationExecutionItem>,
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

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCommandGroupUpsertPayload {
    /// 命令组名称。
    pub name: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalShellSettings {
    /// 当前保存的绝对路径命令。
    pub command_value: Option<String>,
    /// 旧版偏好字段（如 pwsh / powershell）。
    pub legacy_preference: Option<String>,
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
