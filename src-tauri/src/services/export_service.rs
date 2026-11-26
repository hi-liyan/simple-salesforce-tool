use std::fs::File;
use std::io::{BufWriter, Write};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::Instant;

use futures_util::StreamExt;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sqlx::{Column, Row, TypeInfo};
use tempfile::NamedTempFile;

use crate::drivers::connection_manager::ConnectionManager;
use crate::drivers::mysql::provider::{
    ensure_safe_identifier, escape_sql_literal, row_try_get_json_value, MySqlProvider,
    MySqlSourceConfig,
};
use crate::drivers::DriverRegistry;
use crate::error::AppError;
use crate::models::SalesforceSource;

/// 导出文件格式枚举。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum ExportFormat {
    /// UTF-8（带 BOM）逗号分隔 CSV。
    Csv,
    /// 制表符分隔 TSV。
    Tsv,
    /// 标准格式化 JSON 数组。
    Json,
    /// Markdown 表格。
    Markdown,
    /// 批量 SQL INSERT 语句。
    SqlInsert,
    /// Excel XLSX 工作簿。
    Xlsx,
}

/// 后端流式导出请求参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportDataRequest {
    /// 前端生成的任务 ID，用于关联进度事件与取消操作。
    pub task_id: String,
    /// 数据源 ID。
    pub source_id: String,
    /// 目标表/对象名称（用于 SQL INSERT 表名；当 `sql` 为空时自动生成全表查询）。
    #[serde(default)]
    pub object_name: Option<String>,
    /// 待导出的完整查询语句。
    #[serde(default)]
    pub sql: String,
    /// 目标导出格式。
    pub format: ExportFormat,
    /// 用户选择的最终保存路径。
    pub output_path: String,
    /// 是否包含表头（CSV / TSV / XLSX 有效）。
    #[serde(default = "default_true")]
    pub include_header: bool,
    /// SQL INSERT 每条语句包含的最大行数（默认 100）。
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
}

fn default_true() -> bool {
    true
}

fn default_batch_size() -> usize {
    100
}

/// 导出进度事件载荷（事件名：`data-export-progress`）。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportProgressPayload {
    /// 任务 ID。
    pub task_id: String,
    /// 已导出的记录行数。
    pub exported_rows: u64,
    /// 预估总行数（若可获取）。
    pub total_rows: Option<u64>,
    /// 当前阶段：querying | writing | finalizing | completed | cancelled | failed。
    pub phase: String,
    /// 阶段提示文本。
    pub message: String,
}

/// 导出完成结果摘要。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
    /// 任务 ID。
    pub task_id: String,
    /// 最终文件路径。
    pub output_path: String,
    /// 实际导出的行数。
    pub exported_rows: u64,
    /// 生成文件大小（字节）。
    pub file_size_bytes: u64,
    /// 总耗时（毫秒）。
    pub duration_ms: u64,
}

/// 数据导出服务：支持流式查询导出与多格式渲染，通过临时文件原子落盘防止中断产生损坏文件。
pub struct ExportService;

