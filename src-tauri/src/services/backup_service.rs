use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use chrono::Local;
use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Column, MySqlConnection, Row, TypeInfo};
use tempfile::NamedTempFile;

use crate::drivers::connection_manager::ConnectionManager;
use crate::drivers::mysql::provider::{
    decode_row_string, ensure_safe_identifier, escape_sql_literal, row_try_get_json_value,
    MySqlProvider, MySqlSourceConfig,
};
use crate::drivers::DriverRegistry;
use crate::error::AppError;
use crate::models::SalesforceSource;
use crate::services::audit_service::AuditService;
use crate::services::export_service::format_sql_value_literal;
use crate::storage::audit_repo::SqlExecutionAuditRecord;
use crate::storage::Storage;

/// 数据库备份范围。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum BackupScope {
    /// 备份整个数据库（所有 BASE TABLE）。
    Database,
    /// 仅备份指定单表。
    Table,
}

/// 纯 Rust 逻辑 SQL 备份请求参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupRequest {
    /// 前端任务 ID（用于进度事件与取消操作）。
    pub task_id: String,
    /// 数据源 ID。
    pub source_id: String,
    /// 备份范围（整库或单表）。
    pub scope: BackupScope,
    /// 单表备份时的目标表名。
    #[serde(default)]
    pub table_name: Option<String>,
    /// 用户选择的输出 `.sql` 文件路径。
    pub output_path: String,
    /// 是否包含 `DROP TABLE IF EXISTS`。
    #[serde(default = "default_true")]
    pub include_drop_table: bool,
    /// 是否包含 `CREATE DATABASE IF NOT EXISTS` 与 `USE`。
    #[serde(default)]
    pub include_create_database: bool,
    /// 是否移除 DDL 中的 `AUTO_INCREMENT=xxx` 计数。
    #[serde(default)]
    pub strip_auto_increment: bool,
    /// 是否导出表数据（false 时仅导出结构 DDL）。
    #[serde(default = "default_true")]
    pub include_data: bool,
    /// 批量 INSERT 每条语句包含的最大行数（默认 200）。
    #[serde(default = "default_backup_batch_size")]
    pub batch_size: usize,
}

fn default_true() -> bool {
    true
}

fn default_backup_batch_size() -> usize {
    200
}

/// 备份进度事件载荷（事件名：`database-backup-progress`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupProgressPayload {
    /// 任务 ID。
    pub task_id: String,
    /// 当前正在处理的表名。
    pub current_table: String,
    /// 已完成的表数量。
    pub completed_tables: usize,
    /// 总表数量。
    pub total_tables: usize,
    /// 累计已导出的记录行数。
    pub exported_rows: u64,
    /// 当前阶段：preparing | dumping | finalizing | completed | cancelled | failed。
    pub phase: String,
    /// 阶段说明文本。
    pub message: String,
}

/// 数据库备份完成摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BackupResult {
    /// 任务 ID。
    pub task_id: String,
    /// 最终 `.sql` 文件路径。
    pub output_path: String,
    /// 备份的表数量。
    pub table_count: usize,
    /// 备份的数据总行数。
    pub exported_rows: u64,
    /// 备份文件大小（字节）。
    pub file_size_bytes: u64,
    /// 总耗时（毫秒）。
    pub duration_ms: u64,
}

/// 纯 Rust 逻辑 SQL 备份服务：无需外部 `mysqldump`，支持一致性事务快照与流式分批写出。
pub struct BackupService;

impl BackupService {
    /// 执行逻辑 SQL 备份，并写入审计日志。
    pub async fn backup_to_file<F>(
        storage: &Storage,
        driver_registry: &DriverRegistry,
        connection_manager: &Arc<ConnectionManager>,
        source: &SalesforceSource,
        request: BackupRequest,
        cancel_flag: Arc<AtomicBool>,
        emit_progress: F,
    ) -> Result<BackupResult, AppError>
    where
        F: Fn(BackupProgressPayload) + Send + Sync,
    {
        let started_at = Instant::now();
        let driver = driver_registry.get(&source.source_type)?;
        if !driver.capabilities().supports_backup {
            return Err(AppError::Biz(format!(
                "当前数据源类型 [{}] 暂不支持数据库逻辑备份",
                source.source_type
            )));
        }

        let target_path = Path::new(&request.output_path);
        let parent_dir = target_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| AppError::Biz("无效的备份保存路径".to_string()))?;
        std::fs::create_dir_all(parent_dir)
            .map_err(|err| AppError::Biz(format!("创建备份目录失败: {err}")))?;

