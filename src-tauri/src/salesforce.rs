use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    CurrentUserContext, ObjectChildRelationship, ObjectDescribe, ObjectField, QueryResult,
    RecordUpdatePayload, SalesforceObject, SalesforceSource,
};

/// Salesforce API 客户端，负责所有外部 HTTP 通讯。
#[derive(Clone)]
pub struct SalesforceClient {
    http: Client,
}

impl SalesforceClient {
    /// 创建 Salesforce HTTP 客户端。
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("simple-salesforce-tool/0.1.0")
            .build()
            .expect("failed to create reqwest client");
        Self { http }
    }

    /// 拉取当前实例下可见对象列表。
    pub async fn list_objects(
        &self,
        source: &SalesforceSource,
    ) -> Result<Vec<SalesforceObject>, AppError> {
        #[derive(Deserialize)]
        struct ObjectsResponse {
            sobjects: Vec<ObjectsItem>,
        }

        #[derive(Deserialize)]
        struct ObjectsItem {
            name: String,
            label: String,
            queryable: bool,
            createable: bool,
            updateable: bool,
            deletable: bool,
        }

        let url = build_url(source, "sobjects");
        let body: ObjectsResponse = self.request_json(source, Method::GET, &url, None).await?;

        Ok(body
            .sobjects
            .into_iter()
            .map(|item| SalesforceObject {
                name: item.name,
                label: item.label,
                comment: None,
                queryable: item.queryable,
                createable: item.createable,
                updateable: item.updateable,
                deletable: item.deletable,
            })
            .collect())
    }

    /// 拉取对象 describe 信息，并保留字段完整元数据。
    pub async fn describe_object(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDescribe, AppError> {
        #[derive(Deserialize)]
        struct DescribeResponse {
            name: String,
            label: String,
            fields: Vec<Value>,
            #[serde(default, rename = "childRelationships")]
            child_relationships: Vec<DescribeChildRelationship>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct DescribeChildRelationship {
            // Salesforce 原始字段名为 childSObject（注意 Object 的 O 大写），这里显式映射避免丢值。
            #[serde(default, rename = "childSObject")]
            child_sobject: String,
            #[serde(default)]
            field: String,
            relationship_name: Option<String>,
            #[serde(default)]
            deprecated_and_hidden: bool,
        }

        let url = build_url(source, &format!("sobjects/{object_name}/describe"));
        let body: DescribeResponse = self.request_json(source, Method::GET, &url, None).await?;

        Ok(ObjectDescribe {
            name: body.name,
            label: body.label,
            fields: body
                .fields
                .into_iter()
                .map(|field| {
                    // Salesforce 字段结构较复杂，先转为对象后再提取常用字段。
                    let metadata = field
                        .as_object()
                        .ok_or_else(|| AppError::Biz("字段元数据格式无效。".to_string()))?
                        .clone();

                    let name = metadata
                        .get("name")
                        .and_then(Value::as_str)
                        .ok_or_else(|| AppError::Biz("字段元数据缺少 name。".to_string()))?
                        .to_string();
                    let label = metadata
                        .get("label")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let data_type = metadata
                        .get("type")
                        .and_then(Value::as_str)
                        .unwrap_or("")
                        .to_string();
                    let nillable = metadata
                        .get("nillable")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let updateable = metadata
                        .get("updateable")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);
                    let createable = metadata
                        .get("createable")
                        .and_then(Value::as_bool)
                        .unwrap_or(false);

                    Ok(ObjectField {
                        name,
                        label,
                        data_type,
                        nillable,
                        updateable,
                        createable,
                        metadata: metadata.into_iter().collect(),
                    })
                })
                .collect::<Result<Vec<_>, AppError>>()?,
            child_relationships: body
                .child_relationships
                .into_iter()
                .map(|item| ObjectChildRelationship {
                    child_sobject: item.child_sobject,
                    field: item.field,
                    relationship_name: item.relationship_name.unwrap_or_default(),
                    deprecated_and_hidden: item.deprecated_and_hidden,
                })
                .collect(),
        })
    }

    /// 解析字段配置的 Child Relationship Name（优先对齐 Salesforce Setup 页面）。
    pub async fn resolve_field_child_relationship_name(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        field_name: &str,
    ) -> Result<Option<String>, AppError> {
        #[derive(Deserialize)]
        struct ToolingQueryResponse {
            #[serde(rename = "totalSize")]
            total_size: usize,
            #[serde(default)]
            records: Vec<Value>,
        }

        let normalized_object_name = object_name.trim();
        let normalized_field_name = field_name.trim();
        if normalized_object_name.is_empty() || normalized_field_name.is_empty() {
            return Ok(None);
        }

        // Tooling CustomField 的 DeveloperName 不含命名空间与 __c 后缀。
        let Some(developer_name) = extract_custom_field_developer_name(normalized_field_name)
        else {
            return Ok(None);
        };

        let object_literal = escape_soql_literal(normalized_object_name);
        let developer_literal = escape_soql_literal(&developer_name);
        let soql = format!(
            "SELECT RelationshipName FROM CustomField WHERE TableEnumOrId = '{object_literal}' AND DeveloperName = '{developer_literal}' ORDER BY NamespacePrefix DESC LIMIT 1"
        );
        let encoded = urlencoding::encode(&soql);
        let url = build_url(source, &format!("tooling/query/?q={encoded}"));
        let body: ToolingQueryResponse = self.request_json(source, Method::GET, &url, None).await?;

        if body.total_size == 0 {
            return Ok(None);
        }

        let relationship_name = body.records.into_iter().find_map(|record| {
            record
                .as_object()
                .and_then(|item| item.get("RelationshipName"))
                .and_then(Value::as_str)
                .map(|item| item.trim().to_string())
                .filter(|item| !item.is_empty())
        });
        Ok(relationship_name)
    }

    /// 执行 SOQL 并返回记录集。
    pub async fn query_records(
        &self,
        source: &SalesforceSource,
        soql: &str,
    ) -> Result<QueryResult, AppError> {
        #[derive(Deserialize)]
        struct QueryResponse {
            #[serde(rename = "totalSize")]
            total_size: usize,
            records: Vec<HashMap<String, Value>>,
        }

        let encoded = urlencoding::encode(soql);
        let url = format!("{}?q={encoded}", build_url(source, "query"));
        let body: QueryResponse = self.request_json(source, Method::GET, &url, None).await?;

        Ok(QueryResult {
            total_size: body.total_size,
            records: body.records,
        })
    }

    /// 获取当前登录用户上下文（时区/地区），用于前端按 Salesforce 用户时区显示 datetime。
    pub async fn get_current_user_context(
        &self,
        source: &SalesforceSource,
    ) -> Result<CurrentUserContext, AppError> {
        #[derive(Deserialize)]
        struct QueryResponse {
            #[serde(default)]
            records: Vec<HashMap<String, Value>>,
        }

        // 优先通过 userinfo 拿当前用户 Id，再精确查询 User.TimeZoneSidKey。
        let mut timezone_sid_key: Option<String> = None;
        let mut locale_sid_key: Option<String> = None;

        if let Some(user_id) = self.fetch_current_user_id(source).await {
            let user_id_literal = escape_soql_literal(&user_id);
            let soql = format!(
                "SELECT TimeZoneSidKey, LocaleSidKey FROM User WHERE Id = '{user_id_literal}' LIMIT 1"
            );
            let encoded = urlencoding::encode(&soql);
            let url = build_url(source, &format!("query/?q={encoded}"));
            if let Ok(body) = self
                .request_json::<QueryResponse>(source, Method::GET, &url, None)
                .await
            {
                if let Some(record) = body.records.into_iter().next() {
                    timezone_sid_key = record
                        .get("TimeZoneSidKey")
                        .and_then(Value::as_str)
                        .map(|item| item.trim().to_string())
                        .filter(|item| !item.is_empty());
                    locale_sid_key = record
                        .get("LocaleSidKey")
                        .and_then(Value::as_str)
                        .map(|item| item.trim().to_string())
                        .filter(|item| !item.is_empty());
                }
            }
        }

        // 兜底：尝试从 chatter/users/me 读取 timezone 字段，避免 userinfo 无权限时完全拿不到时区。
        if timezone_sid_key.is_none() || locale_sid_key.is_none() {
            let me_url = build_url(source, "chatter/users/me");
            if let Ok(me) = self
                .request_json::<Value>(source, Method::GET, &me_url, None)
                .await
            {
                if timezone_sid_key.is_none() {
                    timezone_sid_key = me
                        .get("timezone")
                        .and_then(Value::as_str)
                        .map(|item| item.trim().to_string())
                        .filter(|item| !item.is_empty());
                }
                if locale_sid_key.is_none() {
                    locale_sid_key = me
                        .get("locale")
                        .and_then(Value::as_str)
                        .map(|item| item.trim().to_string())
                        .filter(|item| !item.is_empty());
                }
            }
        }

        Ok(CurrentUserContext {
            timezone_sid_key,
            locale_sid_key,
        })
    }

    /// 新增单条记录，返回新记录 Id。
    pub async fn create_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        values: HashMap<String, Value>,
    ) -> Result<String, AppError> {
        #[derive(Deserialize)]
        struct CreateResponse {
            id: String,
            success: bool,
        }

        let url = build_url(source, &format!("sobjects/{object_name}"));
        let response: CreateResponse = self
            .request_json(
                source,
                Method::POST,
                &url,
                Some(serde_json::to_value(values)?),
            )
            .await?;

        if response.success {
            Ok(response.id)
        } else {
            Err(AppError::Biz("Salesforce 返回创建失败。".to_string()))
        }
    }

    /// 更新单条记录（PATCH）。
    pub async fn update_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
        values: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let url = build_url(source, &format!("sobjects/{object_name}/{record_id}"));
        self.request_unit(
            source,
            Method::PATCH,
            &url,
            Some(serde_json::to_value(values)?),
        )
        .await
    }

    /// 删除单条记录（DELETE）。
    pub async fn delete_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
    ) -> Result<(), AppError> {
        let url = build_url(source, &format!("sobjects/{object_name}/{record_id}"));
        self.request_unit(source, Method::DELETE, &url, None).await
    }

    /// 批量提交新增+更新，使用 Composite API 并开启 all_or_none。
    pub async fn save_records(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> Result<(), AppError> {
        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CompositeRequestItem {
            method: String,
            url: String,
            reference_id: String,
            body: Value,
        }

        #[derive(Serialize)]
        #[serde(rename_all = "camelCase")]
        struct CompositeRequestBody {
            all_or_none: bool,
            composite_request: Vec<CompositeRequestItem>,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CompositeResponseItem {
            http_status_code: u16,
            reference_id: String,
            body: Value,
        }

        #[derive(Deserialize)]
        #[serde(rename_all = "camelCase")]
        struct CompositeResponseBody {
            composite_response: Vec<CompositeResponseItem>,
        }

        if creates.is_empty() && updates.is_empty() {
            return Ok(());
        }

        let mut composite_request: Vec<CompositeRequestItem> =
            Vec::with_capacity(creates.len() + updates.len());

        // 先拼装新增请求。
        for (index, values) in creates.into_iter().enumerate() {
            composite_request.push(CompositeRequestItem {
                method: "POST".to_string(),
                url: format!(
                    "/services/data/{}/sobjects/{object_name}",
                    source.api_version
                ),
                reference_id: format!("create_{index}"),
                body: serde_json::to_value(values)?,
            });
        }

        // 再拼装更新请求。
        for (index, item) in updates.into_iter().enumerate() {
            composite_request.push(CompositeRequestItem {
                method: "PATCH".to_string(),
                url: format!(
                    "/services/data/{}/sobjects/{object_name}/{}",
                    source.api_version, item.record_id
                ),
                reference_id: format!("update_{index}"),
                body: serde_json::to_value(item.values)?,
            });
        }

        if composite_request.len() > 25 {
            return Err(AppError::Biz(
                "批量提交失败：单次执行更新最多支持 25 条（新增+更新总和）。".to_string(),
            ));
        }

        let payload = CompositeRequestBody {
            all_or_none: true,
            composite_request,
        };
        let url = build_url(source, "composite");
        let response: CompositeResponseBody = self
            .request_json(
                source,
                Method::POST,
                &url,
                Some(serde_json::to_value(payload)?),
            )
            .await?;

        // 任一子请求失败都视为整体失败（与 all_or_none 语义保持一致）。
        for item in response.composite_response {
            if !(200..300).contains(&item.http_status_code) {
                return Err(AppError::Biz(format!(
                    "批量提交失败，步骤 {} 状态码 {}: {}",
                    item.reference_id, item.http_status_code, item.body
                )));
            }
        }

        Ok(())
    }

    /// 轻量级 token 校验：向需要认证的 `/services/data/{version}/limits` 发 GET 请求。
    /// 返回 `true` 表示 token 有效，`false` 表示 401 无效。
    /// 网络超时或其他错误视为"可能有效"，避免因网络抖动触发不必要的刷新。
    pub async fn validate_token(&self, source: &SalesforceSource) -> bool {
        let url = format!(
            "{}/services/data/{}/limits",
            source.instance_url.trim_end_matches('/'),
            source.api_version
        );
        let result = self
            .http
            .get(&url)
            .bearer_auth(&source.access_token)
            .timeout(std::time::Duration::from_secs(5))
            .send()
            .await;
        match result {
            Ok(resp) if resp.status() == StatusCode::UNAUTHORIZED => false,
            _ => true,
        }
    }

    /// 发起并解析 JSON 请求（用于有返回体的接口）。
    async fn request_json<T: for<'de> serde::Deserialize<'de>>(
        &self,
        source: &SalesforceSource,
        method: Method,
        url: &str,
        body: Option<Value>,
    ) -> Result<T, AppError> {
        let mut request = self
            .http
            .request(method, url)
            .bearer_auth(&source.access_token)
            .header("Content-Type", "application/json");

        if let Some(payload) = body {
            request = request.json(&payload);
        }

        let response = request.send().await?;
        if !response.status().is_success() {
            let status = response.status();
            let text = response.text().await.unwrap_or_default();
            return Err(AppError::Http(format!(
                "Salesforce 调用失败，状态码 {status}: {text}"
            )));
        }

        Ok(response.json::<T>().await?)
    }

    /// 发起无返回体请求（成功状态含 204）。
    async fn request_unit(
        &self,
        source: &SalesforceSource,
        method: Method,
        url: &str,
        body: Option<Value>,
    ) -> Result<(), AppError> {
        let mut request = self
            .http
            .request(method, url)
            .bearer_auth(&source.access_token)
            .header("Content-Type", "application/json");

        if let Some(payload) = body {
            request = request.json(&payload);
        }

        let response = request.send().await?;
        if response.status() == StatusCode::NO_CONTENT || response.status().is_success() {
            return Ok(());
        }

        let status = response.status();
        let text = response.text().await.unwrap_or_default();
        Err(AppError::Http(format!(
            "Salesforce 调用失败，状态码 {status}: {text}"
        )))
    }
}

impl SalesforceClient {
    /// 调用 OAuth userinfo 解析当前用户 Id（失败时返回 None，不中断主流程）。
    async fn fetch_current_user_id(&self, source: &SalesforceSource) -> Option<String> {
        let userinfo_url = format!(
            "{}/services/oauth2/userinfo",
            source.instance_url.trim_end_matches('/')
        );
        let value = self
            .request_json::<Value>(source, Method::GET, &userinfo_url, None)
            .await
            .ok()?;

        // 兼容两种字段：user_id 或 sub(url 末段 userId)。
        if let Some(user_id) = value
            .get("user_id")
            .and_then(Value::as_str)
            .map(|item| item.trim().to_string())
            .filter(|item| !item.is_empty())
        {
            return Some(user_id);
        }

        let sub = value.get("sub").and_then(Value::as_str)?.trim();
        let user_id = sub.rsplit('/').next()?.trim();
        if user_id.is_empty() {
            return None;
        }
        Some(user_id.to_string())
    }
}

/// 提取 CustomField.DeveloperName：去掉命名空间前缀与 __c 后缀。
fn extract_custom_field_developer_name(field_api_name: &str) -> Option<String> {
    let trimmed = field_api_name.trim();
    if trimmed.is_empty() {
        return None;
    }
    let without_suffix = trimmed
        .strip_suffix("__c")
        .or_else(|| trimmed.strip_suffix("__pc"))
        .unwrap_or(trimmed);
    let segments = without_suffix.split("__").collect::<Vec<_>>();
    if segments.is_empty() {
        return None;
    }
    let developer_name = segments
        .last()
        .copied()
        .unwrap_or_default()
        .trim()
        .to_string();
    if developer_name.is_empty() {
        return None;
    }
    Some(developer_name)
}

/// SOQL 字符串字面量转义：单引号替换为 \\'
fn escape_soql_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

/// 构造 Salesforce REST API 绝对路径。
fn build_url(source: &SalesforceSource, path: &str) -> String {
    format!(
        "{}/services/data/{}/{}",
        source.instance_url.trim_end_matches('/'),
        source.api_version,
        path.trim_start_matches('/')
    )
}
