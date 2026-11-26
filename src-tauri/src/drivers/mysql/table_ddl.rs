use serde::{Deserialize, Serialize};
use sqlx::{MySqlPool, Row};

use crate::drivers::mysql::provider::{
    decode_optional_row_string, decode_row_string, ensure_safe_identifier, escape_sql_literal,
};
use crate::error::AppError;

/// 表列结构定义（用于新建表与编辑表结构对比）。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableColumnSpec {
    /// 原始列名（仅编辑已有列时有值，用于检测重命名）。
    #[serde(default)]
    pub original_name: Option<String>,
    /// 当前列名。
    pub name: String,
    /// 数据类型定义（如 `varchar(128)`、`bigint unsigned`、`int`）。
    pub data_type: String,
    /// 是否允许 NULL。
    pub nullable: bool,
    /// 是否为主键列。
    pub is_primary_key: bool,
    /// 是否自增（AUTO_INCREMENT）。
    pub auto_increment: bool,
    /// 默认值表达式（空表示无默认值；特殊值 `CURRENT_TIMESTAMP` 等按关键字处理）。
    #[serde(default)]
    pub default_value: Option<String>,
    /// 列注释。
    #[serde(default)]
    pub comment: String,
    /// 是否标记为删除（仅编辑模式有效）。
    #[serde(default)]
    pub marked_for_drop: bool,
}

/// 表索引定义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableIndexSpec {
    /// 原始索引名（编辑已有索引时有值）。
    #[serde(default)]
    pub original_name: Option<String>,
    /// 索引名。
    pub name: String,
    /// 索引包含的列名列表（按顺序）。
    pub columns: Vec<String>,
    /// 是否唯一索引。
    pub unique: bool,
    /// 索引方法（BTREE / HASH）。
    #[serde(default = "default_index_type")]
    pub index_type: String,
    /// 是否标记为删除。
    #[serde(default)]
    pub marked_for_drop: bool,
}

fn default_index_type() -> String {
    "BTREE".to_string()
}

/// 表外键约束定义。
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct TableForeignKeySpec {
    /// 原始外键约束名。
    #[serde(default)]
    pub original_name: Option<String>,
    /// 约束名称。
    pub name: String,
    /// 本表列名。
    pub column: String,
    /// 引用目标表名。
    pub ref_table: String,
    /// 引用目标列名。
    pub ref_column: String,
    /// ON UPDATE 规则。
    #[serde(default = "default_fk_rule")]
    pub on_update: String,
    /// ON DELETE 规则。
    #[serde(default = "default_fk_rule")]
    pub on_delete: String,
    /// 是否标记为删除。
    #[serde(default)]
    pub marked_for_drop: bool,
}

fn default_fk_rule() -> String {
    "RESTRICT".to_string()
}

/// 完整表结构设计模型（同时用于读取现有表结构、生成 CREATE/ALTER SQL 预览）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TableStructureSpec {
    /// 原始表名（新建表时为空或 None）。
    #[serde(default)]
    pub original_table_name: Option<String>,
    /// 目标表名。
    pub table_name: String,
    /// 存储引擎（默认 InnoDB）。
    #[serde(default = "default_engine")]
    pub engine: String,
    /// 默认字符集（默认 utf8mb4）。
    #[serde(default = "default_charset")]
    pub charset: String,
    /// 表注释。
    #[serde(default)]
    pub comment: String,
    /// 列定义列表。
    pub columns: Vec<TableColumnSpec>,
    /// 索引定义列表（不含 PRIMARY）。
    #[serde(default)]
    pub indexes: Vec<TableIndexSpec>,
    /// 外键定义列表。
    #[serde(default)]
    pub foreign_keys: Vec<TableForeignKeySpec>,
}

fn default_engine() -> String {
    "InnoDB".to_string()
}

fn default_charset() -> String {
    "utf8mb4".to_string()
}

