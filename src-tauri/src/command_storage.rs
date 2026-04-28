use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::Value;

use crate::error::AppError;
use crate::models::{
    ObjectDescribe, SalesforceObject, SalesforceSource, SourceSecretView, SourceUpsertPayload,
    SystemLogPage, TerminalCommandGroup, TerminalCommandItem, TerminalCommandReorderPayload,
    TerminalCommandUpsertPayload, WorkspaceSnapshotDto,
};
use crate::storage::{
    automation_repo, config_repo, log_repo, metadata_repo, secret_repo, source_repo, workspace_repo,
};

/// 读取应用配置项，不存在时返回 None。
pub fn read_app_setting(connection: &Connection, key: &str) -> Result<Option<String>, AppError> {
    config_repo::read_app_setting(connection, key)
}

/// 写入应用配置项。
pub fn write_app_setting(connection: &Connection, key: &str, value: &str) -> Result<(), AppError> {
    config_repo::write_app_setting(connection, key, value)
}

/// 删除应用配置项。
pub fn delete_app_setting(connection: &Connection, key: &str) -> Result<(), AppError> {
    config_repo::delete_app_setting(connection, key)
}

/// 列出数据源：公共列表不返回 secret 明文。
pub fn list_sources(connection: &Connection) -> Result<Vec<SalesforceSource>, AppError> {
    let records = source_repo::list_sources(connection)?;
    Ok(records
        .into_iter()
        .map(|record| source_repo::into_public_source(record, String::new()))
        .collect())
}

/// 读取运行时数据源：返回 provider 真正需要的 secret 明文。
pub fn get_source(connection: &Connection, id: &str) -> Result<SalesforceSource, AppError> {
    let record = source_repo::get_source(connection, id)?;
    let is_mysql = record.source_type.eq_ignore_ascii_case("mysql");
    let access_token =
        read_runtime_source_secret(connection, &record, "accessToken")?.unwrap_or_default();
    let password = if is_mysql {
        read_runtime_source_secret(connection, &record, "password")?
    } else {
        None
    };
    let mut source = source_repo::into_public_source(record, access_token);
    if let Some(password) = password {
        if let Some(config) = source.config_json.as_object_mut() {
            // 行内注释：MySQL provider 从 configJson 构建连接串，运行时需注入 secrets 域密码。
            config.insert("password".to_string(), Value::String(password));
        }
    }
    Ok(source)
}

/// 新建数据源。
pub fn create_source(
    connection: &Connection,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let tx = connection.unchecked_transaction()?;
    let source_id = uuid::Uuid::new_v4().to_string();
    let secret_bundle_id = persist_source_secrets(&tx, &source_id, None, &payload)?;
    let record =
        source_repo::insert_source(&tx, &source_id, &payload, secret_bundle_id.as_deref())?;
    tx.commit()?;
    Ok(source_repo::into_public_source(record, String::new()))
}

/// 更新数据源。
pub fn update_source(
    connection: &Connection,
    id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let tx = connection.unchecked_transaction()?;
    let current = source_repo::get_source(&tx, id)?;
    let secret_bundle_id =
        persist_source_secrets(&tx, id, current.secret_bundle_id.as_deref(), &payload)?;
    let record = source_repo::update_source(&tx, id, &payload, secret_bundle_id.as_deref())?;
    tx.commit()?;
    Ok(source_repo::into_public_source(record, String::new()))
}

/// 指定 ID 执行 upsert：供 CLI 数据源同步使用。
pub fn upsert_source_with_id(
    connection: &Connection,
    source_id: &str,
    payload: SourceUpsertPayload,
) -> Result<SalesforceSource, AppError> {
    let tx = connection.unchecked_transaction()?;
    let current = source_repo::get_source(&tx, source_id).ok();
    let secret_bundle_id = persist_source_secrets(
        &tx,
        source_id,
        current
            .as_ref()
            .and_then(|item| item.secret_bundle_id.as_deref()),
        &payload,
    )?;
    let record =
        source_repo::upsert_source_with_id(&tx, source_id, &payload, secret_bundle_id.as_deref())?;
    tx.commit()?;
    Ok(source_repo::into_public_source(record, String::new()))
}

/// 调整数据源顺序。
pub fn reorder_sources(
    connection: &Connection,
    ordered_ids: &[String],
) -> Result<Vec<SalesforceSource>, AppError> {
    source_repo::reorder_sources(connection, ordered_ids)?;
    list_sources(connection)
}