impl ExportService {
    /// 执行异步流式数据导出，并通过回调上报实时进度。
    pub async fn export_to_file<F>(
        driver_registry: &DriverRegistry,
        connection_manager: &Arc<ConnectionManager>,
        source: &SalesforceSource,
        request: ExportDataRequest,
        cancel_flag: Arc<AtomicBool>,
        emit_progress: F,
    ) -> Result<ExportResult, AppError>
    where
        F: Fn(ExportProgressPayload) + Send + Sync,
    {
        let started_at = Instant::now();
        let target_path = Path::new(&request.output_path);
        let parent_dir = target_path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .ok_or_else(|| AppError::Biz("无效的导出目标路径".to_string()))?;
        std::fs::create_dir_all(parent_dir)
            .map_err(|err| AppError::Biz(format!("创建导出目录失败: {err}")))?;

        let driver = driver_registry.get(&source.source_type)?;
        let capabilities = driver.capabilities();
        let effective_sql = resolve_effective_export_sql(&request, &capabilities.query_language)?;

        emit_progress(ExportProgressPayload {
            task_id: request.task_id.clone(),
            exported_rows: 0,
            total_rows: None,
            phase: "querying".to_string(),
            message: "正在执行查询准备导出...".to_string(),
        });

        if cancel_flag.load(Ordering::Relaxed) {
            return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
        }

        // 创建同目录临时文件，成功完成后原子替换目标路径。
        let temp_file = NamedTempFile::new_in(parent_dir)
            .map_err(|err| AppError::Biz(format!("创建临时导出文件失败: {err}")))?;

        let table_name = request
            .object_name
            .as_deref()
            .map(str::trim)
            .filter(|name| !name.is_empty())
            .unwrap_or("exported_table")
            .to_string();
        let batch_size = request.batch_size.clamp(1, 2000);

        let exported_rows = if capabilities.query_language.eq_ignore_ascii_case("mysql") {
            export_mysql_stream(
                connection_manager,
                source,
                &effective_sql,
                &table_name,
                request.format,
                request.include_header,
                batch_size,
                &request.task_id,
                temp_file.path(),
                &cancel_flag,
                &emit_progress,
            )
            .await?
        } else {
            // 通用驱动回退路径（如 Salesforce SOQL）。
            let query_result = driver.query_records(source, &effective_sql, None).await?;
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
            }
            let columns = extract_columns_from_records(&query_result.records);
            export_records_snapshot(
                &columns,
                &query_result.records,
                &table_name,
                request.format,
                request.include_header,
                batch_size,
                &request.task_id,
                temp_file.path(),
                &cancel_flag,
                &emit_progress,
            )?
        };

        emit_progress(ExportProgressPayload {
            task_id: request.task_id.clone(),
            exported_rows,
            total_rows: Some(exported_rows),
            phase: "finalizing".to_string(),
            message: "正在原子提交导出文件...".to_string(),
        });

        // 若目标文件已存在，`persist` 在 Windows 上也能安全覆盖。
        temp_file
            .persist(target_path)
            .map_err(|err| AppError::Biz(format!("保存导出文件失败: {}", err.error)))?;

        let file_size_bytes = std::fs::metadata(target_path).map(|m| m.len()).unwrap_or(0);
        let duration_ms = started_at.elapsed().as_millis() as u64;

        emit_progress(ExportProgressPayload {
            task_id: request.task_id.clone(),
            exported_rows,
            total_rows: Some(exported_rows),
            phase: "completed".to_string(),
            message: format!("导出完成，共 {exported_rows} 行"),
        });

        Ok(ExportResult {
            task_id: request.task_id,
            output_path: request.output_path,
            exported_rows,
            file_size_bytes,
            duration_ms,
        })
    }
}

/// 解析最终导出 SQL：若前端未传 SQL，则按目标表自动构造全表查询。
fn resolve_effective_export_sql(
    request: &ExportDataRequest,
    query_language: &str,
) -> Result<String, AppError> {
    let trimmed = request.sql.trim();
    if !trimmed.is_empty() {
        return Ok(trimmed.to_string());
    }
    let object_name = request
        .object_name
        .as_deref()
        .map(str::trim)
        .filter(|name| !name.is_empty())
        .ok_or_else(|| AppError::Biz("导出 SQL 与目标表名不能同时为空".to_string()))?;

    if query_language.eq_ignore_ascii_case("mysql") {
        let safe_table = ensure_safe_identifier(object_name, "表名")?;
        Ok(format!("SELECT * FROM `{safe_table}`"))
    } else {
        Err(AppError::Biz("当前数据源导出必须提供查询语句".to_string()))
    }
}

