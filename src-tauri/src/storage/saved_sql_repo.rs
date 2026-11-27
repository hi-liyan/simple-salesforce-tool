use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};

use crate::error::AppError;
use crate::models::{SavedSqlListParams, SavedSqlQuery, SavedSqlUpsertPayload};

/// 将数据库查询行映射为 `SavedSqlQuery` 领域模型。
fn map_saved_sql_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SavedSqlQuery> {
    Ok(SavedSqlQuery {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        sql_text: row.get(3)?,
        query_language: row.get(4)?,
        source_id: row.get(5)?,
        is_pinned: row.get::<_, i64>(6)? != 0,
        use_count: row.get(7)?,
        last_used_at: row.get(8)?,
        created_at: row.get(9)?,
        updated_at: row.get(10)?,
    })
}

/// 查询已保存常用 SQL 列表（支持按关键词、查询语言、数据源作用域与置顶状态过滤）。
pub fn list_saved_sql(
    connection: &Connection,
    filter: &SavedSqlListParams,
) -> Result<Vec<SavedSqlQuery>, AppError> {
    let keyword = filter
        .keyword
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| format!("%{}%", v.to_lowercase()));
    let query_language = filter
        .query_language
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(|v| v.to_lowercase());
    let source_id = filter
        .source_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);
    let only_current_source = if filter.only_current_source { 1i64 } else { 0i64 };
    let pinned_only = if filter.pinned_only { 1i64 } else { 0i64 };

    // 行内注释：置顶优先，其次按最近使用时间与更新时间倒序排列。
    let mut statement = connection.prepare(
        "SELECT id, name, description, sql_text, query_language, source_id,
                is_pinned, use_count, last_used_at, created_at, updated_at
         FROM saved_sql_queries
         WHERE (?1 IS NULL OR LOWER(name) LIKE ?1 OR LOWER(description) LIKE ?1 OR LOWER(sql_text) LIKE ?1)
           AND (?2 IS NULL OR LOWER(query_language) = ?2)
           AND (?3 IS NULL OR (?4 = 1 AND source_id = ?3) OR (?4 = 0 AND (source_id IS NULL OR source_id = ?3)))
           AND (?5 = 0 OR is_pinned = 1)
         ORDER BY is_pinned DESC, COALESCE(last_used_at, updated_at) DESC, updated_at DESC",
    )?;
    let rows = statement.query_map(
        params![keyword, query_language, source_id, only_current_source, pinned_only],
        map_saved_sql_row,
    )?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 新建或更新已保存 SQL 条目。
pub fn upsert_saved_sql(
    connection: &Connection,
    payload: &SavedSqlUpsertPayload,
) -> Result<SavedSqlQuery, AppError> {
    let name = payload.name.trim();
    let sql_text = payload.sql_text.trim();
    let description = payload.description.as_deref().unwrap_or("").trim().to_string();
    let query_language = payload.query_language.trim().to_lowercase();
    let source_id = payload
        .source_id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty())
        .map(ToOwned::to_owned);

    if name.is_empty() {
        return Err(AppError::Biz("SQL 名称不能为空".to_string()));
    }
    if sql_text.is_empty() {
        return Err(AppError::Biz("SQL 内容不能为空".to_string()));
    }
    let normalized_lang = if query_language.is_empty() {
        "mysql".to_string()
    } else {
        query_language
    };

    let now = Utc::now().to_rfc3339();
    let existing_id = payload
        .id
        .as_deref()
        .map(str::trim)
        .filter(|v| !v.is_empty());

    let target_id = if let Some(id) = existing_id {
        let affected = connection.execute(
            "UPDATE saved_sql_queries
             SET name = ?1, description = ?2, sql_text = ?3, query_language = ?4,
                 source_id = ?5, is_pinned = ?6, updated_at = ?7
             WHERE id = ?8",
            params![
                name,
                description,
                sql_text,
                normalized_lang,
                source_id,
                if payload.is_pinned { 1i64 } else { 0i64 },
                now,
                id
            ],
        )?;
        if affected == 0 {
            return Err(AppError::Biz("目标已保存 SQL 不存在或已被删除".to_string()));
        }
        id.to_string()
    } else {
        let new_id = uuid::Uuid::new_v4().to_string();
        connection.execute(
            "INSERT INTO saved_sql_queries (
                id, name, description, sql_text, query_language, source_id,
                is_pinned, use_count, last_used_at, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0, NULL, ?8, ?8)",
            params![
                new_id,
                name,
                description,
                sql_text,
                normalized_lang,
                source_id,
                if payload.is_pinned { 1i64 } else { 0i64 },
                now
            ],
        )?;
        new_id
    };

    get_saved_sql_by_id(connection, &target_id)?
        .ok_or_else(|| AppError::Biz("读取保存后的 SQL 记录失败".to_string()))
}