/// 读取现有 MySQL 表的完整结构模型，供表设计器编辑回填。
pub async fn get_mysql_table_structure_spec(
    pool: &MySqlPool,
    database: &str,
    table_name: &str,
) -> Result<TableStructureSpec, AppError> {
    let safe_table = ensure_safe_identifier(table_name, "表名")?;

    // 1. 读取表级元信息（引擎、注释）。
    let status_row = sqlx::query(
        "SELECT engine, table_comment FROM information_schema.tables WHERE table_schema = ? AND table_name = ? LIMIT 1",
    )
    .bind(database)
    .bind(&safe_table)
    .fetch_optional(pool)
    .await
    .map_err(|e| AppError::Db(format!("读取表元信息失败: {e}")))?;

    let (engine, comment) = if let Some(row) = status_row {
        (
            decode_optional_row_string(&row, 0).unwrap_or_else(default_engine),
            decode_optional_row_string(&row, 1).unwrap_or_default(),
        )
    } else {
        return Err(AppError::Biz(format!("未找到表: {safe_table}")));
    };

    // 2. 读取列定义。
    let col_rows = sqlx::query(
        r#"
        SELECT column_name, column_type, is_nullable, column_key, extra, column_default, column_comment
        FROM information_schema.columns
        WHERE table_schema = ? AND table_name = ?
        ORDER BY ordinal_position ASC
        "#,
    )
    .bind(database)
    .bind(&safe_table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Db(format!("读取列结构失败: {e}")))?;

    let mut columns = Vec::with_capacity(col_rows.len());
    for row in col_rows {
        let col_name = decode_row_string(&row, 0, "列名")?;
        let col_type = decode_row_string(&row, 1, "列类型")?;
        let is_nullable = decode_optional_row_string(&row, 2)
            .map(|v| v.eq_ignore_ascii_case("YES"))
            .unwrap_or(true);
        let col_key = decode_optional_row_string(&row, 3).unwrap_or_default();
        let extra = decode_optional_row_string(&row, 4).unwrap_or_default();
        let default_value = decode_optional_row_string(&row, 5);
        let col_comment = decode_optional_row_string(&row, 6).unwrap_or_default();

        columns.push(TableColumnSpec {
            original_name: Some(col_name.clone()),
            name: col_name,
            data_type: col_type,
            nullable: is_nullable,
            is_primary_key: col_key.eq_ignore_ascii_case("PRI"),
            auto_increment: extra.to_ascii_lowercase().contains("auto_increment"),
            default_value,
            comment: col_comment,
            marked_for_drop: false,
        });
    }

    // 3. 读取非主键索引定义。
    let idx_rows = sqlx::query(
        r#"
        SELECT
            index_name,
            non_unique,
            index_type,
            GROUP_CONCAT(column_name ORDER BY seq_in_index SEPARATOR ',') AS cols
        FROM information_schema.statistics
        WHERE table_schema = ? AND table_name = ? AND index_name <> 'PRIMARY'
        GROUP BY index_name, non_unique, index_type
        ORDER BY index_name ASC
        "#,
    )
    .bind(database)
    .bind(&safe_table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Db(format!("读取索引结构失败: {e}")))?;

    let mut indexes = Vec::with_capacity(idx_rows.len());
    for row in idx_rows {
        let idx_name = decode_row_string(&row, 0, "索引名")?;
        let non_unique: i64 = row.try_get(1).unwrap_or(1);
        let idx_type = decode_optional_row_string(&row, 2).unwrap_or_else(default_index_type);
        let cols_raw = decode_optional_row_string(&row, 3).unwrap_or_default();
        let cols: Vec<String> = cols_raw
            .split(',')
            .map(|s| s.trim().to_string())
            .filter(|s| !s.is_empty())
            .collect();
        if cols.is_empty() {
            continue;
        }
        indexes.push(TableIndexSpec {
            original_name: Some(idx_name.clone()),
            name: idx_name,
            columns: cols,
            unique: non_unique == 0,
            index_type: idx_type,
            marked_for_drop: false,
        });
    }

    // 4. 读取外键约束定义。
    let fk_rows = sqlx::query(
        r#"
        SELECT
            tc.constraint_name,
            MIN(kcu.column_name) AS col_name,
            MIN(kcu.referenced_table_name) AS ref_table,
            MIN(kcu.referenced_column_name) AS ref_col,
            MIN(rc.update_rule) AS update_rule,
            MIN(rc.delete_rule) AS delete_rule
        FROM information_schema.table_constraints tc
        JOIN information_schema.key_column_usage kcu
            ON tc.constraint_schema = kcu.constraint_schema
            AND tc.table_name = kcu.table_name
            AND tc.constraint_name = kcu.constraint_name
        LEFT JOIN information_schema.referential_constraints rc
            ON tc.constraint_schema = rc.constraint_schema
            AND tc.table_name = rc.table_name
            AND tc.constraint_name = rc.constraint_name
        WHERE tc.table_schema = ? AND tc.table_name = ? AND tc.constraint_type = 'FOREIGN KEY'
        GROUP BY tc.constraint_name
        ORDER BY tc.constraint_name ASC
        "#,
    )
    .bind(database)
    .bind(&safe_table)
    .fetch_all(pool)
    .await
    .map_err(|e| AppError::Db(format!("读取外键结构失败: {e}")))?;

    let mut foreign_keys = Vec::with_capacity(fk_rows.len());
    for row in fk_rows {
        let fk_name = decode_row_string(&row, 0, "外键名")?;
        let col = decode_optional_row_string(&row, 1).unwrap_or_default();
        let ref_table = decode_optional_row_string(&row, 2).unwrap_or_default();
        let ref_col = decode_optional_row_string(&row, 3).unwrap_or_default();
        if col.is_empty() || ref_table.is_empty() || ref_col.is_empty() {
            continue;
        }
        foreign_keys.push(TableForeignKeySpec {
            original_name: Some(fk_name.clone()),
            name: fk_name,
            column: col,
            ref_table,
            ref_column: ref_col,
            on_update: decode_optional_row_string(&row, 4).unwrap_or_else(default_fk_rule),
            on_delete: decode_optional_row_string(&row, 5).unwrap_or_else(default_fk_rule),
            marked_for_drop: false,
        });
    }

    Ok(TableStructureSpec {
        original_table_name: Some(safe_table.clone()),
        table_name: safe_table,
        engine,
        charset: default_charset(),
        comment,
        columns,
        indexes,
        foreign_keys,
    })
}

