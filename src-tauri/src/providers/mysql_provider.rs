use std::collections::HashMap;
use std::time::Duration;

use chrono::{NaiveDate, NaiveDateTime, NaiveTime};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::mysql::types::{MySqlTime, MySqlTimeSign};
use sqlx::mysql::{MySqlPool, MySqlPoolOptions, MySqlRow};
use sqlx::{types::Json, Column, MySql, QueryBuilder, Row, TypeInfo};

use crate::error::AppError;
use crate::models::{
    CurrentUserContext, ObjectDdl, ObjectDescribe, ObjectField, QueryResult, RecordUpdatePayload,
    SalesforceObject, SalesforceSource,
};

/// MySQL 数据源连接配置（来自 source.config_json）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MySqlSourceConfig {
    /// 数据库主机地址。
    pub host: String,
    /// 数据库端口，默认 3306。
    #[serde(default = "default_mysql_port")]
    pub port: u16,
    /// 目标数据库（schema）名称。
    pub database: String,
    /// 用户名。
    pub username: String,
    /// 密码。
    #[serde(default)]
    pub password: String,
    /// 连接字符集，默认 utf8mb4。
    #[serde(default = "default_mysql_charset")]
    pub charset: String,
    /// SSL 模式（disable/preferred/required，M2 先保留字段）。
    #[serde(default)]
    pub ssl_mode: Option<String>,
    /// 主键字段名覆盖（未配置时自动读取信息架构）。
    #[serde(default)]
    pub primary_key: Option<String>,
    /// 直接连接串（配置时优先于 host/port 拼接）。
    #[serde(default)]
    pub url: Option<String>,
}

/// MySQL 默认端口。
fn default_mysql_port() -> u16 {
    3306
}

/// MySQL 默认字符集。
fn default_mysql_charset() -> String {
    "utf8mb4".to_string()
}

/// MySQL Provider：提供表/字段/查询/CRUD/事务能力。
pub struct MySqlProvider;

/// 构建 MySQL 新增日志 SQL：与真实执行共用主键解析和字段归一化逻辑。
pub async fn preview_create_record_sql(
    source: &SalesforceSource,
    object_name: &str,
    values: HashMap<String, Value>,
) -> Result<String, AppError> {
    let (safe_table, primary_key) = resolve_table_and_primary_key(source, object_name).await?;
    let normalized_values = normalize_create_values(values, &primary_key);
    build_insert_preview_sql(&safe_table, normalized_values)
}

/// 构建 MySQL 批量保存日志 SQL：逐条复用真实执行前的数据归一化逻辑。
pub async fn preview_save_records_sql(
    source: &SalesforceSource,
    object_name: &str,
    creates: Vec<HashMap<String, Value>>,
    updates: Vec<RecordUpdatePayload>,
) -> Result<String, AppError> {
    let (safe_table, primary_key) = resolve_table_and_primary_key(source, object_name).await?;
    let mut lines: Vec<String> = Vec::new();

    // 新增记录逐条展开，保持与真实执行顺序一致。
    for (index, item) in creates.into_iter().enumerate() {
        let normalized_values = normalize_create_values(item, &primary_key);
        let sql = build_insert_preview_sql(&safe_table, normalized_values)?;
        lines.push(format!("[create#{index}] {sql}"));
    }

    // 更新记录逐条展开；没有可更新字段时显式标记为未执行 SQL。
    for (index, item) in updates.into_iter().enumerate() {
        let normalized_values = normalize_update_values(item.values, &primary_key);
        if let Some(sql) = build_update_preview_sql(
            &safe_table,
            &primary_key,
            &item.record_id,
            normalized_values,
        )? {
            lines.push(format!("[update#{index}] {sql}"));
        } else {
            lines.push(format!("[update#{index}] -- SQL 未执行：没有可更新字段。"));
        }
    }

    Ok(lines.join("\n"))
}

/// 构建 MySQL 批量保存+删除日志 SQL：逐条复用真实执行前的数据归一化逻辑。
pub async fn preview_save_records_with_deletes_sql(
    source: &SalesforceSource,
    object_name: &str,
    creates: Vec<HashMap<String, Value>>,
    updates: Vec<RecordUpdatePayload>,
    deletes: Vec<String>,
) -> Result<String, AppError> {
    let (safe_table, primary_key) = resolve_table_and_primary_key(source, object_name).await?;
    let mut lines: Vec<String> = Vec::new();

    // 新增记录逐条展开，保持与真实执行顺序一致。
    for (index, item) in creates.into_iter().enumerate() {
        let normalized_values = normalize_create_values(item, &primary_key);
        let sql = build_insert_preview_sql(&safe_table, normalized_values)?;
        lines.push(format!("[create#{index}] {sql}"));
    }

    // 更新记录逐条展开；没有可更新字段时显式标记为未执行 SQL。
    for (index, item) in updates.into_iter().enumerate() {
        let normalized_values = normalize_update_values(item.values, &primary_key);
        if let Some(sql) = build_update_preview_sql(
            &safe_table,
            &primary_key,
            &item.record_id,
            normalized_values,
        )? {
            lines.push(format!("[update#{index}] {sql}"));
        } else {
            lines.push(format!("[update#{index}] -- SQL 未执行：没有可更新字段。"));
        }
    }

    // 删除记录逐条展开，便于定位回滚前的操作明细。
    for (index, record_id) in deletes.into_iter().enumerate() {
        let sql = build_delete_preview_sql(&safe_table, &primary_key, &record_id);
        lines.push(format!("[delete#{index}] {sql}"));
    }

    Ok(lines.join("\n"))
}

/// 构建 MySQL 更新日志 SQL：与真实执行共用主键解析和字段归一化逻辑。
pub async fn preview_update_record_sql(
    source: &SalesforceSource,
    object_name: &str,
    record_id: &str,
    values: HashMap<String, Value>,
) -> Result<String, AppError> {
    let (safe_table, primary_key) = resolve_table_and_primary_key(source, object_name).await?;
    let normalized_values = normalize_update_values(values, &primary_key);
    if let Some(sql) =
        build_update_preview_sql(&safe_table, &primary_key, record_id, normalized_values)?
    {
        Ok(sql)
    } else {
        Ok("-- SQL 未执行：没有可更新字段。".to_string())
    }
}

/// 构建 MySQL 删除日志 SQL：与真实执行共用主键解析逻辑。
pub async fn preview_delete_record_sql(
    source: &SalesforceSource,
    object_name: &str,
    record_id: &str,
) -> Result<String, AppError> {
    let (safe_table, primary_key) = resolve_table_and_primary_key(source, object_name).await?;
    Ok(build_delete_preview_sql(
        &safe_table,
        &primary_key,
        record_id,
    ))
}