/// 切换已保存 SQL 的置顶状态，并返回最新记录。
pub fn toggle_saved_sql_pin(
    connection: &Connection,
    id: &str,
    is_pinned: bool,
) -> Result<SavedSqlQuery, AppError> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err(AppError::Biz("SQL 记录 ID 不能为空".to_string()));
    }
    let now = Utc::now().to_rfc3339();
    let affected = connection.execute(
        "UPDATE saved_sql_queries SET is_pinned = ?1, updated_at = ?2 WHERE id = ?3",
        params![if is_pinned { 1i64 } else { 0i64 }, now, trimmed_id],
    )?;
    if affected == 0 {
        return Err(AppError::Biz("目标已保存 SQL 不存在".to_string()));
    }
    get_saved_sql_by_id(connection, trimmed_id)?
        .ok_or_else(|| AppError::Biz("读取已保存 SQL 失败".to_string()))
}

/// 记录已保存 SQL 被使用一次（递增 `use_count` 并更新 `last_used_at`）。
pub fn mark_saved_sql_used(connection: &Connection, id: &str) -> Result<(), AppError> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Ok(());
    }
    let now = Utc::now().to_rfc3339();
    connection.execute(
        "UPDATE saved_sql_queries SET use_count = use_count + 1, last_used_at = ?1 WHERE id = ?2",
        params![now, trimmed_id],
    )?;
    Ok(())
}

/// 删除指定的已保存 SQL。
pub fn delete_saved_sql(connection: &Connection, id: &str) -> Result<(), AppError> {
    let trimmed_id = id.trim();
    if trimmed_id.is_empty() {
        return Err(AppError::Biz("SQL 记录 ID 不能为空".to_string()));
    }
    connection.execute("DELETE FROM saved_sql_queries WHERE id = ?1", params![trimmed_id])?;
    Ok(())
}

/// 按 ID 查询单条已保存 SQL。
fn get_saved_sql_by_id(
    connection: &Connection,
    id: &str,
) -> Result<Option<SavedSqlQuery>, AppError> {
    connection
        .query_row(
            "SELECT id, name, description, sql_text, query_language, source_id,
                    is_pinned, use_count, last_used_at, created_at, updated_at
             FROM saved_sql_queries
             WHERE id = ?1",
            params![id],
            map_saved_sql_row,
        )
        .optional()
        .map_err(AppError::from)
}

#[cfg(test)]
mod tests {
    use super::{
        delete_saved_sql, list_saved_sql, mark_saved_sql_used, toggle_saved_sql_pin,
        upsert_saved_sql,
    };
    use crate::models::{SavedSqlListParams, SavedSqlUpsertPayload};
    use crate::storage::Storage;

    #[test]
    fn crud_and_search_saved_sql_works() {
        let root = std::env::temp_dir().join(format!("sst-saved-sql-{}", uuid::Uuid::new_v4()));
        let storage = Storage::open_or_bootstrap(&root).unwrap();

        let created = storage
            .write(|conn| {
                upsert_saved_sql(
                    conn,
                    &SavedSqlUpsertPayload {
                        id: None,
                        name: "下单对账脚本".to_string(),
                        description: Some("排查订单与库存不一致问题".to_string()),
                        sql_text: "SELECT * FROM orders;\nSELECT * FROM inventory;".to_string(),
                        query_language: "mysql".to_string(),
                        source_id: None,
                        is_pinned: false,
                    },
                )
            })
            .unwrap();
        assert_eq!(created.name, "下单对账脚本");
        assert_eq!(created.description, "排查订单与库存不一致问题");

        // 行内注释：按 SQL 说明关键词检索也应精准命中。
        let by_desc = storage
            .read(|conn| {
                list_saved_sql(
                    conn,
                    &SavedSqlListParams {
                        keyword: Some("库存不一致".to_string()),
                        query_language: Some("mysql".to_string()),
                        ..Default::default()
                    },
                )
            })
            .unwrap();
        assert_eq!(by_desc.len(), 1);
        assert_eq!(by_desc[0].id, created.id);

        let pinned = storage
            .write(|conn| toggle_saved_sql_pin(conn, &created.id, true))
            .unwrap();
        assert!(pinned.is_pinned);

        storage
            .write(|conn| mark_saved_sql_used(conn, &created.id))
            .unwrap();
        let after_use = storage
            .read(|conn| list_saved_sql(conn, &SavedSqlListParams::default()))
            .unwrap();
        assert_eq!(after_use[0].use_count, 1);

        storage
            .write(|conn| delete_saved_sql(conn, &created.id))
            .unwrap();
        let after_del = storage
            .read(|conn| list_saved_sql(conn, &SavedSqlListParams::default()))
            .unwrap();
        assert!(after_del.is_empty());
    }
}
