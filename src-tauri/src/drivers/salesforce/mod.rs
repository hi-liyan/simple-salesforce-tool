use std::collections::HashMap;
use std::sync::Arc;

use serde_json::Value;

use crate::drivers::{BoxFuture, DataSourceDriver, ProviderCapabilities};
use crate::error::AppError;
use crate::models::{
    CurrentUserContext, ObjectDdl, ObjectDescribe, QueryResult, RecordUpdatePayload,
    SalesforceObject, SalesforceSource, SourceUpsertPayload,
};
use crate::salesforce::SalesforceClient;

/// Salesforce 数据源驱动：实现统一 `DataSourceDriver` Trait 并托管 REST/SOQL 能力。
pub struct SalesforceDriver {
    /// 共享 HTTP 客户端。
    client: Arc<SalesforceClient>,
}

impl SalesforceDriver {
    /// 创建 Salesforce 驱动实例。
    pub fn new(client: Arc<SalesforceClient>) -> Self {
        Self { client }
    }
}

impl DataSourceDriver for SalesforceDriver {
    fn kind(&self) -> &'static str {
        "salesforce"
    }

    fn capabilities(&self) -> ProviderCapabilities {
        ProviderCapabilities {
            query_language: "soql".to_string(),
            supports_ddl: false,
            supports_table_designer: false,
            supports_backup: false,
            supports_transactional_batch: false,
            supports_create: true,
            supports_update: true,
            supports_delete: true,
            supports_mutation_preview: false,
            supports_child_relationships: true,
            supports_auth_window: true,
            supports_interactive_transaction: false,
            null_display_text: "None".to_string(),
        }
    }

    fn validate_config(&self, payload: &SourceUpsertPayload) -> Result<(), AppError> {
        if payload.name.trim().is_empty() {
            return Err(AppError::Biz("Source name cannot be empty".to_string()));
        }
        if payload.instance_url.trim().is_empty() {
            return Err(AppError::Biz("Instance URL cannot be empty".to_string()));
        }
        if payload.access_token.trim().is_empty() {
            return Err(AppError::Biz("Access token cannot be empty".to_string()));
        }
        if !payload.api_version.starts_with('v') {
            return Err(AppError::Biz(
                "API version must start with v, e.g. v61.0".to_string(),
            ));
        }
        Ok(())
    }

    fn extract_secrets(&self, payload: &SourceUpsertPayload) -> HashMap<String, String> {
        let mut secrets = HashMap::new();
        if !payload.access_token.trim().is_empty() {
            secrets.insert(
                "accessToken".to_string(),
                payload.access_token.trim().to_string(),
            );
        }
        secrets
    }

    fn inject_runtime_secrets(
        &self,
        source: &mut SalesforceSource,
        secrets: &HashMap<String, String>,
    ) {
        if let Some(token) = secrets.get("accessToken") {
            source.access_token = token.clone();
        }
    }

    fn test_connection<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<(), AppError>> {
        Box::pin(async move {
            if self.client.validate_token(source).await {
                Ok(())
            } else {
                Err(AppError::Biz(
                    "Salesforce 连接校验失败（Token 无效）".to_string(),
                ))
            }
        })
    }

    fn validate_token<'a>(&'a self, source: &'a SalesforceSource) -> BoxFuture<'a, bool> {
        Box::pin(async move { self.client.validate_token(source).await })
    }

    fn list_objects<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<Vec<SalesforceObject>, AppError>> {
        Box::pin(async move { self.client.list_objects(source).await })
    }

    fn describe_object<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDescribe, AppError>> {
        Box::pin(async move { self.client.describe_object(source, object_name).await })
    }

    fn get_object_ddl<'a>(
        &'a self,
        _source: &'a SalesforceSource,
        _object_name: &'a str,
    ) -> BoxFuture<'a, Result<ObjectDdl, AppError>> {
        Box::pin(async {
            Err(AppError::Biz(
                "Salesforce 数据源暂不支持查看对象 DDL。".to_string(),
            ))
        })
    }

    fn resolve_field_child_relationship_name<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        field_name: &'a str,
    ) -> BoxFuture<'a, Result<Option<String>, AppError>> {
        Box::pin(async move {
            self.client
                .resolve_field_child_relationship_name(source, object_name, field_name)
                .await
        })
    }

    fn query_records<'a>(
        &'a self,
        source: &'a SalesforceSource,
        query_text: &'a str,
        _describe: Option<&'a ObjectDescribe>,
    ) -> BoxFuture<'a, Result<QueryResult, AppError>> {
        Box::pin(async move { self.client.query_records(source, query_text).await })
    }

    fn get_current_user_context<'a>(
        &'a self,
        source: &'a SalesforceSource,
    ) -> BoxFuture<'a, Result<CurrentUserContext, AppError>> {
        Box::pin(async move { self.client.get_current_user_context(source).await })
    }

    fn create_record<'a>(
        &'a self,
        source: &'a SalesforceSource,
        object_name: &'a str,
        values: HashMap<String, Value>,
    ) -> BoxFuture<'a, Result<String, AppError>> {
        Box::pin(async move {
            self.client
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
            self.client
                .save_records(source, object_name, creates, updates)
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
            self.client
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
            self.client
                .delete_record(source, object_name, record_id)
                .await
        })
    }
}