impl MySqlProvider {
    /// 创建 MySQL Provider 实例。
    pub fn new() -> Self {
        Self
    }

    /// 测试数据源连接可用性。
    pub async fn test_connection(&self, source: &SalesforceSource) -> Result<(), AppError> {
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        sqlx::query("SELECT 1")
            .execute(&pool)
            .await
            .map_err(|error| AppError::Db(format!("MySQL 连接测试失败: {error}")))?;
        Ok(())
    }

    /// 读取表列表并映射为统一对象结构。
    pub async fn list_objects(
        &self,
        source: &SalesforceSource,
    ) -> Result<Vec<SalesforceObject>, AppError> {
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;

        let rows = sqlx::query(
            r#"
            SELECT table_name, table_comment
            FROM information_schema.tables
            WHERE table_schema = ? AND table_type = 'BASE TABLE'
            ORDER BY table_name ASC
            "#,
        )
        .bind(&config.database)
        .fetch_all(&pool)
        .await
        .map_err(|error| AppError::Db(format!("读取 MySQL 表列表失败: {error}")))?;

        let mut items = Vec::with_capacity(rows.len());
        for row in rows {
            let table_name = decode_row_string(&row, 0usize, "表名")?;
            let table_comment = decode_optional_row_string(&row, 1usize)
                .and_then(|comment| (!comment.trim().is_empty()).then_some(comment));
            items.push(SalesforceObject {
                name: table_name.clone(),
                label: table_name,
                comment: table_comment,
                queryable: true,
                createable: true,
                updateable: true,
                deletable: true,
            });
        }
        Ok(items)
    }

    /// 读取指定表的列定义并映射为统一字段结构。
    pub async fn describe_object(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDescribe, AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;

        let rows = sqlx::query(
            r#"
            SELECT
                column_name,
                data_type,
                is_nullable,
                column_default,
                column_key,
                extra,
                column_comment,
                column_type
            FROM information_schema.columns
            WHERE table_schema = ? AND table_name = ?
            ORDER BY ordinal_position ASC
            "#,
        )
        .bind(&config.database)
        .bind(&safe_table)
        .fetch_all(&pool)
        .await
        .map_err(|error| AppError::Db(format!("读取 MySQL 字段元数据失败: {error}")))?;

        let mut fields = Vec::with_capacity(rows.len());
        for row in rows {
            let column_name = decode_row_string(&row, 0usize, "字段名")?;
            let data_type = decode_row_string(&row, 1usize, "字段类型")?;
            let is_nullable = decode_row_string(&row, 2usize, "字段可空标记")?;
            let column_default: Option<String> = decode_optional_row_string(&row, 3usize);
            let column_key: Option<String> = decode_optional_row_string(&row, 4usize);
            let extra: Option<String> = decode_optional_row_string(&row, 5usize);
            let column_comment: Option<String> = decode_optional_row_string(&row, 6usize);
            let column_type: Option<String> = decode_optional_row_string(&row, 7usize);

            let mut metadata = HashMap::new();
            metadata.insert(
                "columnKey".to_string(),
                Value::String(column_key.unwrap_or_default()),
            );
            metadata.insert(
                "extra".to_string(),
                Value::String(extra.unwrap_or_default()),
            );
            metadata.insert(
                "columnDefault".to_string(),
                column_default.map(Value::String).unwrap_or(Value::Null),
            );
            metadata.insert(
                "comment".to_string(),
                column_comment.map(Value::String).unwrap_or(Value::Null),
            );
            metadata.insert(
                "mysqlDataType".to_string(),
                Value::String(data_type.clone()),
            );
            metadata.insert(
                "columnType".to_string(),
                column_type.map(Value::String).unwrap_or(Value::Null),
            );

            fields.push(ObjectField {
                name: column_name.clone(),
                label: column_name,
                data_type,
                nillable: is_nullable.eq_ignore_ascii_case("YES"),
                updateable: true,
                createable: true,
                metadata,
            });
        }

        Ok(ObjectDescribe {
            name: safe_table.clone(),
            label: safe_table,
            fields,
            child_relationships: vec![],
        })
    }

    /// MySQL 不支持 Salesforce ChildRelationshipName，统一返回 None。
    pub async fn resolve_field_child_relationship_name(
        &self,
        _source: &SalesforceSource,
        _object_name: &str,
        _field_name: &str,
    ) -> Result<Option<String>, AppError> {
        Ok(None)
    }

    /// 执行 SQL 查询并映射为记录列表。
    pub async fn query_records(
        &self,
        source: &SalesforceSource,
        query_text: &str,
    ) -> Result<QueryResult, AppError> {
        ensure_readonly_query(query_text)?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;

        let inferred_table = infer_table_name_from_query(query_text);
        let inferred_primary_key = if let Some(table_name) = inferred_table.as_deref() {
            resolve_primary_key_column(&pool, &config, table_name)
                .await
                .ok()
        } else {
            None
        };

        let rows = sqlx::query(query_text)
            .fetch_all(&pool)
            .await
            .map_err(|error| AppError::Db(format!("执行 MySQL 查询失败: {error}")))?;

        let mut records = Vec::with_capacity(rows.len());
        for row in rows {
            let mut item = row_to_json_record(&row);
            // 与现有前端兼容：补齐 Id 字段，确保选中/编辑/删除逻辑可复用。
            if !item.contains_key("Id") {
                if let Some(pk) = inferred_primary_key.as_ref() {
                    if let Some(value) = item.get(pk).cloned() {
                        item.insert("Id".to_string(), value);
                    }
                }
            }
            records.push(item);
        }

        Ok(QueryResult {
            total_size: records.len(),
            records,
        })
    }

    /// MySQL 数据源无 Salesforce 用户上下文，返回空值。
    pub async fn get_current_user_context(
        &self,
        _source: &SalesforceSource,
    ) -> Result<CurrentUserContext, AppError> {
        Ok(CurrentUserContext {
            timezone_sid_key: None,
            locale_sid_key: None,
        })
    }