/// 格式化单列定义 SQL 片段（如 `` `id` bigint NOT NULL AUTO_INCREMENT COMMENT '主键' ``）。
fn format_column_definition_sql(col: &TableColumnSpec) -> Result<String, AppError> {
    let safe_col = ensure_safe_identifier(&col.name, "列名")?;
    let raw_type = col.data_type.trim();
    if raw_type.is_empty() {
        return Err(AppError::Biz(format!("列 {safe_col} 的数据类型不能为空")));
    }

    let mut parts = vec![format!("`{safe_col}` {raw_type}")];
    if col.nullable && !col.is_primary_key {
        parts.push("NULL".to_string());
    } else {
        parts.push("NOT NULL".to_string());
    }

    if col.auto_increment {
        parts.push("AUTO_INCREMENT".to_string());
    } else if let Some(def) = col.default_value.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
        let upper = def.to_ascii_uppercase();
        if upper == "NULL" || upper == "CURRENT_TIMESTAMP" || upper.starts_with("CURRENT_TIMESTAMP(") {
            parts.push(format!("DEFAULT {def}"));
        } else {
            parts.push(format!("DEFAULT '{}'", escape_sql_literal(def)));
        }
    }

    if !col.comment.trim().is_empty() {
        parts.push(format!("COMMENT '{}'", escape_sql_literal(col.comment.trim())));
    }

    Ok(parts.join(" "))
}