        emit_progress(BackupProgressPayload {
            task_id: request.task_id.clone(),
            current_table: String::new(),
            completed_tables: 0,
            total_tables: 0,
            exported_rows: 0,
            phase: "preparing".to_string(),
            message: "正在建立一致性快照事务...".to_string(),
        });

        let config = MySqlSourceConfig::from_source(source)?;
        let provider = MySqlProvider::with_connection_manager(Arc::clone(connection_manager));
        let pool = provider.acquire_pool(source, &config).await?;
        let mut conn = pool
            .acquire()
            .await
            .map_err(|err| AppError::Db(format!("获取备份连接失败: {err}")))?;

        // 开启一致性快照事务，保证多表备份期间数据时间点一致。
        sqlx::query("SET SESSION TRANSACTION ISOLATION LEVEL REPEATABLE READ")
            .execute(&mut *conn)
            .await
            .map_err(|err| AppError::Db(format!("设置事务隔离级别失败: {err}")))?;
        sqlx::query("START TRANSACTION WITH CONSISTENT SNAPSHOT")
            .execute(&mut *conn)
            .await
            .map_err(|err| AppError::Db(format!("开启一致性快照失败: {err}")))?;

        let tables = resolve_backup_tables(&mut conn, &request).await?;
        let total_tables = tables.len();
        let batch_size = request.batch_size.clamp(1, 2000);

        let temp_file = NamedTempFile::new_in(parent_dir)
            .map_err(|err| AppError::Biz(format!("创建临时备份文件失败: {err}")))?;

        let dump_result = write_mysql_dump(
            &mut conn,
            &config.database,
            &tables,
            &request,
            batch_size,
            temp_file.path(),
            &cancel_flag,
            &emit_progress,
        )
        .await;

        // 无论备份成功还是取消，都主动释放只读快照事务。
        let _ = sqlx::query("COMMIT").execute(&mut *conn).await;

        let exported_rows = match dump_result {
            Ok(rows) => rows,
            Err(err) => {
                record_backup_audit(storage, source, &request, total_tables, 0, started_at, false, &err.to_string())?;
                return Err(err);
            }
        };

        emit_progress(BackupProgressPayload {
            task_id: request.task_id.clone(),
            current_table: String::new(),
            completed_tables: total_tables,
            total_tables,
            exported_rows,
            phase: "finalizing".to_string(),
            message: "正在提交备份文件...".to_string(),
        });

        temp_file
            .persist(target_path)
            .map_err(|err| AppError::Biz(format!("保存备份文件失败: {}", err.error)))?;

        let file_size_bytes = std::fs::metadata(target_path).map(|m| m.len()).unwrap_or(0);
        let duration_ms = started_at.elapsed().as_millis() as u64;

        record_backup_audit(storage, source, &request, total_tables, exported_rows, started_at, true, "")?;

        emit_progress(BackupProgressPayload {
            task_id: request.task_id.clone(),
            current_table: String::new(),
            completed_tables: total_tables,
            total_tables,
            exported_rows,
            phase: "completed".to_string(),
            message: format!("备份完成：{total_tables} 张表，共 {exported_rows} 行"),
        });

        Ok(BackupResult {
            task_id: request.task_id,
            output_path: request.output_path,
            table_count: total_tables,
            exported_rows,
            file_size_bytes,
            duration_ms,
        })
    }
}

