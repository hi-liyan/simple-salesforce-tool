use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::models::{VirtualView, VirtualViewUpsertPayload};

/// 查询指定数据源下的全部本地虚拟视图（按名称升序）。
pub fn list_virtual_views(
    connection: &Connection,
    source_id: &str,
) -> Result<Vec<VirtualView>, AppError> {
    let mut statement = connection.prepare(
        "SELECT id, source_id, name, sql_text, description, created_at, updated_at
         FROM virtual_views
         WHERE source_id = ?1
         ORDER BY name ASC, created_at ASC",
    )?;
    let rows = statement.query_map(params![source_id], |row| {
        Ok(VirtualView {
            id: row.get(0)?,
            source_id: row.get(1)?,
            name: row.get(2)?,
            sql_text: row.get(3)?,
            description: row.get(4)?,
            created_at: row.get(5)?,
            updated_at: row.get(6)?,
        })
    })?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 新建或更新本地虚拟视图（同一数据源下名称唯一）。
pub fn upsert_virtual_view(
    connection: &Connection,
    payload: &VirtualViewUpsertPayload,
) -> Result<VirtualView, AppError> {
    let source_id = payload.source_id.trim();
    let name = payload.name.trim();
    let sql_text = payload.sql_text.trim();
    let description = payload
        .description
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned);

    if source_id.is_empty() {
        return Err(AppError::Biz("数据源 ID 不能为空".to_string()));
    }
    if name.is_empty() {
        return Err(AppError::Biz("虚拟视图名称不能为空".to_string()));
    }
    if sql_text.is_empty() {
        return Err(AppError::Biz("虚拟视图 SQL 语句不能为空".to_string()));
    }

    let now = Utc::now().to_rfc3339();
    let existing_id = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    // 行内注释：检查同数据源下是否已存在同名虚拟视图，避免 UNIQUE 约束报错过于生硬。
    let duplicate_id: Option<String> = connection
        .query_row(
            "SELECT id FROM virtual_views WHERE source_id = ?1 AND name = ?2",
            params![source_id, name],
            |row| row.get(0),
        )
        .optional()?;

    if let Some(dup_id) = duplicate_id {
        if existing_id != Some(dup_id.as_str()) {
            return Err(AppError::Biz(format!("虚拟视图 \"{name}\" 已存在")));
        }
    }

    let target_id = if let Some(id) = existing_id {
        let affected = connection.execute(
            "UPDATE virtual_views
             SET name = ?1, sql_text = ?2, description = ?3, updated_at = ?4
             WHERE id = ?5 AND source_id = ?6",
            params![name, sql_text, description, now, id, source_id],
        )?;
        if affected == 0 {
            return Err(AppError::Biz("目标虚拟视图不存在或已删除".to_string()));
        }
        id.to_string()
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO virtual_views (id, source_id, name, sql_text, description, created_at, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
            params![new_id, source_id, name, sql_text, description, now, now],
        )?;
        new_id
    };

    connection
        .query_row(
            "SELECT id, source_id, name, sql_text, description, created_at, updated_at
             FROM virtual_views
             WHERE id = ?1",
            params![target_id],
            |row| {
                Ok(VirtualView {
                    id: row.get(0)?,
                    source_id: row.get(1)?,
                    name: row.get(2)?,
                    sql_text: row.get(3)?,
                    description: row.get(4)?,
                    created_at: row.get(5)?,
                    updated_at: row.get(6)?,
                })
            },
        )
        .map_err(AppError::from)
}

/// 删除指定本地虚拟视图。
pub fn delete_virtual_view(connection: &Connection, id: &str) -> Result<(), AppError> {
    let trimmed = id.trim();
    if trimmed.is_empty() {
        return Err(AppError::Biz("虚拟视图 ID 不能为空".to_string()));
    }
    connection.execute("DELETE FROM virtual_views WHERE id = ?1", params![trimmed])?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::Storage;

    #[test]
    fn crud_virtual_views_works_and_enforces_unique_name_per_source() {
        let storage = Storage::open_test().unwrap();
        let now = Utc::now().to_rfc3339();
        storage
            .write(|conn| {
                conn.execute(
                    "INSERT INTO data_sources (id, name, source_type, sort_order, config_json, created_at, updated_at)
                     VALUES ('src-my', 'MySQL', 'mysql', 1, '{}', ?1, ?1)",
                    params![now],
                )?;
                Ok(())
            })
            .unwrap();

        let created = storage
            .write(|conn| {
                upsert_virtual_view(
                    conn,
                    &VirtualViewUpsertPayload {
                        id: None,
                        source_id: "src-my".to_string(),
                        name: "active_users".to_string(),
                        sql_text: "SELECT * FROM users WHERE active = 1;".to_string(),
                        description: Some("活跃用户视图".to_string()),
                    },
                )
            })
            .unwrap();
        assert_eq!(created.name, "active_users");

        // 同名校验。
        let dup = storage.write(|conn| {
            upsert_virtual_view(
                conn,
                &VirtualViewUpsertPayload {
                    id: None,
                    source_id: "src-my".to_string(),
                    name: "active_users".to_string(),
                    sql_text: "SELECT 1;".to_string(),
                    description: None,
                },
            )
        });
        assert!(dup.is_err());

        let updated = storage
            .write(|conn| {
                upsert_virtual_view(
                    conn,
                    &VirtualViewUpsertPayload {
                        id: Some(created.id.clone()),
                        source_id: "src-my".to_string(),
                        name: "active_users_v2".to_string(),
                        sql_text: "SELECT id, name FROM users;".to_string(),
                        description: None,
                    },
                )
            })
            .unwrap();
        assert_eq!(updated.name, "active_users_v2");

        let listed = storage
            .read(|conn| list_virtual_views(conn, "src-my"))
            .unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].sql_text, "SELECT id, name FROM users;");

        storage
            .write(|conn| delete_virtual_view(conn, &created.id))
            .unwrap();
        let after_delete = storage
            .read(|conn| list_virtual_views(conn, "src-my"))
            .unwrap();
        assert!(after_delete.is_empty());
    }
}