/// 清理未保留的 CLI 数据源。
pub fn prune_cli_sources(connection: &Connection, keep_ids: &[String]) -> Result<(), AppError> {
    source_repo::prune_cli_sources(connection, keep_ids)
}

/// 删除数据源。
pub fn delete_source(connection: &Connection, id: &str) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    source_repo::delete_source(&tx, id)?;
    tx.commit()?;
    Ok(())
}

/// 读取显式 secret 明文视图。
pub fn get_source_secret_view(
    connection: &Connection,
    source_id: &str,
) -> Result<SourceSecretView, AppError> {
    let tx = connection.unchecked_transaction()?;
    let record = source_repo::get_source(&tx, source_id)?;
    let view = SourceSecretView {
        source_id: source_id.to_string(),
        access_token: read_runtime_source_secret(&tx, &record, "accessToken")?.unwrap_or_default(),
        password: read_runtime_source_secret(&tx, &record, "password")?.unwrap_or_default(),
    };
    if let Some(bundle_id) = &record.secret_bundle_id {
        secret_repo::insert_secret_access_audit(
            &tx,
            bundle_id,
            None,
            "read_plaintext_for_edit",
            "settings.edit-source",
            true,
            "允许设置页显式读取 secret 明文",
            "",
            "{}",
        )?;
    }
    tx.commit()?;
    Ok(view)
}

/// 读取列可见性。
pub fn read_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
) -> Result<Option<std::collections::HashMap<String, bool>>, AppError> {
    let visibility = metadata_repo::read_column_visibility(connection, source_id, object_name)?;
    if visibility.is_empty() {
        return Ok(None);
    }
    Ok(Some(visibility))
}

/// 写入列可见性。
pub fn write_column_visibility(
    connection: &Connection,
    source_id: &str,
    object_name: &str,
    visibility: &std::collections::HashMap<String, bool>,
) -> Result<(), AppError> {
    metadata_repo::write_column_visibility(connection, source_id, object_name, visibility)
}

/// 读取对象列表缓存。
pub fn read_object_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<Option<Vec<SalesforceObject>>, AppError> {
    let objects = metadata_repo::list_cached_objects(connection, source_id)?;
    if objects.is_empty() {
        return Ok(None);
    }
    Ok(Some(objects))
}

/// 写入对象列表缓存。
pub fn write_object_cache(
    connection: &Connection,
    source_id: &str,
    objects: &[SalesforceObject],
) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    metadata_repo::replace_source_objects(&tx, source_id, objects, "object-list-cache")?;
    tx.commit()?;
    Ok(())
}