/// 流式拉取 MySQL 查询结果并按指定格式写入临时文件。
#[allow(clippy::too_many_arguments)]
async fn export_mysql_stream<F>(
    connection_manager: &Arc<ConnectionManager>,
    source: &SalesforceSource,
    sql: &str,
    table_name: &str,
    format: ExportFormat,
    include_header: bool,
    batch_size: usize,
    task_id: &str,
    temp_path: &Path,
    cancel_flag: &Arc<AtomicBool>,
    emit_progress: &F,
) -> Result<u64, AppError>
where
    F: Fn(ExportProgressPayload) + Send + Sync,
{
    let config = MySqlSourceConfig::from_source(source)?;
    let provider = MySqlProvider::with_connection_manager(Arc::clone(connection_manager));
    let pool = provider.acquire_pool(source, &config).await?;

    // XLSX 需要构造完整 Workbook，在内存缓冲行后由 rust_xlsxwriter 一次性写出。
    if format == ExportFormat::Xlsx {
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        let mut columns: Vec<String> = Vec::new();
        let mut exported_rows: u64 = 0;
        let mut row_cursor: u32 = 0;

        let mut stream = sqlx::query(sql).fetch(&pool);
        while let Some(row_res) = stream.next().await {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
            }
            let row = row_res.map_err(|err| AppError::Db(format!("流式读取查询结果失败: {err}")))?;
            if columns.is_empty() {
                columns = row
                    .columns()
                    .iter()
                    .map(|c| c.name().to_string())
                    .collect();
                if include_header {
                    for (col_idx, col_name) in columns.iter().enumerate() {
                        sheet
                            .write_string(0, col_idx as u16, col_name)
                            .map_err(|err| AppError::Biz(format!("写入 XLSX 表头失败: {err}")))?;
                    }
                    row_cursor = 1;
                }
            }

            for (col_idx, col) in row.columns().iter().enumerate() {
                let val = row_try_get_json_value(&row, col.name(), col.type_info().name());
                write_xlsx_cell(sheet, row_cursor, col_idx as u16, &val)?;
            }
            row_cursor = row_cursor.saturating_add(1);
            exported_rows += 1;

            if exported_rows % 500 == 0 {
                emit_progress(ExportProgressPayload {
                    task_id: task_id.to_string(),
                    exported_rows,
                    total_rows: None,
                    phase: "writing".to_string(),
                    message: format!("已写入 {exported_rows} 行到 XLSX..."),
                });
            }
        }

        workbook
            .save(temp_path)
            .map_err(|err| AppError::Biz(format!("保存 XLSX 文件失败: {err}")))?;
        return Ok(exported_rows);
    }

    let file = File::create(temp_path)
        .map_err(|err| AppError::Biz(format!("打开临时导出文件失败: {err}")))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);
    if format == ExportFormat::Csv {
        // 写入 UTF-8 BOM，确保 Excel 直接双击打开不乱码。
        writer
            .write_all(&[0xEF, 0xBB, 0xBF])
            .map_err(|err| AppError::Biz(format!("写入 CSV BOM 失败: {err}")))?;
    } else if format == ExportFormat::Json {
        writer
            .write_all(b"[\n")
            .map_err(|err| AppError::Biz(format!("写入 JSON 起始符失败: {err}")))?;
    }

    let mut columns: Vec<String> = Vec::new();
    let mut exported_rows: u64 = 0;
    let mut sql_insert_batch: Vec<Vec<Value>> = Vec::with_capacity(batch_size);

    let mut stream = sqlx::query(sql).fetch(&pool);
    while let Some(row_res) = stream.next().await {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
        }
        let row = row_res.map_err(|err| AppError::Db(format!("流式读取查询结果失败: {err}")))?;

        if columns.is_empty() {
            columns = row
                .columns()
                .iter()
                .map(|c| c.name().to_string())
                .collect();
            write_text_header(&mut writer, format, &columns, include_header)?;
        }

        let mut row_values = Vec::with_capacity(columns.len());
        for col in row.columns() {
            row_values.push(row_try_get_json_value(
                &row,
                col.name(),
                col.type_info().name(),
            ));
        }

        write_text_row(
            &mut writer,
            format,
            &columns,
            &row_values,
            exported_rows,
            table_name,
            batch_size,
            &mut sql_insert_batch,
        )?;
        exported_rows += 1;

        if exported_rows % 500 == 0 {
            emit_progress(ExportProgressPayload {
                task_id: task_id.to_string(),
                exported_rows,
                total_rows: None,
                phase: "writing".to_string(),
                message: format!("已导出 {exported_rows} 行..."),
            });
        }
    }

    finalize_text_writer(
        &mut writer,
        format,
        &columns,
        table_name,
        &mut sql_insert_batch,
    )?;
    writer
        .flush()
        .map_err(|err| AppError::Biz(format!("刷新导出文件缓冲区失败: {err}")))?;

    Ok(exported_rows)
}

/// 从通用驱动返回的记录集合中提取列名列表。
fn extract_columns_from_records(records: &[std::collections::HashMap<String, Value>]) -> Vec<String> {
    let Some(first) = records.first() else {
        return Vec::new();
    };
    let mut cols: Vec<String> = first
        .keys()
        .filter(|key| key.as_str() != "attributes")
        .cloned()
        .collect();
    cols.sort();
    cols
}

