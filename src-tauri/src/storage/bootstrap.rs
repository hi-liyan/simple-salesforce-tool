use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

const APP_DB_FILE_NAME: &str = "app.db";
const CURRENT_BOOTSTRAP_VERSION: &str = "\"sqlite-v2-bootstrap-2026-04-24\"";

/// 打开或 bootstrap v2 数据库文件；检测到 v1 时先归档旧库。
pub fn open_or_bootstrap_storage(data_dir: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(data_dir)?;
    let db_path = data_dir.join(APP_DB_FILE_NAME);
    if !db_path.exists() {
        return Ok(db_path);
    }

    if let Some(reason) = archive_reason_for_existing_db(&db_path)? {
        let backup_prefix = if reason == "stale-v2" {
            "app.v2.stale.backup"
        } else {
            "app.v1.backup"
        };
        let backup_path = data_dir.join(format!(
            "{}.{}.db",
            backup_prefix,
            Utc::now().format("%Y%m%d%H%M%S")
        ));
        fs::rename(&db_path, backup_path)?;
    }

    Ok(db_path)
}

/// 判断当前数据库是否应归档；返回归档原因以便区分 v1 与旧 v2 中间库。
fn archive_reason_for_existing_db(db_path: &Path) -> Result<Option<&'static str>, AppError> {
    let connection = Connection::open(db_path)?;
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let tables = rows.collect::<Result<Vec<_>, _>>()?;

    let has_schema_meta = tables.iter().any(|name| name == "schema_meta");
    if has_schema_meta {
        let version: Option<String> = connection
            .query_row(
                "SELECT value_json FROM schema_meta WHERE key = 'schema_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if version
            .map(|value| value.contains("\"2\""))
            .unwrap_or(false)
            == false
        {
            return Ok(Some("v1"));
        }
        let bootstrap_version: Option<String> = connection
            .query_row(
                "SELECT value_json FROM schema_meta WHERE key = 'bootstrap_version'",
                [],
                |row| row.get(0),
            )
            .optional()?;
        if bootstrap_version.as_deref() != Some(CURRENT_BOOTSTRAP_VERSION) {
            // 行内注释：开发期 v2 中间库不做列级迁移，直接归档重建以避免缺列报错。
            return Ok(Some("stale-v2"));
        }
        if !data_sources_schema_complete(&connection)? {
            // 行内注释：版本号可能已被旧启动流程写新，但旧表不会因 IF NOT EXISTS 自动补列。
            return Ok(Some("stale-v2"));
        }
        return Ok(None);
    }

    let has_legacy_tables = tables.iter().any(|name| {
        matches!(
            name.as_str(),
            "salesforce_sources"
                | "object_metadata_cache"
                | "source_metadata_cache"
                | "column_visibility_settings"
        )
    });
    let has_any_tables = !tables.is_empty();
    if has_legacy_tables || has_any_tables {
        Ok(Some("v1"))
    } else {
        Ok(None)
    }
}

/// 检查 `data_sources` 是否具备当前查询与写入依赖的完整字段。
fn data_sources_schema_complete(connection: &Connection) -> Result<bool, AppError> {
    let required_columns = [
        "id",
        "name",
        "source_type",
        "environment",
        "color",
        "sort_order",
        "enabled",
        "config_json",
        "secret_bundle_id",
        "version",
        "created_at",
        "updated_at",
        "archived_at",
    ];
    let mut statement = connection.prepare("PRAGMA table_info(data_sources)")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
    let columns = rows.collect::<Result<Vec<_>, _>>()?;

    Ok(required_columns
        .iter()
        .all(|required| columns.iter().any(|column| column == required)))
}