/// 根据结构模型生成 `CREATE TABLE` SQL 预览语句列表。
pub fn preview_create_table_sql(spec: &TableStructureSpec) -> Result<Vec<String>, AppError> {
    let safe_table = ensure_safe_identifier(&spec.table_name, "表名")?;
    let active_cols: Vec<&TableColumnSpec> =
        spec.columns.iter().filter(|c| !c.marked_for_drop).collect();
    if active_cols.is_empty() {
        return Err(AppError::Biz("至少需要定义一列才能创建表".to_string()));
    }

    let mut lines = Vec::new();
    for col in &active_cols {
        lines.push(format!("  {}", format_column_definition_sql(col)?));
    }

    let pk_cols: Vec<String> = active_cols
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| ensure_safe_identifier(&c.name, "主键列名").map(|n| format!("`{n}`")))
        .collect::<Result<Vec<_>, _>>()?;
    if !pk_cols.is_empty() {
        lines.push(format!("  PRIMARY KEY ({})", pk_cols.join(", ")));
    }

    for idx in spec.indexes.iter().filter(|i| !i.marked_for_drop && !i.columns.is_empty()) {
        let safe_idx = ensure_safe_identifier(&idx.name, "索引名")?;
        let cols_sql = idx
            .columns
            .iter()
            .map(|c| ensure_safe_identifier(c, "索引列名").map(|n| format!("`{n}`")))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        let prefix = if idx.unique { "UNIQUE KEY" } else { "KEY" };
        let method = if idx.index_type.trim().is_empty() {
            "BTREE"
        } else {
            idx.index_type.trim()
        };
        lines.push(format!("  {prefix} `{safe_idx}` ({cols_sql}) USING {method}"));
    }

    for fk in spec.foreign_keys.iter().filter(|f| !f.marked_for_drop) {
        let safe_fk = ensure_safe_identifier(&fk.name, "外键名")?;
        let safe_col = ensure_safe_identifier(&fk.column, "外键列名")?;
        let safe_ref_table = ensure_safe_identifier(&fk.ref_table, "引用表名")?;
        let safe_ref_col = ensure_safe_identifier(&fk.ref_column, "引用列名")?;
        lines.push(format!(
            "  CONSTRAINT `{safe_fk}` FOREIGN KEY (`{safe_col}`) REFERENCES `{safe_ref_table}` (`{safe_ref_col}`) ON UPDATE {} ON DELETE {}",
            fk.on_update.trim(),
            fk.on_delete.trim()
        ));
    }

    let engine = if spec.engine.trim().is_empty() {
        "InnoDB"
    } else {
        spec.engine.trim()
    };
    let charset = if spec.charset.trim().is_empty() {
        "utf8mb4"
    } else {
        spec.charset.trim()
    };
    let comment_clause = if spec.comment.trim().is_empty() {
        String::new()
    } else {
        format!(" COMMENT='{}'", escape_sql_literal(spec.comment.trim()))
    };

    let create_sql = format!(
        "CREATE TABLE `{safe_table}` (\n{}\n) ENGINE={engine} DEFAULT CHARSET={charset}{comment_clause};",
        lines.join(",\n")
    );
    Ok(vec![create_sql])
}

