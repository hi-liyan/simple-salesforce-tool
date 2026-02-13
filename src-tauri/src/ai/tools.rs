use rig::completion::ToolDefinition;
use rig::tool::Tool;
use serde::Deserialize;
use serde_json::{json, Value};
use tauri::Manager;

use crate::app_state::AppState;
use crate::commands;

/// AI 工具统一错误类型：将内部错误文本化后回传给模型。
#[derive(Debug, thiserror::Error)]
#[error("{message}")]
pub struct AiToolError {
    /// 错误消息文本。
    pub message: String,
}

impl AiToolError {
    /// 快速构建错误对象。
    fn new(message: impl Into<String>) -> Self {
        Self {
            message: message.into(),
        }
    }
}

/// 参数：按关键词检索对象列表。
#[derive(Debug, Deserialize)]
pub struct FindObjectsArgs {
    pub keyword: String,
    pub limit: Option<u64>,
}

/// 参数：获取对象元数据摘要。
#[derive(Debug, Deserialize)]
pub struct GetObjectMetadataArgs {
    pub object_name: String,
    pub include_reference_parents: Option<bool>,
}

/// 参数：按关键词搜索字段。
#[derive(Debug, Deserialize)]
pub struct SearchFieldsArgs {
    pub object_name: String,
    pub keyword: String,
    pub limit: Option<u64>,
}

/// 参数：读取单字段元数据。
#[derive(Debug, Deserialize)]
pub struct GetFieldMetadataArgs {
    pub object_name: String,
    pub field_name: String,
}

/// 参数：获取对象关系图。
#[derive(Debug, Deserialize)]
pub struct GetRelationshipGraphArgs {
    pub object_name: String,
}

/// 工具：搜索对象。
#[derive(Clone)]
pub struct FindObjectsTool {
    pub app: tauri::AppHandle,
    pub source_id: String,
}

impl Tool for FindObjectsTool {
    const NAME: &'static str = "find_salesforce_objects";
    type Error = AiToolError;
    type Args = FindObjectsArgs;
    type Output = Value;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "根据对象 API 名或标签关键词检索 Salesforce 可查询对象。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "keyword": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 50 }
                },
                "required": ["keyword"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let state = self.app.state::<AppState>();
        let objects = commands::list_objects(self.app.clone(), state, self.source_id.clone())
            .await
            .map_err(AiToolError::new)?;
        let keyword = args.keyword.trim().to_lowercase();
        let limit = args.limit.unwrap_or(10).clamp(1, 50) as usize;
        let matches = objects
            .into_iter()
            .filter(|item| item.queryable)
            .filter(|item| {
                item.name.to_lowercase().contains(&keyword)
                    || item.label.to_lowercase().contains(&keyword)
            })
            .take(limit)
            .map(|item| {
                json!({
                    "name": item.name,
                    "label": item.label,
                    "queryable": item.queryable
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "ok": true, "matches": matches }))
    }
}

/// 工具：获取对象元数据。
#[derive(Clone)]
pub struct GetObjectMetadataTool {
    pub app: tauri::AppHandle,
    pub source_id: String,
}

impl Tool for GetObjectMetadataTool {
    const NAME: &'static str = "get_salesforce_object_metadata";
    type Error = AiToolError;
    type Args = GetObjectMetadataArgs;
    type Output = Value;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "读取对象字段及关系元数据，用于 SOQL 生成。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "object_name": { "type": "string" },
                    "include_reference_parents": { "type": "boolean" }
                },
                "required": ["object_name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let state = self.app.state::<AppState>();
        let describe = commands::describe_object(
            self.app.clone(),
            state,
            self.source_id.clone(),
            args.object_name.trim().to_string(),
        )
        .await
        .map_err(AiToolError::new)?;
        let fields = describe
            .fields
            .iter()
            .map(|item| {
                json!({
                    "name": item.name,
                    "label": item.label,
                    "type": item.data_type,
                    "metadata": item.metadata
                })
            })
            .collect::<Vec<_>>();
        let children = describe
            .child_relationships
            .iter()
            .map(|item| {
                json!({
                    "childSobject": item.child_sobject,
                    "field": item.field,
                    "relationshipName": item.relationship_name,
                    "deprecatedAndHidden": item.deprecated_and_hidden
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "ok": true,
            "objectName": describe.name,
            "objectLabel": describe.label,
            "fields": fields,
            "childRelationships": children,
            "includeReferenceParents": args.include_reference_parents.unwrap_or(true)
        }))
    }
}

/// 工具：字段搜索。
#[derive(Clone)]
pub struct SearchFieldsTool {
    pub app: tauri::AppHandle,
    pub source_id: String,
}

