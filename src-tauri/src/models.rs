use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::HashMap;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesforceSource {
    pub id: String,
    pub name: String,
    pub instance_url: String,
    pub access_token: String,
    pub api_version: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SourceUpsertPayload {
    pub name: String,
    pub instance_url: String,
    pub access_token: String,
    pub api_version: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SalesforceObject {
    pub name: String,
    pub label: String,
    pub queryable: bool,
    pub createable: bool,
    pub updateable: bool,
    pub deletable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectField {
    pub name: String,
    pub label: String,
    pub data_type: String,
    pub nillable: bool,
    pub updateable: bool,
    pub createable: bool,
    pub metadata: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ObjectDescribe {
    pub name: String,
    pub label: String,
    pub fields: Vec<ObjectField>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QueryResult {
    pub total_size: usize,
    pub records: Vec<HashMap<String, Value>>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordMutationPayload {
    pub source_id: String,
    pub object_name: String,
    pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordUpdatePayload {
    pub record_id: String,
    pub values: HashMap<String, Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecordSavePayload {
    pub source_id: String,
    pub object_name: String,
    pub creates: Vec<HashMap<String, Value>>,
    pub updates: Vec<RecordUpdatePayload>,
}

#[derive(Debug)]
pub struct CachedObjects {
    pub payload: String,
    pub updated_at: i64,
}