/// 对比原始结构与目标结构，生成 `ALTER TABLE` 增量迁移 SQL 预览列表。
pub fn preview_alter_table_sql(
    original: &TableStructureSpec,
    target: &TableStructureSpec,
) -> Result<Vec<String>, AppError> {
    let orig_table = ensure_safe_identifier(&original.table_name, "原表名")?;
    let next_table = ensure_safe_identifier(&target.table_name, "新表名")?;
    let mut statements = Vec::new();
    let mut alter_clauses = Vec::new();

    // 1. 删除列与外键、索引（先删外键/索引避免列删除冲突）。
    for fk in target.foreign_keys.iter().filter(|f| f.marked_for_drop) {
        if let Some(orig_name) = fk.original_name.as_deref().filter(|v| !v.is_empty()) {
            let safe_fk = ensure_safe_identifier(orig_name, "外键名")?;
            alter_clauses.push(format!("DROP FOREIGN KEY `{safe_fk}`"));
        }
    }
    for idx in target.indexes.iter().filter(|i| i.marked_for_drop) {
        if let Some(orig_name) = idx.original_name.as_deref().filter(|v| !v.is_empty()) {
            let safe_idx = ensure_safe_identifier(orig_name, "索引名")?;
            alter_clauses.push(format!("DROP INDEX `{safe_idx}`"));
        }
    }
    for col in target.columns.iter().filter(|c| c.marked_for_drop) {
        if let Some(orig_name) = col.original_name.as_deref().filter(|v| !v.is_empty()) {
            let safe_col = ensure_safe_identifier(orig_name, "列名")?;
            alter_clauses.push(format!("DROP COLUMN `{safe_col}`"));
        }
    }

    // 2. 新增与修改列。
    let active_cols: Vec<&TableColumnSpec> =
        target.columns.iter().filter(|c| !c.marked_for_drop).collect();
    for (idx, col) in active_cols.iter().enumerate() {
        let def_sql = format_column_definition_sql(col)?;
        let pos_clause = if idx == 0 {
            " FIRST".to_string()
        } else {
            let prev_name = ensure_safe_identifier(&active_cols[idx - 1].name, "前序列名")?;
            format!(" AFTER `{prev_name}`")
        };

        if let Some(orig_name) = col.original_name.as_deref().filter(|v| !v.is_empty()) {
            let orig_col = original.columns.iter().find(|c| c.name == orig_name);
            let same_pos = original
                .columns
                .get(idx)
                .map(|c| c.name == orig_name)
                .unwrap_or(false);
            let changed = orig_col.map(|o| o != *col).unwrap_or(true) || !same_pos;
            if changed {
                let safe_orig = ensure_safe_identifier(orig_name, "原列名")?;
                let order_suffix = if !same_pos { pos_clause } else { String::new() };
                if safe_orig != col.name.trim() {
                    alter_clauses.push(format!("CHANGE COLUMN `{safe_orig}` {def_sql}{order_suffix}"));
                } else {
                    alter_clauses.push(format!("MODIFY COLUMN {def_sql}{order_suffix}"));
                }
            }
        } else {
            alter_clauses.push(format!("ADD COLUMN {def_sql}{pos_clause}"));
        }
    }

    // 3. 主键变更检测。
    let orig_pks: Vec<&str> = original
        .columns
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.as_str())
        .collect();
    let next_pks: Vec<String> = active_cols
        .iter()
        .filter(|c| c.is_primary_key)
        .map(|c| c.name.clone())
        .collect();
    if orig_pks != next_pks.iter().map(String::as_str).collect::<Vec<_>>() {
        if !orig_pks.is_empty() {
            alter_clauses.push("DROP PRIMARY KEY".to_string());
        }
        if !next_pks.is_empty() {
            let pk_cols = next_pks
                .iter()
                .map(|c| ensure_safe_identifier(c, "主键列名").map(|n| format!("`{n}`")))
                .collect::<Result<Vec<_>, _>>()?
                .join(", ");
            alter_clauses.push(format!("ADD PRIMARY KEY ({pk_cols})"));
        }
    }

    // 4. 新增或变更索引。
    for idx in target.indexes.iter().filter(|i| !i.marked_for_drop && !i.columns.is_empty()) {
        let orig_idx = idx
            .original_name
            .as_deref()
            .and_then(|n| original.indexes.iter().find(|o| o.name == n));
        if orig_idx.map(|o| o == idx).unwrap_or(false) {
            continue;
        }
        if let Some(old_name) = idx.original_name.as_deref().filter(|v| !v.is_empty()) {
            let safe_old = ensure_safe_identifier(old_name, "原索引名")?;
            alter_clauses.push(format!("DROP INDEX `{safe_old}`"));
        }
        let safe_new = ensure_safe_identifier(&idx.name, "索引名")?;
        let cols_sql = idx
            .columns
            .iter()
            .map(|c| ensure_safe_identifier(c, "索引列名").map(|n| format!("`{n}`")))
            .collect::<Result<Vec<_>, _>>()?
            .join(", ");
        let prefix = if idx.unique { "ADD UNIQUE INDEX" } else { "ADD INDEX" };
        let method = if idx.index_type.trim().is_empty() {
            "BTREE"
        } else {
            idx.index_type.trim()
        };
        alter_clauses.push(format!("{prefix} `{safe_new}` ({cols_sql}) USING {method}"));
    }

    // 5. 新增或变更外键。
    for fk in target.foreign_keys.iter().filter(|f| !f.marked_for_drop) {
        let orig_fk = fk
            .original_name
            .as_deref()
            .and_then(|n| original.foreign_keys.iter().find(|o| o.name == n));
        if orig_fk.map(|o| o == fk).unwrap_or(false) {
            continue;
        }
        if let Some(old_name) = fk.original_name.as_deref().filter(|v| !v.is_empty()) {
            let safe_old = ensure_safe_identifier(old_name, "原外键名")?;
            alter_clauses.push(format!("DROP FOREIGN KEY `{safe_old}`"));
        }
        let safe_fk = ensure_safe_identifier(&fk.name, "外键名")?;
        let safe_col = ensure_safe_identifier(&fk.column, "外键列名")?;
        let safe_ref_table = ensure_safe_identifier(&fk.ref_table, "引用表名")?;
        let safe_ref_col = ensure_safe_identifier(&fk.ref_column, "引用列名")?;
        alter_clauses.push(format!(
            "ADD CONSTRAINT `{safe_fk}` FOREIGN KEY (`{safe_col}`) REFERENCES `{safe_ref_table}` (`{safe_ref_col}`) ON UPDATE {} ON DELETE {}",
            fk.on_update.trim(),
            fk.on_delete.trim()
        ));
    }

    // 6. 表注释变更。
    if original.comment.trim() != target.comment.trim() {
        alter_clauses.push(format!("COMMENT = '{}'", escape_sql_literal(target.comment.trim())));
    }

    if !alter_clauses.is_empty() {
        statements.push(format!(
            "ALTER TABLE `{orig_table}`\n  {};",
            alter_clauses.join(",\n  ")
        ));
    }

    if orig_table != next_table {
        statements.push(format!("RENAME TABLE `{orig_table}` TO `{next_table}`;"));
    }

    Ok(statements)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn builds_create_table_sql_with_pk_index_and_comment() {
        let spec = TableStructureSpec {
            original_table_name: None,
            table_name: "users".to_string(),
            engine: "InnoDB".to_string(),
            charset: "utf8mb4".to_string(),
            comment: "用户表".to_string(),
            columns: vec![
                TableColumnSpec {
                    original_name: None,
                    name: "id".to_string(),
                    data_type: "bigint unsigned".to_string(),
                    nullable: false,
                    is_primary_key: true,
                    auto_increment: true,
                    default_value: None,
                    comment: "主键".to_string(),
                    marked_for_drop: false,
                },
                TableColumnSpec {
                    original_name: None,
                    name: "email".to_string(),
                    data_type: "varchar(128)".to_string(),
                    nullable: false,
                    is_primary_key: false,
                    auto_increment: false,
                    default_value: None,
                    comment: "邮箱".to_string(),
                    marked_for_drop: false,
                },
            ],
            indexes: vec![TableIndexSpec {
                original_name: None,
                name: "uk_users_email".to_string(),
                columns: vec!["email".to_string()],
                unique: true,
                index_type: "BTREE".to_string(),
                marked_for_drop: false,
            }],
            foreign_keys: Vec::new(),
        };

        let stmts = preview_create_table_sql(&spec).unwrap();
        assert_eq!(stmts.len(), 1);
        assert!(stmts[0].contains("CREATE TABLE `users`"));
        assert!(stmts[0].contains("PRIMARY KEY (`id`)"));
        assert!(stmts[0].contains("UNIQUE KEY `uk_users_email` (`email`) USING BTREE"));
        assert!(stmts[0].contains("COMMENT='用户表'"));
    }
}
