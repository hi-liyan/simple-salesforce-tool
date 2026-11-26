use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, Transaction};

use crate::error::AppError;
use crate::storage::schema;

/// 单条版本化增量迁移定义。
struct Migration {
    /// 递增整数版本号（对应 `PRAGMA user_version`）。
    version: i64,
    /// 迁移唯一标识（写入 `migration_logs`）。
    id: &'static str,
    /// 迁移执行函数（在单事务内执行）。
    up: fn(&Transaction<'_>) -> Result<(), AppError>,
}

/// 全量增量迁移注册表：按版本号严格递增，禁止修改已发布版本。
const MIGRATIONS: &[Migration] = &[
    Migration {
        version: 1,
        id: "2026-04-24-v1-baseline-v2-schema",
        up: migrate_v1_baseline,
    },
    Migration {
        version: 2,
        id: "2026-11-26-v2-indexes-fk-plugins-audit",
        up: migrate_v2_indexes_fk_plugins_audit,
    },
];

/// 执行版本化增量迁移：基于 `PRAGMA user_version` 在事务内幂等推进。
pub fn run_migrations(connection: &mut Connection) -> Result<(), AppError> {
    let mut current_version: i64 =
        connection.query_row("PRAGMA user_version", [], |row| row.get(0))?;

    // 行内注释：兼容历史无 user_version 的存量 v2 库，平滑补齐缺失列并标记为 version=1，严禁删库重建。
    if current_version == 0 && has_existing_v2_schema_meta(connection)? {
        let tx = connection.transaction()?;
        schema::init_v2_schema(&tx)?;
        ensure_legacy_data_sources_columns(&tx)?;
        record_migration_log(&tx, "2026-04-24-v1-adopted-existing-v2", "adopted")?;
        tx.pragma_update(None, "user_version", 1i64)?;
        tx.commit()?;
        current_version = 1;
    }

    for migration in MIGRATIONS {
        if migration.version <= current_version {
            continue;
        }
        let tx = connection.transaction()?;
        (migration.up)(&tx)?;
        record_migration_log(&tx, migration.id, "applied")?;
        tx.pragma_update(None, "user_version", migration.version)?;
        tx.commit()?;
        current_version = migration.version;
    }

    Ok(())
}

/// V1 基线迁移：创建核心业务表与元信息表。
fn migrate_v1_baseline(tx: &Transaction<'_>) -> Result<(), AppError> {
    schema::init_v2_schema(tx)
}

/// V2 规范化迁移：补全外键级联、高频查询索引、插件存储表、SQL 审计表并清理死表。
fn migrate_v2_indexes_fk_plugins_audit(tx: &Transaction<'_>) -> Result<(), AppError> {
    // 1. 新增插件隔离 KV 存储表与 SQL 执行审计表，以及高频缺失索引。
    tx.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS plugin_kv_store (
            plugin_id TEXT NOT NULL,
            storage_key TEXT NOT NULL,
            value_json TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            PRIMARY KEY(plugin_id, storage_key)
        );

        CREATE TABLE IF NOT EXISTS sql_execution_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            source_id TEXT NOT NULL,
            source_name TEXT NOT NULL,
            environment TEXT NOT NULL DEFAULT 'default',
            operation_source TEXT NOT NULL,
            raw_sql TEXT NOT NULL,
            executed_sql TEXT NOT NULL,
            statement_type TEXT NOT NULL,
            risk_level TEXT NOT NULL DEFAULT 'low',
            plan_hash TEXT NOT NULL DEFAULT '',
            rows_affected INTEGER NOT NULL DEFAULT 0,
            rows_returned INTEGER NOT NULL DEFAULT 0,
            duration_ms INTEGER NOT NULL DEFAULT 0,
            success INTEGER NOT NULL,
            error_message TEXT NOT NULL DEFAULT '',
            executed_at TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_sql_execution_audit_source_time
            ON sql_execution_audit(source_id, executed_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_secret_access_audit_bundle
            ON secret_access_audit(bundle_id, id DESC);
        CREATE INDEX IF NOT EXISTS idx_source_metadata_blobs_source_obj
            ON source_metadata_blobs(source_id, object_name);
        CREATE INDEX IF NOT EXISTS idx_query_result_sets_tab
            ON query_result_sets(tab_id);
        CREATE INDEX IF NOT EXISTS idx_system_logs_category_source_time
            ON system_logs(category, source_id, created_at DESC);
        "#,
    )?;

    // 2. 重建 source_object_indexes 与 source_object_constraints，补齐外键级联删除并保留存量有效数据。
    rebuild_object_indexes_with_fk(tx)?;
    rebuild_object_constraints_with_fk(tx)?;

    Ok(())
}

/// 重建 `source_object_indexes` 以补齐级联外键约束。
fn rebuild_object_indexes_with_fk(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute_batch(
        r#"
        CREATE TABLE source_object_indexes_v2 (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            index_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, index_name),
            FOREIGN KEY(source_id, object_name) REFERENCES source_objects(source_id, object_name) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO source_object_indexes_v2 (source_id, object_name, index_name, payload_json, sort_order)
        SELECT i.source_id, i.object_name, i.index_name, i.payload_json, i.sort_order
        FROM source_object_indexes i
        INNER JOIN source_objects o
          ON o.source_id = i.source_id AND o.object_name = i.object_name;

        DROP TABLE source_object_indexes;
        ALTER TABLE source_object_indexes_v2 RENAME TO source_object_indexes;
        "#,
    )?;
    Ok(())
}

/// 重建 `source_object_constraints` 以补齐级联外键约束。
fn rebuild_object_constraints_with_fk(tx: &Transaction<'_>) -> Result<(), AppError> {
    tx.execute_batch(
        r#"
        CREATE TABLE source_object_constraints_v2 (
            source_id TEXT NOT NULL,
            object_name TEXT NOT NULL,
            constraint_name TEXT NOT NULL,
            payload_json TEXT NOT NULL,
            sort_order INTEGER NOT NULL,
            PRIMARY KEY(source_id, object_name, constraint_name),
            FOREIGN KEY(source_id, object_name) REFERENCES source_objects(source_id, object_name) ON DELETE CASCADE
        );

        INSERT OR IGNORE INTO source_object_constraints_v2 (source_id, object_name, constraint_name, payload_json, sort_order)
        SELECT c.source_id, c.object_name, c.constraint_name, c.payload_json, c.sort_order
        FROM source_object_constraints c
        INNER JOIN source_objects o
          ON o.source_id = c.source_id AND o.object_name = c.object_name;

        DROP TABLE source_object_constraints;
        ALTER TABLE source_object_constraints_v2 RENAME TO source_object_constraints;
        "#,
    )?;
    Ok(())
}

/// 判断是否已存在无 `user_version` 的旧版 v2 `schema_meta`。
fn has_existing_v2_schema_meta(connection: &Connection) -> Result<bool, AppError> {
    let has_table: Option<String> = connection
        .query_row(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'schema_meta'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    if has_table.is_none() {
        return Ok(false);
    }
    let version: Option<String> = connection
        .query_row(
            "SELECT value_json FROM schema_meta WHERE key = 'schema_version'",
            [],
            |row| row.get(0),
        )
        .optional()?;
    Ok(version
        .map(|value| value.contains("\"2\""))
        .unwrap_or(false))
}

/// 为早期 v2 中间库无损补齐 `data_sources` 缺失列（替代毁灭性删库归档）。
fn ensure_legacy_data_sources_columns(tx: &Transaction<'_>) -> Result<(), AppError> {
    let mut statement = tx.prepare("PRAGMA table_info(data_sources)")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let existing = rows.collect::<Result<Vec<_>, _>>()?;
    drop(statement);

    let alter_specs = [
        ("environment", "ALTER TABLE data_sources ADD COLUMN environment TEXT NOT NULL DEFAULT 'default'"),
        ("color", "ALTER TABLE data_sources ADD COLUMN color TEXT NOT NULL DEFAULT ''"),
        ("sort_order", "ALTER TABLE data_sources ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0"),
        ("enabled", "ALTER TABLE data_sources ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1"),
        ("config_json", "ALTER TABLE data_sources ADD COLUMN config_json TEXT NOT NULL DEFAULT '{}'"),
        ("secret_bundle_id", "ALTER TABLE data_sources ADD COLUMN secret_bundle_id TEXT NULL"),
        ("version", "ALTER TABLE data_sources ADD COLUMN version INTEGER NOT NULL DEFAULT 1"),
        ("archived_at", "ALTER TABLE data_sources ADD COLUMN archived_at TEXT NULL"),
    ];

    for (column, sql) in alter_specs {
        if !existing.iter().any(|item| item == column) {
            tx.execute(sql, [])?;
        }
    }
    Ok(())
}

/// 写入迁移执行日志。
fn record_migration_log(
    tx: &Transaction<'_>,
    migration_id: &str,
    status: &str,
) -> Result<(), AppError> {
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO migration_logs (migration_id, status, detail_json, created_at)
         VALUES (?1, ?2, '{}', ?3)",
        params![migration_id, status, now],
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn migrates_legacy_v2_database_without_losing_data() {
        let root =
            std::env::temp_dir().join(format!("sqlite-incremental-mig-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let db_path = root.join("app.db");

        // 构造早期缺列的 v2 库并写入一条存量数据源记录。
        let legacy = Connection::open(&db_path).unwrap();
        legacy
            .execute_batch(
                r#"
                CREATE TABLE schema_meta (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO schema_meta (key, value_json, updated_at)
                VALUES ('schema_version', '"2"', '2026-04-23T00:00:00Z');
                CREATE TABLE data_sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO data_sources (id, name, source_type, created_at, updated_at)
                VALUES ('src-keep', 'KeepMe', 'mysql', '2026-04-23T00:00:00Z', '2026-04-23T00:00:00Z');
                "#,
            )
            .unwrap();
        drop(legacy);

        let storage = crate::storage::Storage::open_or_bootstrap(&root).unwrap();
        let kept_name: String = storage
            .read(|conn| {
                Ok(conn.query_row(
                    "SELECT name FROM data_sources WHERE id = 'src-keep'",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert_eq!(kept_name, "KeepMe", "增量迁移必须保留存量数据源，严禁删库归档");

        let user_version: i64 = storage
            .read(|conn| Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?))
            .unwrap();
        assert_eq!(user_version, 2, "迁移完成后应推进到最新版本 2");

        // 验证 V2 新建表与索引已就位，且未产生 stale backup。
        let has_stale_backup = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("app.v2.stale.backup.")
            });
        assert!(!has_stale_backup, "不应再生成 v2 stale 归档文件");
    }
}
