pub mod connection_manager;
pub mod mysql;
pub mod salesforce;

use std::collections::HashMap;
use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::error::AppError;
use crate::models::{
    CurrentUserContext, MutationExecutionResult, ObjectDdl, ObjectDescribe, QueryResult,
    RecordUpdatePayload, SalesforceObject, SalesforceSource, SourceUpsertPayload,
};

/// 对象安全异步返回类型：避免引入额外宏依赖即可实现 `Arc<dyn DataSourceDriver>` 动态分发。
pub type BoxFuture<'a, T> = Pin<Box<dyn Future<Output = T> + Send + 'a>>;

/// 数据源能力声明矩阵：由各驱动声明自身支持的操作，供前后端统一控制按钮显隐与行为路由。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderCapabilities {
    /// 查询语言标识（如 "soql" / "mysql" / "postgres"）。
    pub query_language: String,
    /// 是否支持读取对象 DDL。
    pub supports_ddl: bool,
    /// 是否支持单事务批量提交（含删除）。
    pub supports_transactional_batch: bool,
    /// 是否支持新增记录。
    pub supports_create: bool,
    /// 是否支持更新记录。
    pub supports_update: bool,
    /// 是否支持删除记录。
    pub supports_delete: bool,
    /// 是否支持变更前 SQL 预览与两阶段提交。
    pub supports_mutation_preview: bool,
    /// 是否支持子关系查询（如 Salesforce ChildRelationship）。
    pub supports_child_relationships: bool,
    /// 是否支持独立认证窗口与 CLI 同步。
    pub supports_auth_window: bool,
    /// 空值展示占位文本（如 "Null" / "None"）。
    pub null_display_text: String,
}

/// 统一数据源驱动抽象：所有数据源必须实现该 Trait 并注册到 `DriverRegistry`。
pub trait DataSourceDriver: Send + Sync {
    /// 返回驱动类型标识（小写，如 "salesforce"、"mysql"、"postgres"）。
    fn kind(&self) -> &'static str;

    /// 返回该数据源的能力矩阵。
    fn capabilities(&self) -> ProviderCapabilities;

    /// 校验新建/更新数据源的请求参数合法性。
    fn validate_config(&self, payload: &SourceUpsertPayload) -> Result<(), AppError>;

    /// 从保存载荷中抽取需要加密落盘的敏感凭证键值对。
    fn extract_secrets(&self, payload: &SourceUpsertPayload) -> HashMap<String, String>;

    /// 在运行时将解密后的凭证注回数据源对象（供驱动连接使用）。
    fn inject_runtime_secrets(
        &self,
        source: &mut SalesforceSource,
        secrets: &HashMap<String, String>,
    );

    /// 测试数据源连通性。
    fn test_connection<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// 快速校验认证令牌/连接是否有效。
    fn validate_token<'a>(&'a self, source: &'a SalesforceSource) -> BoxFuture<'a, bool>;

    /// 拉取数据源下的对象/表列表。
    fn list_objects<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<Vec<SalesforceObject>, AppError>>;

    /// 读取指定对象/表的字段与关系元数据。
    fn describe_object<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDescribe, AppError>>;

    /// 读取指定对象/表的 DDL（不支持的数据源返回默认错误）。
    fn get_object_ddl<'a>(
        &'a self,
        _source: &'a SalesforceSource,
        _object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDdl, AppError>> {
        let kind = self.kind();
        Box::pin(async move {
            Err(AppError::Biz(format!(
                "数据源类型 {kind} 不支持查看对象 DDL"
            )))
        })
    }

    /// 解析字段的子关系名称（不支持的数据源默认返回 `None`）。
    fn resolve_field_child_relationship_name<'a>(
        &'a self,
        _source: &'a SalesforceSource,
        _object_name: &'a str,
        _field_name: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async { Ok(None) })
    }

    /// 执行查询语句并返回结果集。
    fn query_records<'a>(
        &'a self,
        source: &'a SalesforceSource,
        query_text: &'a str,
        describe: Option<&'a ObjectDescribe>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>>;

    /// 获取当前登录用户上下文（默认返回空上下文）。
    fn get_current_user_context<'a>(
        &'a self,
        _source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<CurrentUserContext, AppError>> {
        Box::pin(async {
            Ok(CurrentUserContext {
                timezone_sid_key: None,
                locale_sid_key: None,
            })
        })
    }

    /// 新增单条记录。
    fn create_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        values: HashMap<String, Value>,
    ) -> BoxFuture<'a, Result<String, AppError>>;

    /// 批量保存记录（新增 + 更新）。
    fn save_records<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// 批量保存记录（新增 + 更新 + 删除），默认返回不支持。
    fn save_records_with_deletes<'a>(
        &'a self,
        _source: &'a SalesforceSource,
        _object_name: &'a str,
        _creates: Vec<HashMap<String, Value>>,
        _updates: Vec<RecordUpdatePayload>,
        _deletes: Vec<String>,
    ) -> BoxFuture<'a, Result<MutationExecutionResult, AppError>> {
        let kind = self.kind();
        Box::pin(async move {
            Err(AppError::Biz(format!(
                "数据源类型 {kind} 暂不支持单事务批量提交（含删除）"
            )))
        })
    }

    /// 更新单条记录。
    fn update_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        record_id: &'a str,
        values: HashMap<String, Value>,
    ) -> BoxFuture<'a, Result<(), AppError>>;

    /// 删除单条记录。
    fn delete_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        record_id: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>>;
}

/// 驱动注册表：统一管理全部已接入的数据源驱动实例。
#[derive(Default)]
pub struct DriverRegistry {
    /// 按小写数据源类型索引的驱动映射表。
    drivers: HashMap<String, Arc<dyn DataSourceDriver>>,
}

impl DriverRegistry {
    /// 创建空驱动注册表。
    pub fn new() -> Self {
        Self {
            drivers: HashMap::new(),
        }
    }

    /// 创建并注册全部内置数据源驱动。
    pub fn with_builtin_drivers(
        sf_client: Arc<crate::salesforce::SalesforceClient>,
        connection_manager: Arc<connection_manager::ConnectionManager>,
    ) -> Self {
        let mut registry = Self::new();
        registry.register(Arc::new(salesforce::SalesforceDriver::new(sf_client)));
        registry.register(Arc::new(mysql::MySqlDriver::new(connection_manager)));
        registry
    }

    /// 注册一个数据源驱动。
    pub fn register(&mut self, driver: Arc<dyn DataSourceDriver>) {
        self.drivers
            .insert(driver.kind().to_ascii_lowercase(), driver);
    }

    /// 按数据源类型获取对应驱动。
    pub fn get(&self, source_type: &str) -> Result<Arc<dyn DataSourceDriver>, AppError> {
        let normalized = source_type.trim().to_ascii_lowercase();
        let key = if normalized.is_empty() {
            "salesforce"
        } else {
            normalized.as_str()
        };
        self.drivers
            .get(key)
            .cloned()
            .ok_or_else(|| AppError::Biz(format!("当前版本暂不支持该数据源类型: {source_type}")))
    }

    /// 列出全部已注册驱动的能力矩阵，供前端动态发现可用数据源与能力。
    pub fn list_capabilities(&self) -> Vec<(String, ProviderCapabilities)> {
        let mut items = self
            .drivers
            .iter()
            .map(|(kind, driver)| (kind.clone(), driver.capabilities()))
            .collect::<Vec<_>>();
        items.sort_by(|a, b| a.0.cmp(&b.0));
        items
    }
}
