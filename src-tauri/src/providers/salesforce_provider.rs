use std::collections::HashMap;

use serde_json::Value;

use crate::error::AppError;
use crate::models::{
    CurrentUserContext, ObjectDdl, ObjectDescribe, QueryResult, RecordUpdatePayload, SalesforceObject,
    SalesforceSource,
};
use crate::salesforce::SalesforceClient;

/// Salesforce Provider：封装与 SalesforceClient 的一一映射调用，便于统一路由层复用。
pub struct SalesforceProvider<'a> {
    /// 共享 Salesforce HTTP 客户端。
    client: &'a SalesforceClient,
}

impl<'a> SalesforceProvider<'a> {
    /// 创建 Salesforce Provider 实例。
    pub fn new(client: &'a SalesforceClient) -> Self {
        Self { client }
    }

    /// 测试 Salesforce 数据源连接：通过 token 校验快速判断可用性。
    pub async fn test_connection(&self, source: &SalesforceSource) -> Result<(), AppError> {
        if self.client.validate_token(source).await {
            Ok(())
        } else {
            Err(AppError::Biz(
                "Salesforce 连接校验失败（Token 无效）".to_string(),
            ))
        }
    }

    /// 拉取对象列表。
    pub async fn list_objects(
        &self,
        source: &SalesforceSource,
    ) -> Result<Vec<SalesforceObject>, AppError> {
        self.client.list_objects(source).await
    }

    /// 读取对象字段元数据。
    pub async fn describe_object(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDescribe, AppError> {
        self.client.describe_object(source, object_name).await
    }

    /// 查询字段 childRelationshipName。
    pub async fn resolve_field_child_relationship_name(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        field_name: &str,
    ) -> Result<Option<String>, AppError> {
        self.client
            .resolve_field_child_relationship_name(source, object_name, field_name)
            .await
    }

    /// 执行 SOQL 查询。
    pub async fn query_records(
        &self,
        source: &SalesforceSource,
        soql: &str,
    ) -> Result<QueryResult, AppError> {
        self.client.query_records(source, soql).await
    }

    /// 获取当前登录用户上下文。
    pub async fn get_current_user_context(
        &self,
        source: &SalesforceSource,
    ) -> Result<CurrentUserContext, AppError> {
        self.client.get_current_user_context(source).await
    }

    /// 新增单条记录。
    pub async fn create_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        values: HashMap<String, Value>,
    ) -> Result<String, AppError> {
        self.client.create_record(source, object_name, values).await
    }

    /// 批量保存记录（新增+更新）。
    pub async fn save_records(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> Result<(), AppError> {
        self.client
            .save_records(source, object_name, creates, updates)
            .await
    }

    /// 更新单条记录。
    pub async fn update_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
        values: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        self.client
            .update_record(source, object_name, record_id, values)
            .await
    }

    /// 删除单条记录。
    pub async fn delete_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
    ) -> Result<(), AppError> {
        self.client
            .delete_record(source, object_name, record_id)
            .await
    }

    /// 快速校验 token 是否可用。
    pub async fn validate_token(&self, source: &SalesforceSource) -> bool {
        self.client.validate_token(source).await
    }

    /// Salesforce 不提供关系型表 DDL，统一返回不支持提示。
    pub async fn get_object_ddl(
        &self,
        _source: &SalesforceSource,
        _object_name: &str,
    ) -> Result<ObjectDdl, AppError> {
        Err(AppError::Biz(
            "当前数据源类型不支持 DDL 信息展示。".to_string(),
        ))
    }
}