    /// 新增单条记录并返回主键值（优先使用显式主键，否则回退 last_insert_id）。
    pub async fn create_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        values: HashMap<String, Value>,
    ) -> Result<String, AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;

        // 与前端现有约定兼容：若仅有 Id 字段，则映射到真实主键列。
        let values = normalize_create_values(values, &primary_key);
        let provided_primary = values.get(&primary_key).cloned();
        execute_insert(&pool, &safe_table, values).await?;

        if let Some(value) = provided_primary {
            return Ok(value_to_string(&value));
        }

        let last_insert_id: u64 = sqlx::query_scalar("SELECT LAST_INSERT_ID()")
            .fetch_one(&pool)
            .await
            .map_err(|error| AppError::Db(format!("读取 LAST_INSERT_ID 失败: {error}")))?;
        Ok(last_insert_id.to_string())
    }

    /// 批量保存记录（新增+更新），全部成功后提交事务。
    pub async fn save_records(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
    ) -> Result<(), AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;
        let mut transaction = pool
            .begin()
            .await
            .map_err(|error| AppError::Db(format!("开启 MySQL 事务失败: {error}")))?;

        for create_item in creates {
            let create_item = normalize_create_values(create_item, &primary_key);
            execute_insert(&mut *transaction, &safe_table, create_item).await?;
        }

        for update_item in updates {
            let values = normalize_update_values(update_item.values, &primary_key);
            if values.is_empty() {
                continue;
            }
            execute_update(
                &mut *transaction,
                &safe_table,
                &primary_key,
                &update_item.record_id,
                values,
            )
            .await?;
        }

        transaction
            .commit()
            .await
            .map_err(|error| AppError::Db(format!("提交 MySQL 事务失败: {error}")))?;
        Ok(())
    }

    /// 批量保存记录（新增+更新+删除），全部成功后提交事务。
    pub async fn save_records_with_deletes(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        creates: Vec<HashMap<String, Value>>,
        updates: Vec<RecordUpdatePayload>,
        deletes: Vec<String>,
    ) -> Result<(), AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;
        let mut transaction = pool
            .begin()
            .await
            .map_err(|error| AppError::Db(format!("开启 MySQL 事务失败: {error}")))?;

        // 新增记录必须全部成功才继续。
        for create_item in creates {
            let create_item = normalize_create_values(create_item, &primary_key);
            execute_insert(&mut *transaction, &safe_table, create_item).await?;
        }

        // 更新记录逐条提交，任何失败都会触发回滚。
        for update_item in updates {
            let values = normalize_update_values(update_item.values, &primary_key);
            if values.is_empty() {
                // 空更新直接跳过，避免写入无意义 SQL。
                continue;
            }
            execute_update(
                &mut *transaction,
                &safe_table,
                &primary_key,
                &update_item.record_id,
                values,
            )
            .await?;
        }

        // 删除记录逐条提交，确保与新增/更新处于同一事务。
        for record_id in deletes {
            execute_delete(&mut *transaction, &safe_table, &primary_key, &record_id).await?;
        }

        transaction
            .commit()
            .await
            .map_err(|error| AppError::Db(format!("提交 MySQL 事务失败: {error}")))?;
        Ok(())
    }

    /// 更新单条记录（按主键定位）。
    pub async fn update_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
        values: HashMap<String, Value>,
    ) -> Result<(), AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;

        let values = normalize_update_values(values, &primary_key);
        if values.is_empty() {
            return Ok(());
        }

        execute_update(&pool, &safe_table, &primary_key, record_id, values).await
    }

    /// 删除单条记录（按主键定位）。
    pub async fn delete_record(
        &self,
        source: &SalesforceSource,
        object_name: &str,
        record_id: &str,
    ) -> Result<(), AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;
        let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;

        let mut builder = QueryBuilder::<MySql>::new(format!(
            "DELETE FROM `{safe_table}` WHERE `{primary_key}` = "
        ));
        builder.push_bind(record_id);
        builder
            .build()
            .execute(&pool)
            .await
            .map_err(|error| AppError::Db(format!("删除 MySQL 记录失败: {error}")))?;
        Ok(())
    }

    /// MySQL 无 Salesforce token 校验，恒定返回 true。
    pub async fn validate_token(&self, _source: &SalesforceSource) -> bool {
        true
    }

    /// 读取表 DDL 信息（建表语句 + 索引/约束语句）。
    pub async fn get_object_ddl(
        &self,
        source: &SalesforceSource,
        object_name: &str,
    ) -> Result<ObjectDdl, AppError> {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        let config = MySqlSourceConfig::from_source(source)?;
        let pool = build_mysql_pool(&config).await?;

        // 1. 建表 DDL：直接读取 SHOW CREATE TABLE。
        let create_row = sqlx::query(&format!("SHOW CREATE TABLE `{safe_table}`"))
            .fetch_one(&pool)
            .await
            .map_err(|error| AppError::Db(format!("读取建表 DDL 失败: {error}")))?;
        let create_table_ddl = decode_row_string(&create_row, 1usize, "建表DDL")?;

        // 2. 索引 DDL：排除主键，按索引名聚合列。
        let index_rows = sqlx::query(
            r#"
            SELECT
                index_name,
                non_unique,
                index_type,
                GROUP_CONCAT(
                    CONCAT('`', column_name, '`', IF(collation = 'D', ' DESC', ''))
                    ORDER BY seq_in_index
                    SEPARATOR ', '
                ) AS indexed_columns
            FROM information_schema.statistics
            WHERE table_schema = ? AND table_name = ? AND index_name <> 'PRIMARY'
            GROUP BY index_name, non_unique, index_type
            ORDER BY index_name ASC
            "#,
        )
        .bind(&config.database)
        .bind(&safe_table)
        .fetch_all(&pool)
        .await
        .map_err(|error| AppError::Db(format!("读取索引 DDL 失败: {error}")))?;

        let mut index_ddls = Vec::with_capacity(index_rows.len());
        for row in index_rows {
            let index_name = decode_row_string(&row, 0usize, "索引名")?;
            let non_unique = row
                .try_get::<i64, _>(1usize)
                .map_err(|error| AppError::Db(format!("读取索引唯一性失败: {error}")))?;
            let index_type = decode_row_string(&row, 2usize, "索引类型")?;
            let indexed_columns = decode_optional_row_string(&row, 3usize).unwrap_or_default();
            if indexed_columns.trim().is_empty() {
                continue;
            }
            let unique_prefix = if non_unique == 0 { "UNIQUE " } else { "" };
            index_ddls.push(format!(
                "CREATE {unique_prefix}INDEX `{index_name}` ON `{safe_table}` ({indexed_columns}) USING {index_type};"
            ));
        }

        // 3. 约束 DDL：提取 UNIQUE/FK 约束，便于直接复制复用。
        let constraint_rows = sqlx::query(
            r#"
            SELECT
                tc.constraint_name,
                tc.constraint_type,
                GROUP_CONCAT(CONCAT('`', kcu.column_name, '`') ORDER BY kcu.ordinal_position SEPARATOR ', ') AS constraint_columns,
                MIN(kcu.referenced_table_name) AS referenced_table,
                GROUP_CONCAT(
                    CONCAT('`', kcu.referenced_column_name, '`')
                    ORDER BY COALESCE(kcu.position_in_unique_constraint, kcu.ordinal_position)
                    SEPARATOR ', '
                ) AS referenced_columns,
                MIN(rc.update_rule) AS update_rule,
                MIN(rc.delete_rule) AS delete_rule
            FROM information_schema.table_constraints tc
            LEFT JOIN information_schema.key_column_usage kcu
                ON tc.constraint_schema = kcu.constraint_schema
                AND tc.table_name = kcu.table_name
                AND tc.constraint_name = kcu.constraint_name
            LEFT JOIN information_schema.referential_constraints rc
                ON tc.constraint_schema = rc.constraint_schema
                AND tc.table_name = rc.table_name
                AND tc.constraint_name = rc.constraint_name
            WHERE tc.table_schema = ? AND tc.table_name = ?
                AND tc.constraint_type IN ('UNIQUE', 'FOREIGN KEY')
            GROUP BY tc.constraint_name, tc.constraint_type
            ORDER BY tc.constraint_type ASC, tc.constraint_name ASC
            "#,
        )
        .bind(&config.database)
        .bind(&safe_table)
        .fetch_all(&pool)
        .await
        .map_err(|error| AppError::Db(format!("读取约束 DDL 失败: {error}")))?;

        let mut constraint_ddls = Vec::with_capacity(constraint_rows.len());
        for row in constraint_rows {
            let constraint_name = decode_row_string(&row, 0usize, "约束名")?;
            let constraint_type = decode_row_string(&row, 1usize, "约束类型")?;
            let columns = decode_optional_row_string(&row, 2usize).unwrap_or_default();
            if columns.trim().is_empty() {
                continue;
            }

            if constraint_type.eq_ignore_ascii_case("UNIQUE") {
                constraint_ddls.push(format!(
                    "ALTER TABLE `{safe_table}` ADD CONSTRAINT `{constraint_name}` UNIQUE ({columns});"
                ));
                continue;
            }

            if constraint_type.eq_ignore_ascii_case("FOREIGN KEY") {
                let referenced_table = decode_optional_row_string(&row, 3usize).unwrap_or_default();
                let referenced_columns =
                    decode_optional_row_string(&row, 4usize).unwrap_or_default();
                let update_rule = decode_optional_row_string(&row, 5usize)
                    .unwrap_or_else(|| "NO ACTION".to_string());
                let delete_rule = decode_optional_row_string(&row, 6usize)
                    .unwrap_or_else(|| "NO ACTION".to_string());
                if referenced_table.trim().is_empty() || referenced_columns.trim().is_empty() {
                    continue;
                }
                constraint_ddls.push(format!(
                    "ALTER TABLE `{safe_table}` ADD CONSTRAINT `{constraint_name}` FOREIGN KEY ({columns}) REFERENCES `{referenced_table}` ({referenced_columns}) ON UPDATE {update_rule} ON DELETE {delete_rule};"
                ));
            }
        }

        Ok(ObjectDdl {
            create_table_ddl,
            index_ddls,
            constraint_ddls,
        })
    }
}

