use chrono::Utc;
use rusqlite::{Connection, OptionalExtension};
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

const APP_DB_FILE_NAME: &str = "app.db";

/// 打开或 bootstrap v2 数据库文件；检测到 v1 时先归档旧库。
pub fn open_or_bootstrap_storage(data_dir: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(data_dir)?;
    let db_path = data_dir.join(APP_DB_FILE_NAME);
    if !db_path.exists() {
        return Ok(db_path);
    }

    if should_archive_existing_db(&db_path)? {
        let backup_path = data_dir.join(format!(
            "app.v1.backup.{}.db",
            Utc::now().format("%Y%m%d%H%M%S")
        ));
        fs::rename(&db_path, backup_path)?;
    }

    Ok(db_path)
}

/// 判断当前数据库是否应视为 legacy v1 并归档。
fn should_archive_existing_db(db_path: &Path) -> Result<bool, AppError> {
    let connection = Connection::open(db_path)?;
    let mut statement = connection.prepare(
        "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC",
    )?;
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
        return Ok(version.map(|value| value.contains("\"2\"")).unwrap_or(false) == false);
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
    Ok(has_legacy_tables || has_any_tables)
}

#[cfg(test)]
mod tests {
    use super::open_or_bootstrap_storage;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn archives_v1_database_and_bootstraps_v2_schema() {
        let root = std::env::temp_dir().join(format!(
            "sqlite-v2-bootstrap-{}",
            uuid::Uuid::new_v4()
        ));
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
}