/// 读取对象级元数据缓存。
pub fn read_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
    metadata_type: &str,
    object_name: Option<&str>,
) -> Result<Option<String>, AppError> {
    let normalized_object_name = object_name.unwrap_or_default();
    if metadata_type == "object_describe" {
        if let Some(snapshot) =
            metadata_repo::get_object_snapshot(connection, source_id, normalized_object_name)?
        {
            if let Some(blob) = snapshot
                .blobs
                .iter()
                .find(|item| item.blob_type == "object_describe")
            {
                return Ok(Some(blob.payload_json.clone()));
            }
            if snapshot.fields.is_empty() {
                // 行内注释：只有对象目录没有字段时不算 describe 缓存命中，应让调用方回源拉取字段元数据。
                return Ok(None);
            }
            return Ok(Some(serde_json::to_string(
                &metadata_repo::snapshot_to_describe(&snapshot),
            )?));
        }
        return Ok(None);
    }
    if metadata_type == "object_ddl" {
        if let Some(snapshot) =
            metadata_repo::get_object_snapshot(connection, source_id, normalized_object_name)?
        {
            if let Some(ddl) = snapshot.ddl {
                return Ok(Some(serde_json::to_string(&ddl)?));
            }
        }
        return Ok(None);
    }
    connection
        .query_row(
            "SELECT payload_json
             FROM source_metadata_blobs
             WHERE source_id = ?1 AND object_name = ?2 AND blob_type = ?3
             ORDER BY created_at DESC, id DESC
             LIMIT 1",
            params![source_id, normalized_object_name, metadata_type],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

/// 写入对象级元数据缓存。
pub fn write_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
    metadata_type: &str,
    object_name: Option<&str>,
    payload: &str,
) -> Result<(), AppError> {
    let normalized_object_name = object_name.unwrap_or_default();
    if metadata_type == "object_describe" {
        if let Ok(describe) = serde_json::from_str::<ObjectDescribe>(payload) {
            let tx = connection.unchecked_transaction()?;
            let existing =
                metadata_repo::get_object_snapshot(&tx, source_id, normalized_object_name)?;
            let object = existing
                .as_ref()
                .map(|snapshot| snapshot.object.clone())
                .unwrap_or(crate::models::SourceObjectRecord {
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
                    refresh_reason: "describe-cache".to_string(),
                });
            let payload = crate::models::MetadataSnapshotUpsert {
                source_id: source_id.to_string(),
                object_name: normalized_object_name.to_string(),
                schema_version: object.schema_version,
                snapshot_version: object.snapshot_version,
                identity_hash: object.identity_hash.clone(),
                refresh_reason: "describe-cache".to_string(),
                object,
                fields: describe
                    .fields
                    .iter()
                    .enumerate()
                    .map(|(index, field)| crate::models::SourceObjectFieldRecord {
                        source_id: source_id.to_string(),
                        object_name: normalized_object_name.to_string(),
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
                    .map(
                        |(index, relation)| crate::models::SourceObjectRelationRecord {
                            source_id: source_id.to_string(),
                            object_name: normalized_object_name.to_string(),
                            relation_name: format!(
                                "{}::{}",
                                relation.field, relation.child_sobject
                            ),
                            child_sobject: relation.child_sobject.clone(),
                            field_name: relation.field.clone(),
                            relationship_name: relation.relationship_name.clone(),
                            deprecated_and_hidden: relation.deprecated_and_hidden,
                            relation_type: "child_relationship".to_string(),
                            sort_order: index as i64 + 1,
                        },
                    )
                    .collect(),
                blobs: vec![crate::models::SourceMetadataBlobRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    source_id: source_id.to_string(),
                    object_name: normalized_object_name.to_string(),
                    blob_type: "object_describe".to_string(),
                    payload_json: payload.to_string(),
                    schema_version: 1,
                    snapshot_version: 1,
                }],
                ddl: existing.and_then(|snapshot| snapshot.ddl),
            };
            metadata_repo::replace_object_snapshot(&tx, &payload)?;
            tx.commit()?;
            return Ok(());
        }
    }
    if metadata_type == "object_ddl" {
        if let Ok(ddl) = serde_json::from_str::<crate::models::ObjectDdl>(payload) {
            let tx = connection.unchecked_transaction()?;
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
                    source_id,
                    normalized_object_name,
                    ddl.create_table_ddl,
                    serde_json::to_string(&ddl.index_ddls)?,
                    serde_json::to_string(&ddl.constraint_ddls)?,
                    Utc::now().to_rfc3339()
                ],
            )?;
            tx.commit()?;
            return Ok(());
        }
    }
    connection.execute(
        "DELETE FROM source_metadata_blobs WHERE source_id = ?1 AND object_name = ?2 AND blob_type = ?3",
        params![source_id, normalized_object_name, metadata_type],
    )?;
    connection.execute(
        "INSERT INTO source_metadata_blobs (
            id, source_id, object_name, blob_type, payload_json, schema_version, snapshot_version, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, 1, 1, ?6)",
        params![
            uuid::Uuid::new_v4().to_string(),
            source_id,
            normalized_object_name,
            metadata_type,
            payload,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

/// 清理指定数据源的对象级元数据缓存。
pub fn clear_source_metadata_cache(
    connection: &Connection,
    source_id: &str,
) -> Result<(), AppError> {
    connection.execute(
        "DELETE FROM source_object_fields WHERE source_id = ?1",
        [source_id],
    )?;
    connection.execute(
        "DELETE FROM source_object_relations WHERE source_id = ?1",
        [source_id],
    )?;
    connection.execute(
        "DELETE FROM source_object_ddls WHERE source_id = ?1",
        [source_id],
    )?;
    connection.execute(
        "DELETE FROM source_metadata_blobs WHERE source_id = ?1",
        [source_id],
    )?;
    Ok(())
}

/// 写入系统日志。
pub fn insert_system_log(
    connection: &Connection,
    level: &str,
    category: &str,
    action: &str,
    source_id: Option<&str>,
    target: Option<&str>,
    success: bool,
    message: &str,
    detail: Option<&str>,
) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    log_repo::insert_system_log(
        &tx,
        &log_repo::SystemLogRecord {
            created_at: Utc::now().to_rfc3339(),
            level: level.to_string(),
            category: category.to_string(),
            action: action.to_string(),
            source_id: source_id.map(ToOwned::to_owned),
            workspace_tab_id: None,
            target: target.map(ToOwned::to_owned),
            success,
            message: message.to_string(),
            detail_text: detail.unwrap_or_default().to_string(),
            detail_json: "{}".to_string(),
            correlation_id: String::new(),
            retention_policy: "standard".to_string(),
            expires_at: None,
        },
    )?;
    tx.commit()?;
    Ok(())
}

/// 分页列出系统日志。
pub fn list_system_logs(
    connection: &Connection,
    page: i64,
    page_size: i64,
) -> Result<SystemLogPage, AppError> {
    log_repo::list_system_logs(connection, page, page_size)
}

/// 列出终端命令组。
pub fn list_terminal_command_groups(
    connection: &Connection,
) -> Result<Vec<TerminalCommandGroup>, AppError> {
    automation_repo::list_terminal_command_groups(connection)
}

/// 创建终端命令组。
pub fn create_terminal_command_group(
    connection: &Connection,
    name: &str,
) -> Result<TerminalCommandGroup, AppError> {
    automation_repo::create_terminal_command_group(connection, name)
}

/// 更新终端命令组。
pub fn update_terminal_command_group(
    connection: &Connection,
    group_id: &str,
    name: &str,
) -> Result<TerminalCommandGroup, AppError> {
    automation_repo::update_terminal_command_group(connection, group_id, name)
}

/// 创建终端命令。
pub fn create_terminal_command(
    connection: &Connection,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    automation_repo::create_terminal_command(connection, payload)
}

/// 更新终端命令。
pub fn update_terminal_command(
    connection: &Connection,
    command_id: &str,
    payload: &TerminalCommandUpsertPayload,
) -> Result<TerminalCommandItem, AppError> {
    automation_repo::update_terminal_command(connection, command_id, payload)
}

/// 删除终端命令。
pub fn delete_terminal_command(
    connection: &Connection,
    group_id: &str,
    command_id: &str,
) -> Result<(), AppError> {
    automation_repo::delete_terminal_command(connection, group_id, command_id)
}

/// 删除终端命令组。
pub fn delete_terminal_command_group(
    connection: &Connection,
    group_id: &str,
) -> Result<(), AppError> {
    automation_repo::delete_terminal_command_group(connection, group_id)
}

/// 调整终端命令排序。
pub fn reorder_terminal_commands(
    connection: &Connection,
    payload: &TerminalCommandReorderPayload,
) -> Result<(), AppError> {
    automation_repo::reorder_terminal_commands(connection, payload)
}

/// 读取结构化工作区快照。
pub fn load_workspace_snapshot(connection: &Connection) -> Result<WorkspaceSnapshotDto, AppError> {
    workspace_repo::load_workspace_snapshot(connection)
}

/// 保存结构化工作区快照。
pub fn save_workspace_snapshot(
    connection: &Connection,
    snapshot: &WorkspaceSnapshotDto,
) -> Result<(), AppError> {
    let tx = connection.unchecked_transaction()?;
    workspace_repo::save_workspace_snapshot(&tx, snapshot)?;
    tx.commit()?;
    Ok(())
}

/// 从数据源记录中读取 provider 运行时所需的 secret。
fn read_runtime_source_secret(
    connection: &Connection,
    record: &source_repo::SourceRecord,
    secret_key: &str,
) -> Result<Option<String>, AppError> {
    let Some(bundle_id) = &record.secret_bundle_id else {
        return Ok(None);
    };
    connection
        .query_row(
            "SELECT cipher_text FROM secret_items WHERE bundle_id = ?1 AND secret_key = ?2",
            params![bundle_id, secret_key],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(Into::into)
}

/// 持久化数据源 secret。
fn persist_source_secrets(
    tx: &rusqlite::Transaction<'_>,
    source_id: &str,
    existing_bundle_id: Option<&str>,
    payload: &SourceUpsertPayload,
) -> Result<Option<String>, AppError> {
    let mut secret_values = std::collections::HashMap::new();
    let access_token = payload.access_token.trim().to_string();
    if !access_token.is_empty() {
        secret_values.insert("accessToken".to_string(), access_token);
    }
    if let Some(password) = payload
        .config_json
        .as_object()
        .and_then(|config| config.get("password"))
        .and_then(|value| value.as_str())
        .map(str::to_string)
    {
        if !password.is_empty() {
            secret_values.insert("password".to_string(), password);
        }
    }
    if secret_values.is_empty() && existing_bundle_id.is_none() {
        return Ok(None);
    }
    let bundle_id = secret_repo::ensure_secret_bundle(
        tx,
        "data_source",
        source_id,
        existing_bundle_id,
        "data source secrets",
    )?;
    let keep_keys = secret_values.keys().cloned().collect::<Vec<_>>();
    for (secret_key, plain_text) in secret_values {
        secret_repo::upsert_secret_item(
            tx,
            &secret_repo::SecretItemRecord {
                id: uuid::Uuid::new_v4().to_string(),
                bundle_id: bundle_id.clone(),
                secret_key,
                plain_text,
            },
        )?;
    }
    secret_repo::delete_missing_secret_items(tx, &bundle_id, &keep_keys)?;
    Ok(Some(bundle_id))
}

#[cfg(test)]
mod tests {
    use super::{read_source_metadata_cache, write_object_cache, write_source_metadata_cache};
    use crate::models::{ObjectDescribe, ObjectField, SalesforceObject};
    use crate::storage::Storage;
    use rusqlite::params;
    use std::collections::HashMap;

    /// 插入测试数据源：metadata 表通过外键依赖 data_sources。
    fn seed_salesforce_source(storage: &Storage, source_id: &str) {
        storage
            .write(|connection| {
                connection.execute(
                    "INSERT INTO data_sources (
                        id, name, source_type, environment, color, sort_order, enabled,
                        config_json, secret_bundle_id, version, created_at, updated_at, archived_at
                    ) VALUES (?1, 'Salesforce', 'salesforce', 'default', '', 1, 1, '{}', NULL, 1, ?2, ?2, NULL)",
                    params![source_id, chrono::Utc::now().to_rfc3339()],
                )?;
                Ok(())
            })
            .unwrap();
    }

    /// 构造最小 Salesforce 对象目录项。
    fn account_object() -> SalesforceObject {
        SalesforceObject {
            name: "Account".to_string(),
            label: "Account".to_string(),
            comment: None,
            queryable: true,
            createable: true,
            updateable: true,
            deletable: true,
        }
    }

    /// 构造含字段的 describe 缓存载荷。
    fn account_describe() -> ObjectDescribe {
        ObjectDescribe {
            name: "Account".to_string(),
            label: "Account".to_string(),
            fields: vec![ObjectField {
                name: "Name".to_string(),
                label: "Name".to_string(),
                data_type: "string".to_string(),
                nillable: true,
                updateable: true,
                createable: true,
                metadata: HashMap::new(),
            }],
            child_relationships: Vec::new(),
        }
    }

    #[test]
    fn object_list_cache_does_not_count_as_salesforce_describe_cache() {
        let storage = Storage::open_test().unwrap();
        seed_salesforce_source(&storage, "sf-1");

        storage
            .write(|connection| write_object_cache(connection, "sf-1", &[account_object()]))
            .unwrap();

        let cached = storage
            .read(|connection| {
                read_source_metadata_cache(connection, "sf-1", "object_describe", Some("Account"))
            })
            .unwrap();

        assert!(
            cached.is_none(),
            "只有对象目录时不能伪造字段 describe 缓存，否则前端会拿到空字段列表"
        );
    }

    #[test]
    fn refreshing_object_list_preserves_existing_salesforce_describe_fields() {
        let storage = Storage::open_test().unwrap();
        seed_salesforce_source(&storage, "sf-1");
        let payload = serde_json::to_string(&account_describe()).unwrap();

        storage
            .write(|connection| {
                write_source_metadata_cache(
                    connection,
                    "sf-1",
                    "object_describe",
                    Some("Account"),
                    &payload,
                )
            })
            .unwrap();

        storage
            .write(|connection| write_object_cache(connection, "sf-1", &[account_object()]))
            .unwrap();

        let cached = storage
            .read(|connection| {
                read_source_metadata_cache(connection, "sf-1", "object_describe", Some("Account"))
            })
            .unwrap()
            .expect("刷新对象目录不应删除已有字段 describe 缓存");
        let describe: ObjectDescribe = serde_json::from_str(&cached).unwrap();

        assert_eq!(
            describe.fields.len(),
            1,
            "刷新对象目录后仍应保留 Account 字段元数据"
        );
    }
}
