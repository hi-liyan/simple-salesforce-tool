use reqwest::{Client, Method, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    ObjectDescribe, ObjectField, QueryResult, RecordUpdatePayload, SalesforceObject, SalesforceSource,
};

/// Salesforce API 客户端，负责所有外部 HTTP 通讯。
#[derive(Clone)]
pub struct SalesforceClient {
    http: Client,
}

impl SalesforceClient {
    pub fn new() -> Self {
        let http = Client::builder()
            .user_agent("simple-salesforce-tool/0.1.0")
            .build()
            .expect("failed to create reqwest client");
        Self { http }
    }

    pub async fn list_objects(&self, source: &SalesforceSource) -> Result<Vec<SalesforceObject>, AppError> {
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
                queryable: item.queryable,
                createable: item.createable,
                updateable: item.updateable,
                deletable: item.deletable,
            })
            .collect())
    }

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
        })
    }

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
            .request_json(source, Method::POST, &url, Some(serde_json::to_value(values)?))
            .await?;

        if response.success {
            Ok(response.id)
        } else {
            Err(AppError::Biz("Salesforce 返回创建失败。".to_string()))
        }
    }

    pub async fn update_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
        values: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let url = build_url(source, &format!("sobjects/{object_name}/{record_id}"));
        self.request_unit(source, Method::PATCH, &url, Some(serde_json::to_value(values)?))
            .await
    }

    pub async fn delete_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
    ) -> Result<(), AppError> {
        let url = build_url(source, &format!("sobjects/{object_name}/{record_id}"));
        self.request_unit(source, Method::DELETE, &url, None).await
    }

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

        for (index, values) in creates.into_iter().enumerate() {
            composite_request.push(CompositeRequestItem {
                method: "POST".to_string(),
                url: format!("/services/data/{}/sobjects/{object_name}", source.api_version),
                reference_id: format!("create_{index}"),
                body: serde_json::to_value(values)?,
            });
        }

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
            .request_json(source, Method::POST, &url, Some(serde_json::to_value(payload)?))
            .await?;

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
            return Err(AppError::Http(format!("Salesforce 调用失败，状态码 {status}: {text}")));
        }

        Ok(response.json::<T>().await?)
    }

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
        Err(AppError::Http(format!("Salesforce 调用失败，状态码 {status}: {text}")))
    }
}

fn build_url(source: &SalesforceSource, path: &str) -> String {
    format!(
        "{}/services/data/{}/{}",
        source.instance_url.trim_end_matches('/'),
        source.api_version,
        path.trim_start_matches('/')
    )
}
