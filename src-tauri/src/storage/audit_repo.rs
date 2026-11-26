use chrono::Utc;
use rusqlite::{params, Connection, Transaction};
use serde::{Deserialize, Serialize};

use crate::error::AppError;

/// SQL 执行审计记录入参。
#[derive(Debug, Clone)]
pub struct SqlExecutionAuditRecord {
    /// 数据源 ID。
    pub source_id: String,
    /// 数据源名称。
    pub source_name: String,
    /// 数据源环境标识（如 default / prod / staging）。
    pub environment: String,
    /// 操作来源（console / datagrid_commit / ai_tool）。
    pub operation_source: String,
    /// 用户或上层提交的原始 SQL/SOQL。
    pub raw_sql: String,
    /// 实际下发给数据源的完整 SQL/SOQL。
    pub executed_sql: String,
    /// 语句类型（SELECT / INSERT / UPDATE / DELETE / DDL / SOQL 等）。
    pub statement_type: String,
    /// 风险等级（low / medium / high / blocked）。
    pub risk_level: String,
    /// 两阶段提交计划哈希（非表格提交可为空）。
    pub plan_hash: String,
    /// 影响行数。
    pub rows_affected: i64,
    /// 返回行数。
    pub rows_returned: i64,
    /// 执行耗时（毫秒）。
    pub duration_ms: i64,
    /// 是否执行成功。
    pub success: bool,
    /// 失败或拦截原因。
    pub error_message: String,
}

/// SQL 执行审计查询条目。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SqlExecutionAuditEntry {
    /// 自增主键。
    pub id: i64,
    /// 数据源 ID。
    pub source_id: String,
    /// 数据源名称。
    pub source_name: String,
    /// 环境标识。
    pub environment: String,
    /// 操作来源。
    pub operation_source: String,
    /// 原始 SQL。
    pub raw_sql: String,
    /// 实际执行 SQL。
    pub executed_sql: String,
    /// 语句类型。
    pub statement_type: String,
    /// 风险等级。
    pub risk_level: String,
    /// 计划哈希。
    pub plan_hash: String,
    /// 影响行数。
    pub rows_affected: i64,
    /// 返回行数。
    pub rows_returned: i64,
    /// 耗时（毫秒）。
    pub duration_ms: i64,
    /// 是否成功。
    pub success: bool,
    /// 错误信息。
    pub error_message: String,
    /// 执行时间（RFC3339）。
    pub executed_at: String,
}

/// 写入一条不可抵赖的 SQL 执行审计记录。
pub fn insert_sql_execution_audit(
    tx: &Transaction<'_>,
    record: &SqlExecutionAuditRecord,
) -> Result<i64, AppError> {
    let now = Utc::now().to_rfc3339();
    tx.execute(
        "INSERT INTO sql_execution_audit (
            source_id, source_name, environment, operation_source,
            raw_sql, executed_sql, statement_type, risk_level, plan_hash,
            rows_affected, rows_returned, duration_ms, success, error_message, executed_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15)",
        params![
            record.source_id,
            record.source_name,
            record.environment,
            record.operation_source,
            record.raw_sql,
            record.executed_sql,
            record.statement_type,
            record.risk_level,
            record.plan_hash,
            record.rows_affected,
            record.rows_returned,
            record.duration_ms,
            if record.success { 1 } else { 0 },
            record.error_message,
            now
        ],
    )?;
    Ok(tx.last_insert_rowid())
}

/// 按数据源或全局分页查询 SQL 执行审计记录。
pub fn list_sql_execution_audits(
    connection: &Connection,
    source_id: Option<&str>,
    limit: i64,
) -> Result<Vec<SqlExecutionAuditEntry>, AppError> {
    let safe_limit = limit.clamp(1, 500);
    let mut results = Vec::new();

    if let Some(target_source_id) = source_id.filter(|v| !v.trim().is_empty()) {
        let mut stmt = connection.prepare(
            "SELECT id, source_id, source_name, environment, operation_source,
                    raw_sql, executed_sql, statement_type, risk_level, plan_hash,
                    rows_affected, rows_returned, duration_ms, success, error_message, executed_at
             FROM sql_execution_audit
             WHERE source_id = ?1
             ORDER BY executed_at DESC, id DESC
             LIMIT ?2",
        )?;
        let rows = stmt.query_map(params![target_source_id, safe_limit], map_audit_row)?;
        for row in rows {
            results.push(row?);
        }
    } else {
        let mut stmt = connection.prepare(
            "SELECT id, source_id, source_name, environment, operation_source,
                    raw_sql, executed_sql, statement_type, risk_level, plan_hash,
                    rows_affected, rows_returned, duration_ms, success, error_message, executed_at
             FROM sql_execution_audit
             ORDER BY executed_at DESC, id DESC
             LIMIT ?1",
        )?;
        let rows = stmt.query_map(params![safe_limit], map_audit_row)?;
        for row in rows {
            results.push(row?);
        }
    }

    Ok(results)
}

/// 映射审计表查询行。
fn map_audit_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<SqlExecutionAuditEntry> {
    Ok(SqlExecutionAuditEntry {
        id: row.get(0)?,
        source_id: row.get(1)?,
        source_name: row.get(2)?,
        environment: row.get(3)?,
        operation_source: row.get(4)?,
        raw_sql: row.get(5)?,
        executed_sql: row.get(6)?,
        statement_type: row.get(7)?,
        risk_level: row.get(8)?,
        plan_hash: row.get(9)?,
        rows_affected: row.get(10)?,
        rows_returned: row.get(11)?,
        duration_ms: row.get(12)?,
        success: row.get::<_, i64>(13)? != 0,
        error_message: row.get(14)?,
        executed_at: row.get(15)?,
    })
}