impl MySqlSourceConfig {
    /// 从通用数据源结构中解析 MySQL 配置并做基础校验。
    pub fn from_source(source: &SalesforceSource) -> Result<Self, AppError> {
        let mut parsed = serde_json::from_value::<MySqlSourceConfig>(source.config_json.clone())
            .map_err(|error| AppError::Biz(format!("MySQL 配置解析失败: {error}")))?;

        if parsed.host.trim().is_empty() {
            return Err(AppError::Biz("MySQL host 不能为空".to_string()));
        }
        if parsed.database.trim().is_empty() {
            return Err(AppError::Biz("MySQL database 不能为空".to_string()));
        }
        if parsed.username.trim().is_empty() {
            return Err(AppError::Biz("MySQL username 不能为空".to_string()));
        }
        // 避免配置里出现非法主键名导致 SQL 注入。
        if let Some(primary_key) = parsed.primary_key.as_ref() {
            let _ = ensure_safe_identifier(primary_key, "primaryKey")?;
        }
        if parsed.charset.trim().is_empty() {
            parsed.charset = default_mysql_charset();
        }
        Ok(parsed)
    }

    /// 生成连接 URL（优先使用显式 url）。
    pub fn to_connection_url(&self) -> String {
        if let Some(url) = self.url.as_ref() {
            if !url.trim().is_empty() {
                return url.trim().to_string();
            }
        }
        let username = urlencoding::encode(self.username.trim());
        let password = urlencoding::encode(self.password.trim());
        let host = self.host.trim();
        let database = self.database.trim();
        format!(
            "mysql://{username}:{password}@{host}:{port}/{database}?charset={charset}",
            port = self.port,
            charset = self.charset
        )
    }
}

/// 解析日志/执行共用的安全表名与真实主键列名。
async fn resolve_table_and_primary_key(
    source: &SalesforceSource,
    object_name: &str,
) -> Result<(String, String), AppError> {
    let safe_table = ensure_safe_identifier(object_name, "表名")?;
    let config = MySqlSourceConfig::from_source(source)?;
    let pool = build_mysql_pool(&config).await?;
    let primary_key = resolve_primary_key_column(&pool, &config, &safe_table).await?;
    Ok((safe_table, primary_key))
}

/// 建立 MySQL 连接池。
async fn build_mysql_pool(config: &MySqlSourceConfig) -> Result<MySqlPool, AppError> {
    MySqlPoolOptions::new()
        .max_connections(5)
        .acquire_timeout(Duration::from_secs(8))
        .connect(&config.to_connection_url())
        .await
        .map_err(|error| AppError::Db(format!("连接 MySQL 失败: {error}")))
}

/// 限制 query_records 为只读语句，避免把写操作误放到查询入口。
fn ensure_readonly_query(query_text: &str) -> Result<(), AppError> {
    let normalized = query_text.trim().to_lowercase();
    if normalized.is_empty() {
        return Err(AppError::Biz("查询语句不能为空".to_string()));
    }
    if normalized.starts_with("select")
        || normalized.starts_with("show")
        || normalized.starts_with("with")
        || normalized.starts_with("desc")
        || normalized.starts_with("describe")
    {
        return Ok(());
    }
    Err(AppError::Biz(
        "MySQL 查询仅允许只读语句（SELECT/SHOW/WITH/DESC）".to_string(),
    ))
}