/// 将内存查询结果快照按指定格式写入临时文件（用于非流式通用驱动）。
#[allow(clippy::too_many_arguments)]
fn export_records_snapshot<F>(
    columns: &[String],
    records: &[std::collections::HashMap<String, Value>],
    table_name: &str,
    format: ExportFormat,
    include_header: bool,
    batch_size: usize,
    task_id: &str,
    temp_path: &Path,
    cancel_flag: &Arc<AtomicBool>,
    emit_progress: &F,
) -> Result<u64, AppError>
where
    F: Fn(ExportProgressPayload) + Send + Sync,
{
    if format == ExportFormat::Xlsx {
        let mut workbook = rust_xlsxwriter::Workbook::new();
        let sheet = workbook.add_worksheet();
        let mut row_cursor: u32 = 0;
        if include_header {
            for (col_idx, col_name) in columns.iter().enumerate() {
                sheet
                    .write_string(0, col_idx as u16, col_name)
                    .map_err(|err| AppError::Biz(format!("写入 XLSX 表头失败: {err}")))?;
            }
            row_cursor = 1;
        }
        let mut exported_rows: u64 = 0;
        for record in records {
            if cancel_flag.load(Ordering::Relaxed) {
                return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
            }
            for (col_idx, col_name) in columns.iter().enumerate() {
                let val = record.get(col_name).unwrap_or(&Value::Null);
                write_xlsx_cell(sheet, row_cursor, col_idx as u16, val)?;
            }
            row_cursor = row_cursor.saturating_add(1);
            exported_rows += 1;
        }
        workbook
            .save(temp_path)
            .map_err(|err| AppError::Biz(format!("保存 XLSX 文件失败: {err}")))?;
        return Ok(exported_rows);
    }

    let file = File::create(temp_path)
        .map_err(|err| AppError::Biz(format!("打开临时导出文件失败: {err}")))?;
    let mut writer = BufWriter::with_capacity(64 * 1024, file);
    if format == ExportFormat::Csv {
        writer
            .write_all(&[0xEF, 0xBB, 0xBF])
            .map_err(|err| AppError::Biz(format!("写入 CSV BOM 失败: {err}")))?;
    } else if format == ExportFormat::Json {
        writer
            .write_all(b"[\n")
            .map_err(|err| AppError::Biz(format!("写入 JSON 起始符失败: {err}")))?;
    }

    write_text_header(&mut writer, format, columns, include_header)?;
    let mut exported_rows: u64 = 0;
    let mut sql_insert_batch: Vec<Vec<Value>> = Vec::with_capacity(batch_size);

    for record in records {
        if cancel_flag.load(Ordering::Relaxed) {
            return Err(AppError::Biz("EXPORT_CANCELLED".to_string()));
        }
        let row_values: Vec<Value> = columns
            .iter()
            .map(|col| record.get(col).cloned().unwrap_or(Value::Null))
            .collect();
        write_text_row(
            &mut writer,
            format,
            columns,
            &row_values,
            exported_rows,
            table_name,
            batch_size,
            &mut sql_insert_batch,
        )?;
        exported_rows += 1;
        if exported_rows % 500 == 0 {
            emit_progress(ExportProgressPayload {
                task_id: task_id.to_string(),
                exported_rows,
                total_rows: Some(records.len() as u64),
                phase: "writing".to_string(),
                message: format!("已导出 {exported_rows} 行..."),
            });
        }
    }

    finalize_text_writer(
        &mut writer,
        format,
        columns,
        table_name,
        &mut sql_insert_batch,
    )?;
    writer
        .flush()
        .map_err(|err| AppError::Biz(format!("刷新导出文件缓冲区失败: {err}")))?;
    Ok(exported_rows)
}

