use chrono::Utc;
use rusqlite::Connection;
use std::fs;
use std::path::{Path, PathBuf};

use crate::error::AppError;

const APP_DB_FILE_NAME: &str = "app.db";

/// 打开或引导本地数据库；仅当检测到远古 v1 遗留表结构时才做一次性只读归档。
pub fn open_or_bootstrap_storage(data_dir: &Path) -> Result<PathBuf, AppError> {
    fs::create_dir_all(data_dir)?;
    let db_path = data_dir.join(APP_DB_FILE_NAME);
    if !db_path.exists() {
        return Ok(db_path);
    }

    if is_ancient_v1_database(&db_path)? {
        let backup_path = data_dir.join(format!(
            "app.v1.backup.{}.db",
            Utc::now().format("%Y%m%d%H%M%S")
        ));
        fs::rename(&db_path, backup_path)?;
    }

    Ok(db_path)
}

/// 仅识别无 `schema_meta` 且包含 v1 历史表名的远古数据库，v2 及以后版本一律走增量迁移。
fn is_ancient_v1_database(db_path: &Path) -> Result<bool, AppError> {
    let connection = Connection::open(db_path)?;
    let mut statement = connection
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name ASC")?;
    let rows = statement.query_map([], |row| row.get::<_, String>(0))?;
    let tables = rows.collect::<Result<Vec<_>, _>>()?;

    if tables.is_empty() || tables.iter().any(|name| name == "schema_meta") {
        return Ok(false);
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
    Ok(has_legacy_tables)
}

#[cfg(test)]
mod tests {
    use super::open_or_bootstrap_storage;
    use rusqlite::Connection;
    use std::fs;

    #[test]
    fn archives_ancient_v1_database_and_bootstraps_current_schema() {
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

        assert!(archived, "应先把远古 v1 库归档为 app.v1.backup.<timestamp>.db");
        let user_version: i64 = storage
            .read(|conn| Ok(conn.query_row("PRAGMA user_version", [], |row| row.get(0))?))
            .unwrap();
        assert_eq!(user_version, 4, "新库必须自动迁移到最新版本号");
        let new_db_path = open_or_bootstrap_storage(&root).unwrap();
        assert!(new_db_path.ends_with("app.db"));
    }
}