/// 从 SQL 文本中尝试推断首个 FROM 表名（用于自动补齐 Id 字段）。
fn infer_table_name_from_query(query_text: &str) -> Option<String> {
    let lower = query_text.to_lowercase();
    let from_index = lower.find(" from ")?;
    let tail = query_text[from_index + 6..].trim_start();
    let token = tail
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_matches('`')
        .trim_matches(',')
        .trim();
    if token.is_empty() {
        return None;
    }
    if ensure_safe_identifier(token, "表名").is_ok() {
        Some(token.to_string())
    } else {
        None
    }
}

/// 解析表主键（优先 config.primaryKey，否则从 information_schema 读取）。
async fn resolve_primary_key_column(
    pool: &MySqlPool,
    config: &MySqlSourceConfig,
    table_name: &str,
) -> Result<String, AppError> {
    if let Some(primary_key) = config.primary_key.as_ref() {
        return ensure_safe_identifier(primary_key, "primaryKey");
    }
    let rows = sqlx::query(
        r#"
        SELECT column_name
        FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ? AND index_name = 'PRIMARY'
        ORDER BY seq_in_index ASC
        "#,
    )
    .bind(&config.database)
    .bind(table_name)
    .fetch_all(pool)
    .await
    .map_err(|error| AppError::Db(format!("读取主键信息失败: {error}")))?;

    if rows.len() != 1 {
        return Err(AppError::Biz(format!(
            "MySQL 表 `{table_name}` 需要且仅支持单主键（当前检测到 {} 列）",
            rows.len()
        )));
    }
    let primary_key = decode_row_string(&rows[0], 0usize, "主键列名")?;
    ensure_safe_identifier(&primary_key, "主键列名")
}

/// 归一化新增字段：兼容前端传入 Id，并映射到真实主键列。
fn normalize_create_values(
    mut values: HashMap<String, Value>,
    primary_key: &str,
) -> HashMap<String, Value> {
    if !values.contains_key(primary_key) {
        if let Some(id_value) = values.get("Id").cloned() {
            values.insert(primary_key.to_string(), id_value);
        }
    }
    values.remove("Id");
    values
}

/// 归一化更新字段：移除前端兼容字段 Id 和主键本身。
fn normalize_update_values(
    mut values: HashMap<String, Value>,
    primary_key: &str,
) -> HashMap<String, Value> {
    values.remove("Id");
    values.remove(primary_key);
    values
}

/// 收集并排序安全字段列表，保证日志 SQL 与真实执行字段顺序一致。
fn collect_sorted_entries(
    values: HashMap<String, Value>,
) -> Result<Vec<(String, Value)>, AppError> {
    let mut entries = values
        .into_iter()
        .map(|(key, value)| {
            ensure_safe_identifier(&key, "字段名").map(|safe_key| (safe_key, value))
        })
        .collect::<Result<Vec<_>, _>>()?;
    entries.sort_by(|a, b| a.0.cmp(&b.0));
    Ok(entries)
}

/// 转义 SQL 字符串字面量，仅用于日志 SQL 展示。
fn escape_sql_literal(value: &str) -> String {
    value.replace('\\', "\\\\").replace('\'', "\\'")
}

/// 渲染 MySQL 可读值文本，便于系统日志白盒追踪。
fn format_mysql_value_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(item) => {
            if *item {
                "TRUE".to_string()
            } else {
                "FALSE".to_string()
            }
        }
        Value::Number(item) => item.to_string(),
        Value::String(item) => format!("'{}'", escape_sql_literal(item)),
        // 复杂 JSON 统一序列化为字符串字面量，便于观察真实写入内容。
        other => {
            let encoded = serde_json::to_string(other).unwrap_or_else(|_| "null".to_string());
            format!("'{}'", escape_sql_literal(&encoded))
        }
    }
}

/// 构建 MySQL INSERT 日志 SQL。
fn build_insert_preview_sql(
    table_name: &str,
    values: HashMap<String, Value>,
) -> Result<String, AppError> {
    if values.is_empty() {
        return Err(AppError::Biz("新增记录字段不能为空".to_string()));
    }
    let entries = collect_sorted_entries(values)?;
    let columns = entries
        .iter()
        .map(|(key, _)| format!("`{key}`"))
        .collect::<Vec<_>>()
        .join(", ");
    let values_sql = entries
        .iter()
        .map(|(_, value)| format_mysql_value_literal(value))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(format!(
        "INSERT INTO `{table_name}` ({columns}) VALUES ({values_sql});"
    ))
}

/// 构建 MySQL UPDATE 日志 SQL。
fn build_update_preview_sql(
    table_name: &str,
    primary_key: &str,
    record_id: &str,
    values: HashMap<String, Value>,
) -> Result<Option<String>, AppError> {
    if values.is_empty() {
        return Ok(None);
    }
    let entries = collect_sorted_entries(values)?;
    let set_clause = entries
        .iter()
        .map(|(key, value)| format!("`{key}` = {}", format_mysql_value_literal(value)))
        .collect::<Vec<_>>()
        .join(", ");
    Ok(Some(format!(
        "UPDATE `{table_name}` SET {set_clause} WHERE `{primary_key}` = '{}';",
        escape_sql_literal(record_id)
    )))
}

/// 构建 MySQL DELETE 日志 SQL。
fn build_delete_preview_sql(table_name: &str, primary_key: &str, record_id: &str) -> String {
    format!(
        "DELETE FROM `{table_name}` WHERE `{primary_key}` = '{}';",
        escape_sql_literal(record_id)
    )
}

/// 执行 INSERT 语句（支持 pool 或 transaction 执行器）。
async fn execute_insert<'a, E>(
    executor: E,
    table_name: &str,
    values: HashMap<String, Value>,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'a, Database = MySql>,
{
    if values.is_empty() {
        return Err(AppError::Biz("新增记录字段不能为空".to_string()));
    }
    let entries = collect_sorted_entries(values)?;

    let mut builder = QueryBuilder::<MySql>::new(format!("INSERT INTO `{table_name}` ("));
    for (index, (key, _)) in entries.iter().enumerate() {
        if index > 0 {
            builder.push(", ");
        }
        builder.push("`").push(key).push("`");
    }
    builder.push(") VALUES (");
    for (index, (_, value)) in entries.iter().enumerate() {
        if index > 0 {
            builder.push(", ");
        }
        push_bind_json_value(&mut builder, value);
    }
    builder.push(")");

    builder
        .build()
        .execute(executor)
        .await
        .map_err(|error| AppError::Db(format!("新增 MySQL 记录失败: {error}")))?;
    Ok(())
}

