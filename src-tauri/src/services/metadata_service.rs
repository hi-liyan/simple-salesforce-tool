use crate::error::AppError;
use crate::models::{
    MetadataSnapshotUpsert, ObjectDdl, ObjectDescribe, ObjectSnapshot, SalesforceObject,
};
use crate::storage::{metadata_repo, Storage};

/// 元数据领域服务：统一负责结构化快照与读路径回退。
pub struct MetadataService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> MetadataService<'a> {
    /// 创建元数据服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 替换单对象快照。
    pub fn replace_object_snapshot(
        &self,
        payload: MetadataSnapshotUpsert,
    ) -> Result<(), AppError> {
        self.storage
            .write_tx(|tx| metadata_repo::replace_object_snapshot(tx, &payload))
    }

    /// 读取单对象快照。
    pub fn get_object_snapshot(
        &self,
        source_id: &str,
        object_name: &str,
    ) -> Result<Option<ObjectSnapshot>, AppError> {
        self.storage
            .read(|conn| metadata_repo::get_object_snapshot(conn, source_id, object_name))
    }

    /// 读取缓存对象列表。
    pub fn list_cached_objects(&self, source_id: &str) -> Result<Vec<SalesforceObject>, AppError> {
        self.storage
            .read(|conn| metadata_repo::list_cached_objects(conn, source_id))
    }

    /// 替换对象列表缓存。
    pub fn replace_cached_objects(
        &self,
        source_id: &str,
        objects: &[SalesforceObject],
        refresh_reason: &str,
    ) -> Result<(), AppError> {
        self.storage.write_tx(|tx| {
            metadata_repo::replace_source_objects(tx, source_id, objects, refresh_reason)
        })
    }

    /// 读取缓存 describe。
    pub fn get_cached_describe(
        &self,
        source_id: &str,
        object_name: &str,
    ) -> Result<Option<ObjectDescribe>, AppError> {
        let snapshot = self.get_object_snapshot(source_id, object_name)?;
        Ok(snapshot.map(|item| metadata_repo::snapshot_to_describe(&item)))
    }

    /// 读取缓存 DDL。
    pub fn get_cached_object_ddl(
        &self,
        source_id: &str,
        object_name: &str,
    ) -> Result<Option<ObjectDdl>, AppError> {
        let snapshot = self.get_object_snapshot(source_id, object_name)?;
        Ok(snapshot.and_then(|item| item.ddl))
    }

    /// 读取子关系名。
    pub fn resolve_cached_child_relationship_name(
        &self,
        source_id: &str,
        object_name: &str,
        field_name: &str,
    ) -> Result<Option<String>, AppError> {
        let snapshot = self.get_object_snapshot(source_id, object_name)?;
        Ok(snapshot.and_then(|item| {
            item.relations
                .into_iter()
                .find(|relation| relation.field_name == field_name)
                .map(|relation| relation.relationship_name)
        }))
    }

    /// 读取列可见性。
    pub fn read_column_visibility(
        &self,
        source_id: &str,
        object_name: &str,
    ) -> Result<std::collections::HashMap<String, bool>, AppError> {
        self.storage
            .read(|conn| metadata_repo::read_column_visibility(conn, source_id, object_name))
    }

    /// 写入列可见性。
    pub fn write_column_visibility(
        &self,
        source_id: &str,
        object_name: &str,
        visibility: &std::collections::HashMap<String, bool>,
    ) -> Result<(), AppError> {
        self.storage.write(|conn| {
            metadata_repo::write_column_visibility(conn, source_id, object_name, visibility)
        })
    }

    /// 将 provider describe 写入结构化快照。
    pub fn cache_describe(
        &self,
        source_id: &str,
        describe: &ObjectDescribe,
        refresh_reason: &str,
    ) -> Result<(), AppError> {
        let snapshot = MetadataSnapshotUpsert {
            source_id: source_id.to_string(),
            object_name: describe.name.clone(),
            schema_version: 1,
            snapshot_version: 1,
            identity_hash: format!("describe:{}", describe.fields.len()),
            refresh_reason: refresh_reason.to_string(),
            object: crate::models::SourceObjectRecord {
                source_id: source_id.to_string(),
                object_name: describe.name.clone(),
                label: describe.label.clone(),
                comment: None,
                queryable: true,
                createable: true,
                updateable: true,
                deletable: true,
                schema_version: 1,
                snapshot_version: 1,
                identity_hash: format!("describe:{}", describe.fields.len()),
                refresh_reason: refresh_reason.to_string(),
            },
            fields: describe
                .fields
                .iter()
                .enumerate()
                .map(|(index, field)| crate::models::SourceObjectFieldRecord {
                    source_id: source_id.to_string(),
                    object_name: describe.name.clone(),
                    field_name: field.name.clone(),
                    label: field.label.clone(),
                    data_type: field.data_type.clone(),
                    nillable: field.nillable,
                    updateable: field.updateable,
                    createable: field.createable,
                    metadata: field.metadata.clone(),
                    sort_order: index as i64 + 1,
                })
                .collect(),
            indexes: Vec::new(),
            constraints: Vec::new(),
            relations: describe
                .child_relationships
                .iter()
                .enumerate()
                .map(|(index, relation)| crate::models::SourceObjectRelationRecord {
                    source_id: source_id.to_string(),
                    object_name: describe.name.clone(),
                    relation_name: format!("{}::{}", relation.field, relation.child_sobject),
                    child_sobject: relation.child_sobject.clone(),
                    field_name: relation.field.clone(),
                    relationship_name: relation.relationship_name.clone(),
                    deprecated_and_hidden: relation.deprecated_and_hidden,
                    relation_type: "child_relationship".to_string(),
                    sort_order: index as i64 + 1,
                })
                .collect(),
            blobs: vec![crate::models::SourceMetadataBlobRecord {
                id: uuid::Uuid::new_v4().to_string(),
                source_id: source_id.to_string(),
                object_name: describe.name.clone(),
                blob_type: "describe".to_string(),
                payload_json: serde_json::to_string(describe)?,
                schema_version: 1,
                snapshot_version: 1,
            }],
            ddl: None,
        };
        self.replace_object_snapshot(snapshot)
    }

    /// 将 provider DDL 写回结构化快照。
    pub fn cache_object_ddl(
        &self,
        source_id: &str,
        object_name: &str,
        ddl: &ObjectDdl,
    ) -> Result<(), AppError> {
        let existing = self.get_object_snapshot(source_id, object_name)?;
        let Some(existing) = existing else {
            return Ok(());
        };
        self.replace_object_snapshot(MetadataSnapshotUpsert {
            source_id: source_id.to_string(),
            object_name: object_name.to_string(),
            schema_version: existing.object.schema_version,
            snapshot_version: existing.object.snapshot_version,
            identity_hash: existing.object.identity_hash.clone(),
            refresh_reason: existing.object.refresh_reason.clone(),
            object: existing.object,
            fields: existing.fields,
            indexes: Vec::new(),
            constraints: Vec::new(),
            relations: existing.relations,
            blobs: existing.blobs,
            ddl: Some(ddl.clone()),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::MetadataService;
    use crate::models::{
        MetadataSnapshotUpsert, SourceMetadataBlobRecord, SourceObjectFieldRecord,
        SourceObjectRecord,
    };
    use crate::storage::Storage;

    #[test]
    fn replace_object_snapshot_writes_structured_metadata_and_blob_history() {
        let storage = Storage::open_test().unwrap();
        storage
            .write(|conn| {
                conn.execute(
                    "INSERT INTO data_sources (
                        id, name, source_type, environment, color, sort_order, enabled, config_json,
                        secret_bundle_id, version, created_at, updated_at, archived_at
                    ) VALUES (?1, ?2, 'salesforce', 'default', '', 1, 1, '{}', NULL, 1, ?3, ?3, NULL)",
                    rusqlite::params!["sf-1", "SF", chrono::Utc::now().to_rfc3339()],
                )?;
                Ok(())
            })
            .unwrap();
        let service = MetadataService::new(&storage);

        service
            .replace_object_snapshot(MetadataSnapshotUpsert {
                source_id: "sf-1".into(),
                object_name: "Account".into(),
                schema_version: 3,
                snapshot_version: 7,
                identity_hash: "hash-v3".into(),
                refresh_reason: "manual-refresh".into(),
                object: SourceObjectRecord {
                    source_id: "sf-1".into(),
                    object_name: "Account".into(),
                    label: "客户".into(),
                    comment: None,
                    queryable: true,
                    createable: true,
                    updateable: true,
                    deletable: true,
                    schema_version: 3,
                    snapshot_version: 7,
                    identity_hash: "hash-v3".into(),
                    refresh_reason: "manual-refresh".into(),
                },
                fields: vec![SourceObjectFieldRecord {
                    source_id: "sf-1".into(),
                    object_name: "Account".into(),
                    field_name: "Name".into(),
                    label: "Name".into(),
                    data_type: "string".into(),
                    nillable: true,
                    updateable: true,
                    createable: true,
                    metadata: std::collections::HashMap::new(),
                    sort_order: 1,
                }],
                indexes: vec![],
                constraints: vec![],
                relations: vec![],
                blobs: vec![SourceMetadataBlobRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    source_id: "sf-1".into(),
                    object_name: "Account".into(),
                    blob_type: "describe".into(),
                    payload_json: "{\"name\":\"Account\"}".into(),
                    schema_version: 3,
                    snapshot_version: 7,
                }],
                ddl: None,
            })
            .unwrap();

        let snapshot = service.get_object_snapshot("sf-1", "Account").unwrap().unwrap();
        assert_eq!(snapshot.object.schema_version, 3);
        assert_eq!(snapshot.fields.len(), 1);
        assert_eq!(snapshot.blobs.len(), 1);
    }
}