impl Tool for SearchFieldsTool {
    const NAME: &'static str = "search_salesforce_object_fields";
    type Error = AiToolError;
    type Args = SearchFieldsArgs;
    type Output = Value;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "按关键词搜索某个对象字段。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "object_name": { "type": "string" },
                    "keyword": { "type": "string" },
                    "limit": { "type": "integer", "minimum": 1, "maximum": 80 }
                },
                "required": ["object_name", "keyword"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let state = self.app.state::<AppState>();
        let describe = commands::describe_object(
            self.app.clone(),
            state,
            self.source_id.clone(),
            args.object_name.trim().to_string(),
        )
        .await
        .map_err(AiToolError::new)?;
        let keyword = args.keyword.trim().to_lowercase();
        let limit = args.limit.unwrap_or(20).clamp(1, 80) as usize;
        let matches = describe
            .fields
            .iter()
            .filter(|item| {
                item.name.to_lowercase().contains(&keyword)
                    || item.label.to_lowercase().contains(&keyword)
            })
            .take(limit)
            .map(|item| {
                json!({
                    "name": item.name,
                    "label": item.label,
                    "type": item.data_type
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({ "ok": true, "matches": matches }))
    }
}

/// 工具：单字段元数据。
#[derive(Clone)]
pub struct GetFieldMetadataTool {
    pub app: tauri::AppHandle,
    pub source_id: String,
}

impl Tool for GetFieldMetadataTool {
    const NAME: &'static str = "get_salesforce_field_metadata";
    type Error = AiToolError;
    type Args = GetFieldMetadataArgs;
    type Output = Value;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "读取某个字段的完整元数据。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "object_name": { "type": "string" },
                    "field_name": { "type": "string" }
                },
                "required": ["object_name", "field_name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let state = self.app.state::<AppState>();
        let describe = commands::describe_object(
            self.app.clone(),
            state,
            self.source_id.clone(),
            args.object_name.trim().to_string(),
        )
        .await
        .map_err(AiToolError::new)?;
        let field = describe
            .fields
            .iter()
            .find(|item| item.name.eq_ignore_ascii_case(args.field_name.trim()))
            .map(|item| {
                json!({
                    "name": item.name,
                    "label": item.label,
                    "type": item.data_type,
                    "nillable": item.nillable,
                    "createable": item.createable,
                    "updateable": item.updateable,
                    "metadata": item.metadata
                })
            });
        Ok(json!({ "ok": field.is_some(), "field": field }))
    }
}

/// 工具：对象关系图。
#[derive(Clone)]
pub struct GetRelationshipGraphTool {
    pub app: tauri::AppHandle,
    pub source_id: String,
}

impl Tool for GetRelationshipGraphTool {
    const NAME: &'static str = "get_salesforce_object_relationship_graph";
    type Error = AiToolError;
    type Args = GetRelationshipGraphArgs;
    type Output = Value;

    async fn definition(&self, _prompt: String) -> ToolDefinition {
        ToolDefinition {
            name: Self::NAME.to_string(),
            description: "读取对象父子关系图，支持子查询和父关系推导。".to_string(),
            parameters: json!({
                "type": "object",
                "properties": {
                    "object_name": { "type": "string" }
                },
                "required": ["object_name"]
            }),
        }
    }

    async fn call(&self, args: Self::Args) -> Result<Self::Output, Self::Error> {
        let state = self.app.state::<AppState>();
        let describe = commands::describe_object(
            self.app.clone(),
            state,
            self.source_id.clone(),
            args.object_name.trim().to_string(),
        )
        .await
        .map_err(AiToolError::new)?;
        let parent_edges = describe
            .fields
            .iter()
            .filter_map(|item| {
                let refs = item
                    .metadata
                    .get("referenceTo")
                    .and_then(|v| v.as_array())
                    .cloned()?;
                Some(json!({
                    "fieldName": item.name,
                    "referenceTo": refs,
                    "relationshipName": item.metadata.get("relationshipName"),
                    "childRelationshipName": item.metadata.get("childRelationshipName")
                }))
            })
            .collect::<Vec<_>>();
        let child_edges = describe
            .child_relationships
            .iter()
            .map(|item| {
                json!({
                    "childObject": item.child_sobject,
                    "fieldName": item.field,
                    "relationshipName": item.relationship_name
                })
            })
            .collect::<Vec<_>>();
        Ok(json!({
            "ok": true,
            "objectName": describe.name,
            "parentEdges": parent_edges,
            "childEdges": child_edges
        }))
    }
}