/// 执行 UPDATE 语句（支持 pool 或 transaction 执行器）。
async fn execute_update<'a, E>(
    executor: E,
    table_name: &str,
    primary_key: &str,
    record_id: &str,
    values: HashMap<String, Value>,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'a, Database = MySql>,
{
    if values.is_empty() {
        return Ok(());
    }
    let entries = collect_sorted_entries(values)?;

    let mut builder = QueryBuilder::<MySql>::new(format!("UPDATE `{table_name}` SET "));
    for (index, (key, value)) in entries.iter().enumerate() {
        if index > 0 {
            builder.push(", ");
        }
        builder.push("`").push(key).push("` = ");
        push_bind_json_value(&mut builder, value);
    }
    builder.push(" WHERE `").push(primary_key).push("` = ");
    builder.push_bind(record_id);

    builder
        .build()
        .execute(executor)
        .await
        .map_err(|error| AppError::Db(format!("更新 MySQL 记录失败: {error}")))?;
    Ok(())
}

/// 执行 DELETE 语句（支持 pool 或 transaction 执行器）。
async fn execute_delete<'a, E>(
    executor: E,
    table_name: &str,
    primary_key: &str,
    record_id: &str,
) -> Result<(), AppError>
where
    E: sqlx::Executor<'a, Database = MySql>,
{
    let mut builder = QueryBuilder::<MySql>::new(format!(
        "DELETE FROM `{table_name}` WHERE `{primary_key}` = "
    ));
    builder.push_bind(record_id);
    builder
        .build()
        .execute(executor)
        .await
        .map_err(|error| AppError::Db(format!("删除 MySQL 记录失败: {error}")))?;
    Ok(())
}

/// 将 JSON 值绑定到 SQL 参数（优先保留数字/布尔类型）。
fn push_bind_json_value(builder: &mut QueryBuilder<'_, MySql>, value: &Value) {
    match value {
        Value::Null => {
            builder.push_bind(Option::<String>::None);
        }
        Value::Bool(item) => {
            builder.push_bind(*item);
        }
        Value::Number(item) => {
            if let Some(v) = item.as_i64() {
                builder.push_bind(v);
            } else if let Some(v) = item.as_u64() {
                builder.push_bind(v);
            } else if let Some(v) = item.as_f64() {
                builder.push_bind(v);
            } else {
                builder.push_bind(item.to_string());
            }
        }
        Value::String(item) => {
            builder.push_bind(item.clone());
        }
        // 复杂结构首版序列化为 JSON 字符串，避免直接丢失数据。
        Value::Array(_) | Value::Object(_) => {
            builder.push_bind(value.to_string());
        }
    };
}

/// 将数据库行转换为 JSON 记录。
fn row_to_json_record(row: &MySqlRow) -> HashMap<String, Value> {
    let mut item = HashMap::new();
    for column in row.columns() {
        let name = column.name().to_string();
        let mysql_type = column.type_info().name().to_string();
        let value = row_try_get_json_value(row, &name, &mysql_type);
        item.insert(name, value);
    }
    item
}