/// 解析本次需要备份的表清单（整库仅包含 BASE TABLE，排除 VIEW）。
async fn resolve_backup_tables(
    conn: &mut MySqlConnection,
    request: &BackupRequest,
) -> Result<Vec<String>, AppError> {
    match request.scope {
        BackupScope::Table => {
            let raw = request
                .table_name
                .as_deref()
                .map(str::trim)
                .filter(|name| !name.is_empty())
                .ok_or_else(|| AppError::Biz("单表备份必须指定目标表名".to_string()))?;
            let safe = ensure_safe_identifier(raw, "表名")?;
            Ok(vec![safe])
        }
        BackupScope::Database => {
            let rows = sqlx::query("SHOW FULL TABLES WHERE Table_type = 'BASE TABLE'")
                .fetch_all(&mut *conn)
                .await
                .map_err(|err| AppError::Db(format!("读取数据库表列表失败: {err}")))?;
            let mut tables = Vec::with_capacity(rows.len());
            for row in rows {
                let name = decode_row_string(&row, 0, "表名")?;
                tables.push(name);
            }
            if tables.is_empty() {
                return Err(AppError::Biz("当前数据库中没有可备份的基础表".to_string()));
            }
            Ok(tables)
        }
    }
}

/// 将一致性快照下的表结构与数据流式写入 SQL 文件。
#[allow(clippy::too_many_arguments)]
async fn write_mysql_dump<F>(
    conn: &mut MySqlConnection,
    database: &str,
    tables: &[String],
    request: &BackupRequest,
    batch_size: usize,
    temp_path: &Path,
    cancel_flag: &Arc<AtomicBool>,
    emit_progress: &F,
) -> Result<u64, AppError>
where
    F: Fn(BackupProgressPayload) + Send + Sync,
{
    let file = File::create(temp_path)
        .map_err(|err| AppError::Biz(format!("创建备份写入句柄失败: {err}")))?;
    let mut writer = BufWriter::with_capacity(128 * 1024, file);

    let now_str = Local::now().format("%Y-%m-%d %H:%M:%S").to_string();
    writeln!(
        writer,
        "-- ============================================================\n\
         -- DataStudio Logical SQL Backup\n\
         -- Database: `{database}`\n\
         -- Generated At: {now_str}\n\
         -- ============================================================\n\n\
         SET NAMES utf8mb4;\n\
         SET FOREIGN_KEY_CHECKS = 0;\n"
    )
    .map_err(|err| AppError::Biz(format!("写入备份文件头失败: {err}")))?;

    if request.include_create_database {
        let safe_db = database.replace('`', "``");
        writeln!(
            writer,
            "CREATE DATABASE IF NOT EXISTS `{safe_db}` DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;\n\
             USE `{safe_db}`;\n"
        )
        .map_err(|err| AppError::Biz(format!("写入建库语句失败: {err}")))?;
    }

    let total_tables = tables.len();
    let mut total_exported_rows: u64 = 0;

    for (idx, table_name) in tables.iter().enumerate() {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(AppError::Biz("BACKUP_CANCELLED".to_string()));
        }

        emit_progress(BackupProgressPayload {
            task_id: request.task_id.clone(),
            current_table: table_name.clone(),
            completed_tables: idx,
            total_tables,
            exported_rows: total_exported_rows,
            phase: "dumping".to_string(),
            message: format!("正在备份表 `{table_name}` ({}/{total_tables})...", idx + 1),
        });

        let escaped_table = table_name.replace('`', "``");
        let show_create_sql = format!("SHOW CREATE TABLE `{escaped_table}`");
        let create_row = sqlx::query(&show_create_sql)
            .fetch_one(&mut *conn)
            .await
            .map_err(|err| AppError::Db(format!("读取表 `{table_name}` DDL 失败: {err}")))?;
        let mut ddl = decode_row_string(&create_row, 1, "建表 DDL")?;
        if request.strip_auto_increment {
            ddl = strip_auto_increment_option(&ddl);
        }

        writeln!(
            writer,
            "-- ------------------------------------------------------------\n\
             -- Table structure for `{escaped_table}`\n\
             -- ------------------------------------------------------------"
        )
        .map_err(|err| AppError::Biz(format!("写入表注释失败: {err}")))?;

        if request.include_drop_table {
            writeln!(writer, "DROP TABLE IF EXISTS `{escaped_table}`;")
                .map_err(|err| AppError::Biz(format!("写入 DROP TABLE 失败: {err}")))?;
        }
        writeln!(writer, "{ddl};\n")
            .map_err(|err| AppError::Biz(format!("写入 CREATE TABLE 失败: {err}")))?;

        if request.include_data {
            let select_sql = format!("SELECT * FROM `{escaped_table}`");
            let mut columns: Vec<String> = Vec::new();
            let mut col_types: Vec<String> = Vec::new();
            let mut batch_tuples: Vec<String> = Vec::with_capacity(batch_size);
            let mut table_rows: u64 = 0;

            let mut stream = sqlx::query(&select_sql).fetch(&mut *conn);
            while let Some(row_res) = stream.next().await {
                if cancel_flag.load(Ordering::Relaxed) {
                    return Err(AppError::Biz("BACKUP_CANCELLED".to_string()));
                }
                let row = row_res
                    .map_err(|err| AppError::Db(format!("流式读取表 `{table_name}` 数据失败: {err}")))?;

                if columns.is_empty() {
                    columns = row.columns().iter().map(|c| c.name().to_string()).collect();
                    col_types = row
                        .columns()
                        .iter()
                        .map(|c| c.type_info().name().to_ascii_lowercase())
                        .collect();
                    writeln!(writer, "-- Dumping data for table `{escaped_table}`")
                        .map_err(|err| AppError::Biz(format!("写入数据注释失败: {err}")))?;
                }

                let mut formatted_vals = Vec::with_capacity(columns.len());
                for (col_idx, col_name) in columns.iter().enumerate() {
                    let type_name = col_types.get(col_idx).map(String::as_str).unwrap_or("");
                    formatted_vals.push(format_backup_cell_literal(&row, col_name, type_name));
                }
                batch_tuples.push(format!("({})", formatted_vals.join(", ")));
                table_rows += 1;
                total_exported_rows += 1;

                if batch_tuples.len() >= batch_size {
                    flush_backup_insert_batch(&mut writer, &escaped_table, &columns, &mut batch_tuples)?;
                }
                if table_rows % 1000 == 0 {
                    emit_progress(BackupProgressPayload {
                        task_id: request.task_id.clone(),
                        current_table: table_name.clone(),
                        completed_tables: idx,
                        total_tables,
                        exported_rows: total_exported_rows,
                        phase: "dumping".to_string(),
                        message: format!(
                            "正在备份表 `{table_name}`：已写入 {table_rows} 行（累计 {total_exported_rows} 行）"
                        ),
                    });
                }
            }

            if !batch_tuples.is_empty() {
                flush_backup_insert_batch(&mut writer, &escaped_table, &columns, &mut batch_tuples)?;
            }
            if table_rows > 0 {
                writeln!(writer)
                    .map_err(|err| AppError::Biz(format!("写入空行失败: {err}")))?;
            }
        }
    }

    writeln!(writer, "SET FOREIGN_KEY_CHECKS = 1;")
        .map_err(|err| AppError::Biz(format!("写入备份尾部失败: {err}")))?;
    writer
        .flush()
        .map_err(|err| AppError::Biz(format!("刷新备份缓冲区失败: {err}")))?;

    Ok(total_exported_rows)
}

