use reqwest::{Client, Method, StatusCode};
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{ObjectDescribe, ObjectField, QueryResult, SalesforceObject, SalesforceSource};

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
            fields: Vec<DescribeField>,
        }

        #[derive(Deserialize)]
        struct DescribeField {
            name: String,
            label: String,
            #[serde(rename = "type")]
            data_type: String,
            nillable: bool,
            updateable: bool,
            createable: bool,
        }

        let url = build_url(source, &format!("sobjects/{object_name}/describe"));
        let body: DescribeResponse = self.request_json(source, Method::GET, &url, None).await?;

        Ok(ObjectDescribe {
            name: body.name,
            label: body.label,
            fields: body
                .fields
                .into_iter()
                .map(|field| ObjectField {
                    name: field.name,
                    label: field.label,
                    data_type: field.data_type,
                    nillable: field.nillable,
                    updateable: field.updateable,
                    createable: field.createable,
                })
                .collect(),
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