#[cfg(test)]
mod tests {
    use super::{open_or_bootstrap_storage, CURRENT_BOOTSTRAP_VERSION};
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn archives_v1_database_and_bootstraps_v2_schema() {
        let root =
            std::env::temp_dir().join(format!("sqlite-v2-bootstrap-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        let legacy_db_path = root.join("app.db");

        let legacy = Connection::open(&legacy_db_path).unwrap();
        legacy
            .execute_batch(
                r#"
                CREATE TABLE data_sources (
                    id TEXT PRIMARY KEY,
                    access_token TEXT NOT NULL
                );
                CREATE TABLE salesforce_sources (
                    id TEXT PRIMARY KEY,
                    access_token TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        drop(legacy);

        let storage = crate::storage::Storage::open_or_bootstrap(&root).unwrap();
        let archived = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("app.v1.backup.")
            });

        assert!(archived, "应先把旧库归档为 app.v1.backup.<timestamp>.db");
        let version: String = storage
            .read(|conn| {
                Ok(conn.query_row(
                    "SELECT value_json FROM schema_meta WHERE key = 'schema_version'",
                    [],
                    |row| row.get(0),
                )?)
            })
            .unwrap();
        assert!(version.contains("\"2\""), "v2 新库必须写入 schema_meta");
        let new_db_path = open_or_bootstrap_storage(&root).unwrap();
        assert!(new_db_path.ends_with("app.db"));
    }

    #[test]
    fn archives_stale_v2_database_and_bootstraps_current_schema() {
        let root = std::env::temp_dir().join(format!(
            "sqlite-v2-stale-bootstrap-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let stale_db_path = root.join("app.db");

        let stale = Connection::open(&stale_db_path).unwrap();
        stale
            .execute_batch(
                r#"
                CREATE TABLE schema_meta (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO schema_meta (key, value_json, updated_at)
                VALUES ('schema_version', '"2"', '2026-04-23T00:00:00Z');
                INSERT INTO schema_meta (key, value_json, updated_at)
                VALUES ('bootstrap_version', '"sqlite-v2-bootstrap-old"', '2026-04-23T00:00:00Z');
                CREATE TABLE data_sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL
                );
                "#,
            )
            .unwrap();
        drop(stale);

        let storage = crate::storage::Storage::open_or_bootstrap(&root).unwrap();
        let archived = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("app.v2.stale.backup.")
            });
        assert!(archived, "旧 bootstrap 的 v2 中间库必须先归档");

        let columns = storage
            .read(|conn| {
                let mut statement = conn.prepare("PRAGMA table_info(data_sources)")?;
                let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(rows.collect::<Result<Vec<_>, _>>()?)
            })
            .unwrap();
        assert!(
            columns.iter().any(|column| column == "secret_bundle_id"),
            "重建后的 data_sources 必须包含当前 v2 schema 字段"
        );
    }

    #[test]
    fn archives_current_version_v2_database_when_data_sources_columns_are_incomplete() {
        let root = std::env::temp_dir().join(format!(
            "sqlite-v2-incomplete-columns-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        let stale_db_path = root.join("app.db");

        let stale = Connection::open(&stale_db_path).unwrap();
        stale
            .execute_batch(&format!(
                r#"
                CREATE TABLE schema_meta (
                    key TEXT PRIMARY KEY,
                    value_json TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                INSERT INTO schema_meta (key, value_json, updated_at)
                VALUES ('schema_version', '"2"', '2026-04-23T00:00:00Z');
                INSERT INTO schema_meta (key, value_json, updated_at)
                VALUES ('bootstrap_version', '{CURRENT_BOOTSTRAP_VERSION}', '2026-04-24T00:00:00Z');
                CREATE TABLE data_sources (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    source_type TEXT NOT NULL,
                    sort_order INTEGER NOT NULL,
                    config_json TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                "#
            ))
            .unwrap();
        drop(stale);

        let storage = crate::storage::Storage::open_or_bootstrap(&root).unwrap();
        let archived = fs::read_dir(&root)
            .unwrap()
            .filter_map(Result::ok)
            .any(|entry| {
                entry
                    .file_name()
                    .to_string_lossy()
                    .starts_with("app.v2.stale.backup.")
            });
        assert!(archived, "当前版本号但缺少关键列的 v2 库也必须归档");

        let columns = storage
            .read(|conn| {
                let mut statement = conn.prepare("PRAGMA table_info(data_sources)")?;
                let rows = statement.query_map([], |row| row.get::<_, String>(1))?;
                Ok(rows.collect::<Result<Vec<_>, _>>()?)
            })
            .unwrap();
        assert!(
            columns.iter().any(|column| column == "environment")
                && columns.iter().any(|column| column == "archived_at"),
            "重建后的 data_sources 必须包含查询依赖的 environment 与 archived_at 字段"
        );
    }
}
