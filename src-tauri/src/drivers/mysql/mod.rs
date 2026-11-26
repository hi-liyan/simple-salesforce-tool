use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::drivers::connection_manager::ConnectionManager;
use crate::drivers::{BoxFuture, DataSourceDriver, ProviderCapabilities};
use crate::error::AppError;
use crate::models::{
    MutationExecutionResult, ObjectDdl, ObjectDescribe, QueryResult, RecordUpdatePayload,
    SalesforceObject, SalesforceSource, SourceUpsertPayload,
};
use crate::providers::mysql_provider::MySqlProvider;

/// MySQL 数据源驱动：实现统一 `DataSourceDriver` Trait 并接入 `ConnectionManager` 连接池管理。
pub struct MySqlDriver {
    /// 内部 MySQL 执行器。
    inner: MySqlProvider,
    /// 连接池管理器（用于后续复用连接池与配置变更驱逐）。
    _connection_manager: Arc<ConnectionManager>,
}

impl MySqlDriver {
    /// 创建 MySQL 驱动实例。
    pub fn new(connection_manager: Arc<ConnectionManager>) -> Self {
        Self {
            inner: MySqlProvider::new(),
            _connection_manager: connection_manager,
        }
    }
}

impl DataSourceDriver for MySqlDriver {
    fn kind(&self) -> &'static str {
        "mysql"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            query_language: "mysql".to_string(),
            supports_ddl: true,
            supports_transactional_batch: true,
            supports_create: true,
            supports_update: true,
            supports_delete: true,
            supports_mutation_preview: true,
            supports_child_relationships: false,
            supports_auth_window: false,
            null_display_text: "Null".to_string(),
        }
    }

    fn validate_config(&self, payload: &SourceUpsertPayload) -> Result<(), AppError> {
        if payload.name.trim().is_empty() {
            return Err(AppError::Biz("Source name cannot be empty".to_string()));
        }
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
            return Err(AppError::Biz(
                "MySQL config 缺少必填项：host/database/username".to_string(),
            ));
        }
        Ok(())
    }

    fn extract_secrets(&self, payload: &SourceUpsertPayload) -> HashMap<String, String> {
        let mut secrets = HashMap::new();
        if let Some(password) = payload
            .config_json
            .get("password")
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            secrets.insert("password".to_string(), password.to_string());
        }
        secrets
    }

    fn inject_runtime_secrets(
        &self,
        source: &mut SalesforceSource,
        secrets: &HashMap<String, String>,
    ) {
        if let Some(password) = secrets.get("password") {
            if let Some(config) = source.config_json.as_object_mut() {
                // 行内注释：运行时将加密域密码注回 config_json，供 MySQL 连接配置读取。
                config.insert("password".to_string(), Value::String(password.clone()));
            }
        }
    }

    fn test_connection<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move { self.inner.test_connection(source).await })
    }

    fn validate_token<'a>(&'a self, source: &'a SalesforceSource) -> BoxFuture<'a, bool> {
        Box::pin(async move { self.inner.validate_token(source).await })
    }

    fn list_objects<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<Vec<SalesforceObject>, AppError>> {
        Box::pin(async move { self.inner.list_objects(source).await })
    }

    fn describe_object<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDescribe, AppError>> {
        Box::pin(async move { self.inner.describe_object(source, object_name).await })
    }

    fn get_object_ddl<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDdl, AppError>> {
        Box::pin(async move { self.inner.get_object_ddl(source, object_name).await })
    }

    fn query_records<'a>(
        &'a self,
        source: &'a SalesforceSource,
        query_text: &'a str,
        describe: Option<&'a ObjectDescribe>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move {
            self.inner
                .query_records(source, query_text, describe)
                .await
        })
    }

    fn create_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        values: HashMap<String, Value>,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move {
            self.inner
                .create_record(source, object_name, values)
                .await
        })
    }

    fn save_records<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.inner
                .save_records(source, object_name, creates, updates)
                .await
        })
    }

    fn save_records_with_deletes<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
        deletes: Vec<String>,
    ) -> BoxFuture<'a, Result<MutationExecutionResult, AppError>> {
        Box::pin(async move {
            self.inner
                .save_records_with_deletes(source, object_name, creates, updates, deletes)
                .await
        })
    }

    fn update_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        record_id: &'a str,
        values: HashMap<String, Value>,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.inner
                .update_record(source, object_name, record_id, values)
                .await
        })
    }

    fn delete_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        record_id: &'a str,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            self.inner
                .delete_record(source, object_name, record_id)
                .await
        })
    }
}
