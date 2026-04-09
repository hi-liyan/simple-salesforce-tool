mod mysql_provider;
mod salesforce_provider;

use std::collections::HashMap;

use serde_json::Value;

use crate::app_state::AppState;
use crate::error::AppError;
use crate::models::{
    CurrentUserContext, ObjectDdl, ObjectDescribe, QueryResult, RecordUpdatePayload,
    SalesforceObject, SalesforceSource,
};
use mysql_provider::MySqlProvider;
pub use mysql_provider::{
    preview_create_record_sql, preview_delete_record_sql, preview_save_records_sql,
    preview_save_records_with_deletes_sql, preview_update_record_sql,
};
use salesforce_provider::SalesforceProvider;

/// Provider 路由枚举：按数据源类型分发到具体实现。
pub enum DataProvider<'a> {
    /// Salesforce Provider。
    Salesforce(SalesforceProvider<'a>),
    /// MySQL Provider。
    MySql(MySqlProvider),
}

/// 根据数据源类型创建 Provider。
pub fn provider_for_source<'a>(
    state: &'a AppState,
    source: &SalesforceSource,
) -> Result<DataProvider<'a>, AppError> {
    if source.is_salesforce() {
        return Ok(DataProvider::Salesforce(SalesforceProvider::new(
            &state.sf_client,
        )));
    }
    if source.source_type.eq_ignore_ascii_case("mysql") {
        return Ok(DataProvider::MySql(MySqlProvider::new()));
    }
    Err(AppError::Biz(format!(
        "当前版本暂不支持该数据源类型: {}",
        source.source_type
    )))
}

impl DataProvider<'_> {
    /// 测试数据源连接是否可用。
    pub async fn test_connection(&self, source: &SalesforceSource) -> Result<(), AppError> {
        match self {
            DataProvider::Salesforce(provider) => provider.test_connection(source).await,
            DataProvider::MySql(provider) => provider.test_connection(source).await,
        }
    }

    /// 拉取对象列表。
    pub async fn list_objects(
        &self,
        source: &SalesforceSource,
    ) -> Result<Vec<SalesforceObject>, AppError> {
        match self {
            DataProvider::Salesforce(provider) => provider.list_objects(source).await,
            DataProvider::MySql(provider) => provider.list_objects(source).await,
        }
    }

    /// 读取对象字段元数据。
    pub async fn describe_object(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDescribe, AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider.describe_object(source, object_name).await
            }
            DataProvider::MySql(provider) => provider.describe_object(source, object_name).await,
        }
    }

    /// 查询字段 childRelationshipName。
    pub async fn resolve_field_child_relationship_name(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        field_name: &str,
    ) -> Result<Option<String>, AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider
                    .resolve_field_child_relationship_name(source, object_name, field_name)
                    .await
            }
            DataProvider::MySql(provider) => {
                provider
                    .resolve_field_child_relationship_name(source, object_name, field_name)
                    .await
            }
        }
    }

    /// 执行查询语句。
    pub async fn query_records(
        &self,
        source: &SalesforceSource,
        query_text: &str,
        describe: Option<&ObjectDescribe>,
    ) -> Result<QueryResult, AppError> {
        match self {
            DataProvider::Salesforce(provider) => provider.query_records(source, query_text).await,
            DataProvider::MySql(provider) => provider.query_records(source, query_text, describe).await,
        }
    }

    /// 获取当前登录用户上下文。
    pub async fn get_current_user_context(
        &self,
        source: &SalesforceSource,
    ) -> Result<CurrentUserContext, AppError> {
        match self {
            DataProvider::Salesforce(provider) => provider.get_current_user_context(source).await,
            DataProvider::MySql(provider) => provider.get_current_user_context(source).await,
        }
    }

    /// 新增单条记录。
    pub async fn create_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        values: HashMap<String, Value>,
    ) -> Result<String, AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider.create_record(source, object_name, values).await
            }
            DataProvider::MySql(provider) => {
                provider.create_record(source, object_name, values).await
            }
        }
    }

    /// 批量保存记录（新增+更新）。
    pub async fn save_records(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> Result<(), AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider
                    .save_records(source, object_name, creates, updates)
                    .await
            }
            DataProvider::MySql(provider) => {
                provider
                    .save_records(source, object_name, creates, updates)
                    .await
            }
        }
    }

    /// 批量保存记录（新增+更新+删除），仅 MySQL 支持单事务。
    pub async fn save_records_with_deletes(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
        deletes: Vec<String>,
    ) -> Result<(), AppError> {
        match self {
            DataProvider::Salesforce(_) => Err(AppError::Biz(
                "Salesforce 暂不支持单事务批量提交（含删除）。".to_string(),
            )),
            DataProvider::MySql(provider) => {
                provider
                    .save_records_with_deletes(source, object_name, creates, updates, deletes)
                    .await
            }
        }
    }

    /// 更新单条记录。
    pub async fn update_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
        values: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider
                    .update_record(source, object_name, record_id, values)
                    .await
            }
            DataProvider::MySql(provider) => {
                provider
                    .update_record(source, object_name, record_id, values)
                    .await
            }
        }
    }

    /// 删除单条记录。
    pub async fn delete_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
    ) -> Result<(), AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider.delete_record(source, object_name, record_id).await
            }
            DataProvider::MySql(provider) => {
                provider.delete_record(source, object_name, record_id).await
            }
        }
    }

    /// 快速校验 token 是否可用。
    pub async fn validate_token(&self, source: &SalesforceSource) -> bool {
        match self {
            DataProvider::Salesforce(provider) => provider.validate_token(source).await,
            DataProvider::MySql(provider) => provider.validate_token(source).await,
        }
    }

    /// 读取对象 DDL（仅关系型数据源可用）。
    pub async fn get_object_ddl(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDdl, AppError> {
        match self {
            DataProvider::Salesforce(provider) => {
                provider.get_object_ddl(source, object_name).await
            }
            DataProvider::MySql(provider) => provider.get_object_ddl(source, object_name).await,
        }
    }
}