/// 将一组数据元组写入 `INSERT INTO` 语句。
fn flush_backup_insert_batch(
    writer: &mut BufWriter<File>,
    escaped_table: &str,
    columns: &[String],
    batch_tuples: &mut Vec<String>,
) -> Result<(), AppError> {
    if batch_tuples.is_empty() || columns.is_empty() {
        batch_tuples.clear();
        return Ok(());
    }
    let cols_sql = columns
        .iter()
        .map(|col| format!("`{}`", col.replace('`', "``")))
        .collect::<Vec<_>>()
        .join(", ");
    writeln!(
        writer,
        "INSERT INTO `{escaped_table}` ({cols_sql}) VALUES\n  {};",
        batch_tuples.join(",\n  ")
    )
    .map_err(|err| AppError::Biz(format!("写入备份 INSERT 语句失败: {err}")))?;
    batch_tuples.clear();
    Ok(())
}

/// 格式化备份单元格 SQL 字面量：BLOB/BINARY 使用十六进制 `0x...` 无损还原，其余按类型转义。
fn format_backup_cell_literal(row: &sqlx::mysql::MySqlRow, col_name: &str, type_name: &str) -> String {
    if type_name.contains("blob") || type_name.contains("binary") || type_name == "bit" {
        if let Ok(opt_bytes) = row.try_get::<Option<Vec<u8>>, _>(col_name) {
            return match opt_bytes {
                None => "NULL".to_string(),
                Some(bytes) if bytes.is_empty() => "''".to_string(),
                Some(bytes) => {
                    let mut hex = String::with_capacity(2 + bytes.len() * 2);
                    hex.push_str("0x");
                    for byte in bytes {
                        use std::fmt::Write;
                        let _ = write!(hex, "{byte:02X}");
                    }
                    hex
                }
            };
        }
    }
    let val: Value = row_try_get_json_value(row, col_name, type_name);
    format_sql_value_literal(&val)
}