/// 写入文本格式的表头行（CSV / TSV / Markdown）。
fn write_text_header(
    writer: &mut BufWriter<File>,
    format: ExportFormat,
    columns: &[String],
    include_header: bool,
) -> Result<(), AppError> {
    if columns.is_empty() {
        return Ok(());
    }
    match format {
        ExportFormat::Csv => {
            if include_header {
                let line = columns
                    .iter()
                    .map(|col| format_csv_cell(col))
                    .collect::<Vec<_>>()
                    .join(",");
                writeln!(writer, "{line}")
                    .map_err(|err| AppError::Biz(format!("写入 CSV 表头失败: {err}")))?;
            }
        }
        ExportFormat::Tsv => {
            if include_header {
                let line = columns
                    .iter()
                    .map(|col| format_tsv_cell(col))
                    .collect::<Vec<_>>()
                    .join("\t");
                writeln!(writer, "{line}")
                    .map_err(|err| AppError::Biz(format!("写入 TSV 表头失败: {err}")))?;
            }
        }
        ExportFormat::Markdown => {
            let header_line = format!(
                "| {} |",
                columns
                    .iter()
                    .map(|col| format_markdown_cell(col))
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
            let sep_line = format!(
                "| {} |",
                columns.iter().map(|_| "---").collect::<Vec<_>>().join(" | ")
            );
            writeln!(writer, "{header_line}\n{sep_line}")
                .map_err(|err| AppError::Biz(format!("写入 Markdown 表头失败: {err}")))?;
        }
        ExportFormat::Json | ExportFormat::SqlInsert | ExportFormat::Xlsx => {}
    }
    Ok(())
}

/// 写入单行文本数据（或累积 SQL INSERT 批次）。
#[allow(clippy::too_many_arguments)]
fn write_text_row(
    writer: &mut BufWriter<File>,
    format: ExportFormat,
    columns: &[String],
    row_values: &[Value],
    row_index: u64,
    table_name: &str,
    batch_size: usize,
    sql_insert_batch: &mut Vec<Vec<Value>>,
) -> Result<(), AppError> {
    match format {
        ExportFormat::Csv => {
            let line = row_values
                .iter()
                .map(|val| format_csv_cell(&json_value_to_plain_text(val)))
                .collect::<Vec<_>>()
                .join(",");
            writeln!(writer, "{line}")
                .map_err(|err| AppError::Biz(format!("写入 CSV 数据行失败: {err}")))?;
        }
        ExportFormat::Tsv => {
            let line = row_values
                .iter()
                .map(|val| format_tsv_cell(&json_value_to_plain_text(val)))
                .collect::<Vec<_>>()
                .join("\t");
            writeln!(writer, "{line}")
                .map_err(|err| AppError::Biz(format!("写入 TSV 数据行失败: {err}")))?;
        }
        ExportFormat::Markdown => {
            let line = format!(
                "| {} |",
                row_values
                    .iter()
                    .map(|val| format_markdown_cell(&json_value_to_plain_text(val)))
                    .collect::<Vec<_>>()
                    .join(" | ")
            );
            writeln!(writer, "{line}")
                .map_err(|err| AppError::Biz(format!("写入 Markdown 数据行失败: {err}")))?;
        }
        ExportFormat::Json => {
            let mut obj = serde_json::Map::with_capacity(columns.len());
            for (idx, col) in columns.iter().enumerate() {
                obj.insert(
                    col.clone(),
                    row_values.get(idx).cloned().unwrap_or(Value::Null),
                );
            }
            let prefix = if row_index == 0 { "  " } else { ",\n  " };
            let json_str = serde_json::to_string(&Value::Object(obj))
                .map_err(|err| AppError::Biz(format!("序列化 JSON 行失败: {err}")))?;
            write!(writer, "{prefix}{json_str}")
                .map_err(|err| AppError::Biz(format!("写入 JSON 行失败: {err}")))?;
        }
        ExportFormat::SqlInsert => {
            sql_insert_batch.push(row_values.to_vec());
            if sql_insert_batch.len() >= batch_size {
                flush_sql_insert_batch(writer, table_name, columns, sql_insert_batch)?;
            }
        }
        ExportFormat::Xlsx => {}
    }
    Ok(())
}

/// 完成文本文件尾部收尾（JSON 闭括号或刷新残留 SQL INSERT 批次）。
fn finalize_text_writer(
    writer: &mut BufWriter<File>,
    format: ExportFormat,
    columns: &[String],
    table_name: &str,
    sql_insert_batch: &mut Vec<Vec<Value>>,
) -> Result<(), AppError> {
    match format {
        ExportFormat::Json => {
            writeln!(writer, "\n]")
                .map_err(|err| AppError::Biz(format!("写入 JSON 结束符失败: {err}")))?;
        }
        ExportFormat::SqlInsert => {
            if !sql_insert_batch.is_empty() {
                flush_sql_insert_batch(writer, table_name, columns, sql_insert_batch)?;
            }
        }
        _ => {}
    }
    Ok(())
}

/// 将一批行输出为多值 `INSERT INTO ... VALUES (...), (...);` 语句。
fn flush_sql_insert_batch(
    writer: &mut BufWriter<File>,
    table_name: &str,
    columns: &[String],
    batch: &mut Vec<Vec<Value>>,
) -> Result<(), AppError> {
    if batch.is_empty() || columns.is_empty() {
        batch.clear();
        return Ok(());
    }
    let cols_sql = columns
        .iter()
        .map(|col| format!("`{}`", col.replace('`', "``")))
        .collect::<Vec<_>>()
        .join(", ");
    let escaped_table = table_name.replace('`', "``");
    let tuples = batch
        .iter()
        .map(|row| {
            let vals = row
                .iter()
                .map(format_sql_value_literal)
                .collect::<Vec<_>>()
                .join(", ");
            format!("({vals})")
        })
        .collect::<Vec<_>>()
        .join(",\n  ");
    writeln!(writer, "INSERT INTO `{escaped_table}` ({cols_sql}) VALUES\n  {tuples};")
        .map_err(|err| AppError::Biz(format!("写入 SQL INSERT 失败: {err}")))?;
    batch.clear();
    Ok(())
}

/// 写入单个 XLSX 单元格（保留数值类型与 NULL 空单元）。
fn write_xlsx_cell(
    sheet: &mut rust_xlsxwriter::Worksheet,
    row: u32,
    col: u16,
    value: &Value,
) -> Result<(), AppError> {
    match value {
        Value::Null => Ok(()),
        Value::Bool(flag) => sheet
            .write_boolean(row, col, *flag)
            .map(|_| ())
            .map_err(|err| AppError::Biz(format!("写入 XLSX 布尔值失败: {err}"))),
        Value::Number(num) => {
            if let Some(val) = num.as_f64() {
                sheet
                    .write_number(row, col, val)
                    .map(|_| ())
                    .map_err(|err| AppError::Biz(format!("写入 XLSX 数值失败: {err}")))
            } else {
                sheet
                    .write_string(row, col, num.to_string())
                    .map(|_| ())
                    .map_err(|err| AppError::Biz(format!("写入 XLSX 字符串失败: {err}")))
            }
        }
        Value::String(text) => sheet
            .write_string(row, col, text)
            .map(|_| ())
            .map_err(|err| AppError::Biz(format!("写入 XLSX 字符串失败: {err}")),
        ),
        Value::Array(_) | Value::Object(_) => sheet
            .write_string(row, col, value.to_string())
            .map(|_| ())
            .map_err(|err| AppError::Biz(format!("写入 XLSX 对象文本失败: {err}"))),
    }
}

/// 将 JSON 值转换为纯文本（用于 CSV / TSV / Markdown）。
pub fn json_value_to_plain_text(value: &Value) -> String {
    match value {
        Value::Null => String::new(),
        Value::Bool(flag) => flag.to_string(),
        Value::Number(num) => num.to_string(),
        Value::String(text) => text.clone(),
        Value::Array(_) | Value::Object(_) => value.to_string(),
    }
}

/// 将 JSON 值格式化为 SQL INSERT 字面量。
pub fn format_sql_value_literal(value: &Value) -> String {
    match value {
        Value::Null => "NULL".to_string(),
        Value::Bool(flag) => {
            if *flag {
                "1".to_string()
            } else {
                "0".to_string()
            }
        }
        Value::Number(num) => num.to_string(),
        Value::String(text) => format!("'{}'", escape_sql_literal(text)),
        Value::Array(_) | Value::Object(_) => format!("'{}'", escape_sql_literal(&value.to_string())),
    }
}

/// 转义 CSV 单元格。
fn format_csv_cell(raw: &str) -> String {
    if raw.contains([',', '"', '\n', '\r']) {
        format!("\"{}\"", raw.replace('"', "\"\""))
    } else {
        raw.to_string()
    }
}

/// 转义 TSV 单元格（替换制表符与换行符为空格，保持单行结构）。
fn format_tsv_cell(raw: &str) -> String {
    raw.replace(['\t', '\r', '\n'], " ")
}

/// 转义 Markdown 表格单元格。
fn format_markdown_cell(raw: &str) -> String {
    raw.replace('|', "\\|")
        .replace('\r', "")
        .replace('\n', "<br/>")
}
