use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};
use serde_json::Value;
use std::collections::HashMap;

use crate::error::AppError;
use crate::models::{
    MetadataSnapshotUpsert, ObjectChildRelationship, ObjectDdl, ObjectDescribe, ObjectField,
    ObjectSnapshot, SalesforceObject, SourceMetadataBlobRecord, SourceObjectFieldRecord,
    SourceObjectRecord, SourceObjectRelationRecord,
};

/// 读取对象列表缓存。
pub fn list_cached_objects(connection: &Connection, source_id: &str) -> Result<Vec<SalesforceObject>, AppError> {
    let mut statement = connection.prepare(
        "SELECT object_name, label, comment, queryable, createable, updateable, deletable
         FROM source_objects
         WHERE source_id = ?1
         ORDER BY object_name ASC",
    )?;
    let rows = statement.query_map([source_id], |row| {
        Ok(SalesforceObject {
            name: row.get(0)?,
            label: row.get(1)?,
            comment: row.get(2)?,
            queryable: row.get::<_, i64>(3)? != 0,
            createable: row.get::<_, i64>(4)? != 0,
            updateable: row.get::<_, i64>(5)? != 0,
            deletable: row.get::<_, i64>(6)? != 0,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 替换数据源对象列表。
pub fn replace_source_objects(
    tx: &Transaction<'_>,
    source_id: &str,
    objects: &[SalesforceObject],
    refresh_reason: &str,
) -> Result<(), AppError> {
    tx.execute("DELETE FROM source_object_fields WHERE source_id = ?1", [source_id])?;
    tx.execute("DELETE FROM source_object_relations WHERE source_id = ?1", [source_id])?;
    tx.execute("DELETE FROM source_object_ddls WHERE source_id = ?1", [source_id])?;
    tx.execute("DELETE FROM source_metadata_blobs WHERE source_id = ?1", [source_id])?;
    tx.execute("DELETE FROM source_objects WHERE source_id = ?1", [source_id])?;
    for (index, object) in objects.iter().enumerate() {
        tx.execute(
            "INSERT INTO source_objects (
                source_id, object_name, label, comment, queryable, createable, updateable, deletable,
                schema_version, snapshot_version, identity_hash, refresh_reason, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 1, ?9, '', ?10, ?11)",
            params![
                source_id,
                object.name,
                object.label,
                object.comment,
                if object.queryable { 1 } else { 0 },
                if object.createable { 1 } else { 0 },
                if object.updateable { 1 } else { 0 },
                if object.deletable { 1 } else { 0 },
                index as i64 + 1,
                refresh_reason,
                Utc::now().to_rfc3339()
            ],
        )?;
    }
    Ok(())
}

/// 读取结构化对象快照。
pub fn get_object_snapshot(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
) -> Result<Option<ObjectSnapshot>, AppError> {
    let object = connection
        .query_row(
            "SELECT
                source_id, object_name, label, comment, queryable, createable, updateable, deletable,
                schema_version, snapshot_version, identity_hash, refresh_reason
             FROM source_objects
             WHERE source_id = ?1 AND object_name = ?2",
            params![source_id, object_name],
            |row| {
                Ok(SourceObjectRecord {
                    source_id: row.get(0)?,
                    object_name: row.get(1)?,
                    label: row.get(2)?,
                    comment: row.get(3)?,
                    queryable: row.get::<_, i64>(4)? != 0,
                    createable: row.get::<_, i64>(5)? != 0,
                    updateable: row.get::<_, i64>(6)? != 0,
                    deletable: row.get::<_, i64>(7)? != 0,
                    schema_version: row.get(8)?,
                    snapshot_version: row.get(9)?,
                    identity_hash: row.get(10)?,
                    refresh_reason: row.get(11)?,
                })
            },
        )
        .optional()?;
    let Some(object) = object else {
        return Ok(None);
    };

    let mut field_statement = connection.prepare(
        "SELECT field_name, label, data_type, nillable, updateable, createable, metadata_json, sort_order
         FROM source_object_fields
         WHERE source_id = ?1 AND object_name = ?2
         ORDER BY sort_order ASC, field_name ASC",
    )?;
    let field_rows = field_statement.query_map(params![source_id, object_name], |row| {
        let metadata_json: String = row.get(6)?;
        Ok(SourceObjectFieldRecord {
            source_id: source_id.to_string(),
            object_name: object_name.to_string(),
            field_name: row.get(0)?,
            label: row.get(1)?,
            data_type: row.get(2)?,
            nillable: row.get::<_, i64>(3)? != 0,
            updateable: row.get::<_, i64>(4)? != 0,
            createable: row.get::<_, i64>(5)? != 0,
            metadata: serde_json::from_str(&metadata_json).unwrap_or_else(|_| HashMap::new()),
            sort_order: row.get(7)?,
        })
    })?;

    let mut relation_statement = connection.prepare(
        "SELECT relation_name, child_sobject, field_name, relationship_name, deprecated_and_hidden, relation_type, sort_order
         FROM source_object_relations
         WHERE source_id = ?1 AND object_name = ?2
         ORDER BY sort_order ASC, relation_name ASC",
    )?;
    let relation_rows = relation_statement.query_map(params![source_id, object_name], |row| {
        Ok(SourceObjectRelationRecord {
            source_id: source_id.to_string(),
            object_name: object_name.to_string(),
            relation_name: row.get(0)?,
            child_sobject: row.get(1)?,
            field_name: row.get(2)?,
            relationship_name: row.get(3)?,
            deprecated_and_hidden: row.get::<_, i64>(4)? != 0,
            relation_type: row.get(5)?,
            sort_order: row.get(6)?,
        })
    })?;

    let mut blob_statement = connection.prepare(
        "SELECT id, blob_type, payload_json, schema_version, snapshot_version
         FROM source_metadata_blobs
         WHERE source_id = ?1 AND object_name = ?2
         ORDER BY created_at DESC, id DESC",
    )?;
    let blob_rows = blob_statement.query_map(params![source_id, object_name], |row| {
        Ok(SourceMetadataBlobRecord {
            id: row.get(0)?,
            source_id: source_id.to_string(),
            object_name: object_name.to_string(),
            blob_type: row.get(1)?,
            payload_json: row.get(2)?,
            schema_version: row.get(3)?,
            snapshot_version: row.get(4)?,
        })
    })?;

    let ddl = connection
        .query_row(
            "SELECT create_table_ddl, index_ddls_json, constraint_ddls_json
             FROM source_object_ddls
             WHERE source_id = ?1 AND object_name = ?2",
            params![source_id, object_name],
            |row| {
                let index_json: String = row.get(1)?;
                let constraint_json: String = row.get(2)?;
                Ok(ObjectDdl {
                    create_table_ddl: row.get(0)?,
                    index_ddls: serde_json::from_str(&index_json).unwrap_or_default(),
                    constraint_ddls: serde_json::from_str(&constraint_json).unwrap_or_default(),
                })
            },
        )
        .optional()?;

    Ok(Some(ObjectSnapshot {
        object,
        fields: field_rows.collect::<Result<Vec<_>, _>>()?,
        relations: relation_rows.collect::<Result<Vec<_>, _>>()?,
        blobs: blob_rows.collect::<Result<Vec<_>, _>>()?,
        ddl,
    }))
}

/// 替换单对象结构化快照。
pub fn replace_object_snapshot(
    tx: &Transaction<'_>,
    payload: &MetadataSnapshotUpsert,
) -> Result<(), AppError> {
    tx.execute(
        "DELETE FROM source_object_fields WHERE source_id = ?1 AND object_name = ?2",
        params![payload.source_id, payload.object_name],
    )?;
    tx.execute(
        "DELETE FROM source_object_relations WHERE source_id = ?1 AND object_name = ?2",
        params![payload.source_id, payload.object_name],
    )?;
    tx.execute(
        "DELETE FROM source_metadata_blobs WHERE source_id = ?1 AND object_name = ?2",
        params![payload.source_id, payload.object_name],
    )?;
    tx.execute(
        "DELETE FROM source_object_ddls WHERE source_id = ?1 AND object_name = ?2",
        params![payload.source_id, payload.object_name],
    )?;
    tx.execute(
        "INSERT INTO source_objects (
            source_id, object_name, label, comment, queryable, createable, updateable, deletable,
            schema_version, snapshot_version, identity_hash, refresh_reason, updated_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13)
         ON CONFLICT(source_id, object_name) DO UPDATE SET
            label = excluded.label,
            comment = excluded.comment,
            queryable = excluded.queryable,
            createable = excluded.createable,
            updateable = excluded.updateable,
            deletable = excluded.deletable,
            schema_version = excluded.schema_version,
            snapshot_version = excluded.snapshot_version,
            identity_hash = excluded.identity_hash,
            refresh_reason = excluded.refresh_reason,
            updated_at = excluded.updated_at",
        params![
            payload.source_id,
            payload.object_name,
            payload.object.label,
            payload.object.comment,
            if payload.object.queryable { 1 } else { 0 },
            if payload.object.createable { 1 } else { 0 },
            if payload.object.updateable { 1 } else { 0 },
            if payload.object.deletable { 1 } else { 0 },
            payload.schema_version,
            payload.snapshot_version,
            payload.identity_hash,
            payload.refresh_reason,
            Utc::now().to_rfc3339()
        ],
    )?;

    for field in &payload.fields {
        tx.execute(
            "INSERT INTO source_object_fields (
                source_id, object_name, field_name, label, data_type, nillable,
                updateable, createable, metadata_json, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                payload.source_id,
                payload.object_name,
                field.field_name,
                field.label,
                field.data_type,
                if field.nillable { 1 } else { 0 },
                if field.updateable { 1 } else { 0 },
                if field.createable { 1 } else { 0 },
                serde_json::to_string(&field.metadata)?,
                field.sort_order
            ],
        )?;
    }

    for relation in &payload.relations {
        tx.execute(
            "INSERT INTO source_object_relations (
                source_id, object_name, relation_name, child_sobject, field_name,
                relationship_name, deprecated_and_hidden, relation_type, sort_order
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                payload.source_id,
                payload.object_name,
                relation.relation_name,
                relation.child_sobject,
                relation.field_name,
                relation.relationship_name,
                if relation.deprecated_and_hidden { 1 } else { 0 },
                relation.relation_type,
                relation.sort_order
            ],
        )?;
    }

    for blob in &payload.blobs {
        tx.execute(
            "INSERT INTO source_metadata_blobs (
                id, source_id, object_name, blob_type, payload_json, schema_version, snapshot_version, created_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
            params![
                blob.id,
                payload.source_id,
                payload.object_name,
                blob.blob_type,
                blob.payload_json,
                payload.schema_version,
                payload.snapshot_version,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    if let Some(ddl) = &payload.ddl {
        tx.execute(
            "INSERT INTO source_object_ddls (
                source_id, object_name, create_table_ddl, index_ddls_json, constraint_ddls_json, updated_at
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(source_id, object_name) DO UPDATE SET
                create_table_ddl = excluded.create_table_ddl,
                index_ddls_json = excluded.index_ddls_json,
                constraint_ddls_json = excluded.constraint_ddls_json,
                updated_at = excluded.updated_at",
            params![
                payload.source_id,
                payload.object_name,
                ddl.create_table_ddl,
                serde_json::to_string(&ddl.index_ddls)?,
                serde_json::to_string(&ddl.constraint_ddls)?,
                Utc::now().to_rfc3339()
            ],
        )?;
    }

    Ok(())
}

/// 读取列可见性。
pub fn read_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
) -> Result<HashMap<String, bool>, AppError> {
    let raw = connection
        .query_row(
            "SELECT payload_json FROM query_column_visibility WHERE source_id = ?1 AND object_name = ?2",
            params![source_id, object_name],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(raw
        .and_then(|value| serde_json::from_str(&value).ok())
        .unwrap_or_default())
}

/// 写入列可见性。
pub fn write_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
    visibility: &HashMap<String, bool>,
) -> Result<(), AppError> {
    connection.execute(
        "INSERT INTO query_column_visibility (source_id, object_name, payload_json, updated_at)
         VALUES (?1, ?2, ?3, ?4)
         ON CONFLICT(source_id, object_name) DO UPDATE SET
           payload_json = excluded.payload_json,
           updated_at = excluded.updated_at",
        params![
            source_id,
            object_name,
            serde_json::to_string(visibility)?,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

/// 将结构化快照恢复为 `ObjectDescribe`。
pub fn snapshot_to_describe(snapshot: &ObjectSnapshot) -> ObjectDescribe {
    ObjectDescribe {
        name: snapshot.object.object_name.clone(),
        label: snapshot.object.label.clone(),
        fields: snapshot
            .fields
            .iter()
            .map(|field| ObjectField {
                name: field.field_name.clone(),
                label: field.label.clone(),
                data_type: field.data_type.clone(),
                nillable: field.nillable,
                updateable: field.updateable,
                createable: field.createable,
                metadata: field.metadata.clone(),
            })
            .collect(),
        child_relationships: snapshot
            .relations
            .iter()
            .filter(|relation| relation.relation_type == "child_relationship")
            .map(|relation| ObjectChildRelationship {
                child_sobject: relation.child_sobject.clone(),
                field: relation.field_name.clone(),
                relationship_name: relation.relationship_name.clone(),
                deprecated_and_hidden: relation.deprecated_and_hidden,
            })
            .collect(),
    }
}

/// 尝试从 blob 中读取 describe JSON。
pub fn extract_describe_blob(snapshot: &ObjectSnapshot) -> Option<Value> {
    snapshot
        .blobs
        .iter()
        .find(|blob| blob.blob_type == "describe")
        .and_then(|blob| serde_json::from_str(&blob.payload_json).ok())
}