/// 读取列值并做类型映射（按 MySQL 列类型优先解码，避免日期/时间被误读为空）。
fn row_try_get_json_value(row: &MySqlRow, column_name: &str, mysql_type: &str) -> Value {
    let normalized = normalize_mysql_type_name(mysql_type);

    if is_mysql_date_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<NaiveDate>, _>(column_name) {
            return value
                .map(|item| Value::String(item.format("%Y-%m-%d").to_string()))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_datetime_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<NaiveDateTime>, _>(column_name) {
            return value
                .map(|item| Value::String(item.format("%Y-%m-%d %H:%M:%S%.f").to_string()))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_time_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<MySqlTime>, _>(column_name) {
            return value
                .map(format_mysql_time_value)
                .map(Value::String)
                .unwrap_or(Value::Null);
        }
        if let Ok(value) = row.try_get::<Option<NaiveTime>, _>(column_name) {
            return value
                .map(|item| Value::String(item.format("%H:%M:%S%.f").to_string()))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_bool_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<bool>, _>(column_name) {
            // MySQL BOOLEAN 本质是 TINYINT(1)，统一按数值输出，避免前端出现 true/false 展示偏差。
            return value
                .map(|item| bool_to_json_number(item))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_signed_integer_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<i64>, _>(column_name) {
            return value
                .map(|item| Value::Number(item.into()))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_unsigned_integer_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<u64>, _>(column_name) {
            // BIGINT UNSIGNED 可能超过 JS Number 安全整数范围，统一按字符串返回避免前端精度丢失。
            if normalized == "bigint unsigned" {
                return value
                    .map(|item| Value::String(item.to_string()))
                    .unwrap_or(Value::Null);
            }
            return value
                .map(|item| Value::Number(serde_json::Number::from(item)))
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_decimal_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<String>, _>(column_name) {
            return value.map(Value::String).unwrap_or(Value::Null);
        }
        if let Ok(value) = row.try_get::<Option<f64>, _>(column_name) {
            return value
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .unwrap_or(Value::Null);
        }
    }

    if is_mysql_float_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<f64>, _>(column_name) {
            return value
                .and_then(serde_json::Number::from_f64)
                .map(Value::Number)
                .unwrap_or(Value::Null);
        }
    }

    // YEAR 按数字展示，避免被字符串比较影响排序行为。
    if normalized == "year" {
        if let Ok(value) = row.try_get::<Option<i32>, _>(column_name) {
            return value
                .map(|item| Value::Number(item.into()))
                .unwrap_or(Value::Null);
        }
    }

    // JSON 优先解码为结构化值，前端可直接展示对象/数组内容。
    if is_mysql_json_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<Json<Value>>, _>(column_name) {
            return value.map(|item| item.0).unwrap_or(Value::Null);
        }
        if let Ok(value) = row.try_get::<Option<String>, _>(column_name) {
            return value.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if is_mysql_textual_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<String>, _>(column_name) {
            return value.map(Value::String).unwrap_or(Value::Null);
        }
    }

    if is_mysql_binary_type(&normalized) {
        if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(column_name) {
            return value
                .map(|bytes| {
                    if normalized == "bit" {
                        return Value::String(format_mysql_bit_value(&bytes));
                    }
                    if is_mysql_geometry_type(&normalized) {
                        return Value::String(format_mysql_geometry_value(&bytes));
                    }
                    Value::String(format_mysql_binary_value(&bytes))
                })
                .unwrap_or(Value::Null);
        }
    }

    // 兜底顺序：按最常见标量再尝试一次，防止驱动类型名与预期不一致导致丢值。
    if let Ok(value) = row.try_get::<Option<i64>, _>(column_name) {
        return value
            .map(|item| Value::Number(item.into()))
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<u64>, _>(column_name) {
        // 兜底分支无法准确获知 unsigned 具体位宽，保留数值语义避免影响普通整数字段。
        return value
            .map(|item| Value::Number(serde_json::Number::from(item)))
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<f64>, _>(column_name) {
        return value
            .and_then(serde_json::Number::from_f64)
            .map(Value::Number)
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<bool>, _>(column_name) {
        return value
            .map(|item| bool_to_json_number(item))
            .unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<String>, _>(column_name) {
        return value.map(Value::String).unwrap_or(Value::Null);
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(column_name) {
        return value
            .map(|bytes| Value::String(format_mysql_binary_value(&bytes)))
            .unwrap_or(Value::Null);
    }
    Value::Null
}

/// 标准化 MySQL 列类型名，统一转小写并压缩空白字符。
fn normalize_mysql_type_name(raw: &str) -> String {
    raw.split_whitespace()
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join(" ")
        .to_ascii_lowercase()
}

/// 判断是否为 DATE 类型。
fn is_mysql_date_type(mysql_type: &str) -> bool {
    mysql_type == "date"
}

/// 判断是否为 DATETIME/TIMESTAMP 类型。
fn is_mysql_datetime_type(mysql_type: &str) -> bool {
    mysql_type == "datetime" || mysql_type == "timestamp"
}

/// 判断是否为 TIME 类型。
fn is_mysql_time_type(mysql_type: &str) -> bool {
    mysql_type == "time"
}

/// 判断是否为布尔语义类型。
fn is_mysql_bool_type(mysql_type: &str) -> bool {
    mysql_type == "bool" || mysql_type == "boolean"
}

/// 判断是否为有符号整数类型。
fn is_mysql_signed_integer_type(mysql_type: &str) -> bool {
    matches!(
        mysql_type,
        "tinyint" | "smallint" | "mediumint" | "int" | "integer" | "bigint"
    )
}

/// 判断是否为无符号整数类型。
fn is_mysql_unsigned_integer_type(mysql_type: &str) -> bool {
    matches!(
        mysql_type,
        "tinyint unsigned"
            | "smallint unsigned"
            | "mediumint unsigned"
            | "int unsigned"
            | "integer unsigned"
            | "bigint unsigned"
    )
}

/// 判断是否为定点数类型。
fn is_mysql_decimal_type(mysql_type: &str) -> bool {
    matches!(mysql_type, "decimal" | "newdecimal" | "numeric")
}

/// 判断是否为浮点数类型。
fn is_mysql_float_type(mysql_type: &str) -> bool {
    matches!(mysql_type, "float" | "double" | "real")
}

/// 判断是否为 JSON 类型。
fn is_mysql_json_type(mysql_type: &str) -> bool {
    mysql_type == "json"
}

/// 判断是否为文本语义类型（含枚举与集合）。
fn is_mysql_textual_type(mysql_type: &str) -> bool {
    matches!(
        mysql_type,
        "char" | "varchar" | "tinytext" | "text" | "mediumtext" | "longtext" | "enum" | "set"
    )
}

/// 判断是否为二进制语义类型。
fn is_mysql_binary_type(mysql_type: &str) -> bool {
    matches!(
        mysql_type,
        "binary"
            | "varbinary"
            | "tinyblob"
            | "blob"
            | "mediumblob"
            | "longblob"
            | "bit"
            | "geometry"
            | "point"
            | "linestring"
            | "polygon"
            | "multipoint"
            | "multilinestring"
            | "multipolygon"
            | "geometrycollection"
    )
}

/// 判断是否为空间类型（几何对象）。
fn is_mysql_geometry_type(mysql_type: &str) -> bool {
    matches!(
        mysql_type,
        "geometry"
            | "point"
            | "linestring"
            | "polygon"
            | "multipoint"
            | "multilinestring"
            | "multipolygon"
            | "geometrycollection"
    )
}

/// MySQL TIME 文本格式化：支持负值与 24 小时以上区间。
fn format_mysql_time_value(value: MySqlTime) -> String {
    let sign = if value.sign() == MySqlTimeSign::Negative {
        "-"
    } else {
        ""
    };
    let base = format!(
        "{sign}{:02}:{:02}:{:02}",
        value.hours(),
        value.minutes(),
        value.seconds()
    );
    let microseconds = value.microseconds();
    if microseconds == 0 {
        return base;
    }
    let fraction = format!("{microseconds:06}");
    let trimmed = fraction.trim_end_matches('0');
    format!("{base}.{trimmed}")
}

/// BIT 字段可视化：输出位串并附带十六进制，便于排查二进制位值。
fn format_mysql_bit_value(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "<BIT 0 bytes> b''".to_string();
    }
    let total_bytes = bytes.len();
    let bits = bytes
        .iter()
        .map(|item| format!("{item:08b}"))
        .collect::<Vec<_>>()
        .join("");
    format!(
        "<BIT {total_bytes} bytes> b'{bits}' ({})",
        format_hex_with_prefix(bytes, bytes.len())
    )
}

/// Geometry 字段可视化：参考 Navicat/DataGrip，展示类型占位、长度与十六进制预览。
fn format_mysql_geometry_value(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "<GEOMETRY 0 bytes>".to_string();
    }
    let total_bytes = bytes.len();
    // MySQL 内部 Geometry 二进制通常以 4 字节 SRID 开头，后续为 WKB。
    let (srid, wkb_bytes) = parse_mysql_geometry_payload(bytes);
    let geometry_type = detect_wkb_geometry_type(wkb_bytes).unwrap_or("UNKNOWN");
    let preview = format_hex_with_prefix(wkb_bytes, 64);
    match srid {
        Some(value) => {
            format!("<GEOMETRY({geometry_type}) SRID={value}, {total_bytes} bytes> {preview}")
        }
        None => format!("<GEOMETRY({geometry_type}) {total_bytes} bytes> {preview}"),
    }
}

/// 二进制字段可视化：参考 Navicat/DataGrip，展示类型占位、长度与十六进制预览。
fn format_mysql_binary_value(bytes: &[u8]) -> String {
    if bytes.is_empty() {
        return "0x".to_string();
    }
    let total_bytes = bytes.len();
    let preview = format_hex_with_prefix(bytes, 64);
    if total_bytes > 64 {
        return format!("<BINARY {total_bytes} bytes> {preview}");
    }
    preview
}

/// 将字节数组格式化为带 0x 前缀的十六进制字符串，并支持截断预览。
fn format_hex_with_prefix(bytes: &[u8], max_bytes: usize) -> String {
    if bytes.is_empty() {
        return "0x".to_string();
    }
    let take = bytes.len().min(max_bytes);
    let mut output = String::from("0x");
    for byte in &bytes[..take] {
        output.push_str(&format!("{byte:02X}"));
    }
    if bytes.len() > max_bytes {
        output.push_str("...");
    }
    output
}

/// 解析 MySQL Geometry 负载：优先识别 SRID + WKB，失败时回退原始字节。
fn parse_mysql_geometry_payload(bytes: &[u8]) -> (Option<u32>, &[u8]) {
    if bytes.len() < 5 {
        return (None, bytes);
    }
    // WKB 起始字节应为 0 或 1（字节序标记），若第 5 字节不满足则认为无 SRID 头。
    if bytes[4] != 0 && bytes[4] != 1 {
        return (None, bytes);
    }
    let srid = u32::from_le_bytes([bytes[0], bytes[1], bytes[2], bytes[3]]);
    (Some(srid), &bytes[4..])
}

/// 识别 WKB 几何类型名：用于显示 `<GEOMETRY(type)>` 头部标签。
fn detect_wkb_geometry_type(wkb: &[u8]) -> Option<&'static str> {
    if wkb.len() < 5 {
        return None;
    }
    let byte_order = wkb[0];
    let code = match byte_order {
        0 => u32::from_be_bytes([wkb[1], wkb[2], wkb[3], wkb[4]]),
        1 => u32::from_le_bytes([wkb[1], wkb[2], wkb[3], wkb[4]]),
        _ => return None,
    };
    // 兼容常见 EWKB 扩展标志位，仅保留低 16 位基础类型码。
    let base_code = code & 0xFFFF;
    match base_code {
        1 => Some("POINT"),
        2 => Some("LINESTRING"),
        3 => Some("POLYGON"),
        4 => Some("MULTIPOINT"),
        5 => Some("MULTILINESTRING"),
        6 => Some("MULTIPOLYGON"),
        7 => Some("GEOMETRYCOLLECTION"),
        _ => None,
    }
}

/// 将布尔值转换为 JSON 数字（false=0, true=1），与 MySQL tinyint 语义对齐。
fn bool_to_json_number(value: bool) -> Value {
    Value::Number(serde_json::Number::from(if value { 1 } else { 0 }))
}

/// 识别字符串是否为安全标识符，仅允许字母/数字/下划线。
fn ensure_safe_identifier(raw: &str, label: &str) -> Result<String, AppError> {
    let normalized = raw.trim().to_string();
    if normalized.is_empty() {
        return Err(AppError::Biz(format!("{label} 不能为空")));
    }
    if normalized
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || ch == '_')
    {
        return Ok(normalized);
    }
    Err(AppError::Biz(format!(
        "{label} 包含非法字符，仅允许字母/数字/下划线: {raw}"
    )))
}

/// 将 JSON 值转换为字符串（用于返回新记录主键）。
fn value_to_string(value: &Value) -> String {
    match value {
        Value::Null => "".to_string(),
        Value::Bool(item) => item.to_string(),
        Value::Number(item) => item.to_string(),
        Value::String(item) => item.clone(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

/// 读取指定列并统一解码为字符串：兼容 VARCHAR/VARBINARY 等差异返回类型。
fn decode_row_string(row: &MySqlRow, index: usize, label: &str) -> Result<String, AppError> {
    if let Ok(value) = row.try_get::<String, _>(index) {
        return Ok(value);
    }
    if let Ok(value) = row.try_get::<Vec<u8>, _>(index) {
        return Ok(String::from_utf8_lossy(&value).to_string());
    }
    Err(AppError::Db(format!("读取{label}失败: 无法解码为字符串")))
}

/// 读取可空字符串列：兼容数据库返回 VARCHAR/VARBINARY 与 NULL。
fn decode_optional_row_string(row: &MySqlRow, index: usize) -> Option<String> {
    if let Ok(value) = row.try_get::<Option<String>, _>(index) {
        return value;
    }
    if let Ok(value) = row.try_get::<Option<Vec<u8>>, _>(index) {
        return value.map(|bytes| String::from_utf8_lossy(&bytes).to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::{
        build_delete_preview_sql, build_insert_preview_sql, build_update_preview_sql,
        normalize_create_values, normalize_update_values,
    };
    use serde_json::{json, Value};
    use std::collections::HashMap;

    /// 构造测试用字段映射，减少样板代码。
    fn build_values(entries: &[(&str, Value)]) -> HashMap<String, Value> {
        entries
            .iter()
            .map(|(key, value)| ((*key).to_string(), value.clone()))
            .collect()
    }

    #[test]
    fn normalize_create_values_maps_id_to_real_primary_key() {
        let normalized = normalize_create_values(
            build_values(&[("Id", json!("A-100")), ("name", json!("订单A"))]),
            "order_id",
        );

        assert_eq!(normalized.get("order_id"), Some(&json!("A-100")));
        assert_eq!(normalized.get("Id"), None);
        assert_eq!(normalized.get("name"), Some(&json!("订单A")));
    }

    #[test]
    fn build_update_preview_sql_skips_primary_key_and_id_fields() {
        let normalized = normalize_update_values(
            build_values(&[
                ("Id", json!("A-100")),
                ("order_id", json!("A-100")),
                ("status", json!("DONE")),
            ]),
            "order_id",
        );
        let sql = build_update_preview_sql("orders", "order_id", "A-100", normalized)
            .expect("更新日志 SQL 应该构造成功")
            .expect("存在可更新字段时应该生成 SQL");

        assert_eq!(
            sql,
            "UPDATE `orders` SET `status` = 'DONE' WHERE `order_id` = 'A-100';"
        );
    }

    #[test]
    fn build_update_preview_sql_returns_none_when_no_mutable_fields() {
        let normalized = normalize_update_values(
            build_values(&[("Id", json!("A-100")), ("order_id", json!("A-100"))]),
            "order_id",
        );
        let sql = build_update_preview_sql("orders", "order_id", "A-100", normalized)
            .expect("无可更新字段时也不应报错");

        assert!(sql.is_none());
    }

    #[test]
    fn preview_sql_uses_resolved_primary_key_name() {
        let normalized = normalize_create_values(
            build_values(&[("Id", json!("A-100")), ("status", json!("NEW"))]),
            "order_id",
        );
        let insert_sql =
            build_insert_preview_sql("orders", normalized).expect("新增日志 SQL 应该构造成功");
        let delete_sql = build_delete_preview_sql("orders", "order_id", "A-100");

        assert_eq!(
            insert_sql,
            "INSERT INTO `orders` (`order_id`, `status`) VALUES ('A-100', 'NEW');"
        );
        assert_eq!(
            delete_sql,
            "DELETE FROM `orders` WHERE `order_id` = 'A-100';"
        );
    }
}