/// 移除 `SHOW CREATE TABLE` 中的 `AUTO_INCREMENT=123` 选项，便于跨环境重建空表。
fn strip_auto_increment_option(ddl: &str) -> String {
    let mut output = String::with_capacity(ddl.len());
    let mut rest = ddl;
    while let Some(pos) = rest.find("AUTO_INCREMENT=") {
        output.push_str(&rest[..pos]);
        let after = &rest[pos + "AUTO_INCREMENT=".len()..];
        let digits_len = after.chars().take_while(|c| c.is_ascii_digit()).count();
        let after_digits = &after[digits_len..];
        // 同时清理紧随其后的单个空格，避免产生多余双空格。
        rest = after_digits.strip_prefix(' ').unwrap_or(after_digits);
    }
    output.push_str(rest);
    output
}

/// 记录数据库备份操作到 SQL 审计表。
fn record_backup_audit(
    storage: &Storage,
    source: &SalesforceSource,
    request: &BackupRequest,
    table_count: usize,
    exported_rows: u64,
    started_at: Instant,
    success: bool,
    error_message: &str,
) -> Result<(), AppError> {
    let scope_desc = match request.scope {
        BackupScope::Database => format!("BACKUP DATABASE ({table_count} tables)"),
        BackupScope::Table => format!(
            "BACKUP TABLE `{}`",
            request.table_name.as_deref().unwrap_or("")
        ),
    };
    let environment = source
        .config_json
        .get("environment")
        .and_then(Value::as_str)
        .unwrap_or("default")
        .to_string();
    let audit = AuditService::new(storage);
    audit.record_sql_execution(&SqlExecutionAuditRecord {
        source_id: source.id.clone(),
        source_name: source.name.clone(),
        environment,
        operation_source: "backup".to_string(),
        raw_sql: format!(
            "{scope_desc} -> {}",
            escape_sql_literal(&request.output_path)
        ),
        executed_sql: scope_desc,
        statement_type: "BACKUP".to_string(),
        risk_level: "low".to_string(),
        plan_hash: String::new(),
        rows_affected: 0,
        rows_returned: exported_rows as i64,
        duration_ms: started_at.elapsed().as_millis() as i64,
        success,
        error_message: error_message.to_string(),
    })?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::strip_auto_increment_option;

    #[test]
    fn strips_auto_increment_from_create_table() {
        let ddl = "CREATE TABLE `users` (`id` bigint NOT NULL AUTO_INCREMENT, PRIMARY KEY (`id`)) ENGINE=InnoDB AUTO_INCREMENT=4521 DEFAULT CHARSET=utf8mb4";
        let cleaned = strip_auto_increment_option(ddl);
        assert!(!cleaned.contains("AUTO_INCREMENT=4521"));
        assert!(cleaned.contains("`id` bigint NOT NULL AUTO_INCREMENT"));
        assert!(cleaned.contains("ENGINE=InnoDB DEFAULT CHARSET=utf8mb4"));
    }
}
