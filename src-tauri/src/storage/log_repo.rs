use rusqlite::{params, Connection, Transaction};

use crate::error::AppError;
use crate::models::{SystemLogEntry, SystemLogPage};

/// 结构化系统日志记录。
#[derive(Debug, Clone)]
pub struct SystemLogRecord {
    /// 日志时间。
    pub created_at: String,
    /// 日志级别。
    pub level: String,
    /// 日志分类。
    pub category: String,
    /// 动作。
    pub action: String,
    /// 关联数据源。
    pub source_id: Option<String>,
    /// 关联工作区标签。
    pub workspace_tab_id: Option<String>,
    /// 目标对象。
    pub target: Option<String>,
    /// 是否成功。
    pub success: bool,
    /// 摘要信息。
    pub message: String,
    /// 文本详情。
    pub detail_text: String,
    /// JSON 详情。
    pub detail_json: String,
    /// 关联 ID。
    pub correlation_id: String,
    /// 保留策略。
    pub retention_policy: String,
    /// 过期时间。
    pub expires_at: Option<String>,
}

/// 写入系统日志。
pub fn insert_system_log(tx: &Transaction<'_>, log: &SystemLogRecord) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO system_logs (
            created_at, level, category, action, source_id, workspace_tab_id, target,
            success, message, detail_text, detail_json, correlation_id, retention_policy, expires_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)",
        params![
            log.created_at,
            log.level,
            log.category,
            log.action,
            log.source_id,
            log.workspace_tab_id,
            log.target,
            if log.success { 1 } else { 0 },
            log.message,
            log.detail_text,
            log.detail_json,
            log.correlation_id,
            log.retention_policy,
            log.expires_at,
        ],
    )?;
    Ok(())
}

/// 分页读取系统日志。
pub fn list_system_logs(
    connection: &Connection,
    page: i64,
    page_size: i64,
) -> Result<SystemLogPage, AppError> {
    let safe_page = page.max(1);
    let safe_page_size = page_size.clamp(1, 200);
    let offset = (safe_page - 1) * safe_page_size;
    let total: i64 =
        connection.query_row("SELECT COUNT(*) FROM system_logs", [], |row| row.get(0))?;
    let mut statement = connection.prepare(
        "SELECT id, created_at, level, category, action, source_id, target, success, message, detail_text
         FROM system_logs
         ORDER BY created_at DESC, id DESC
         LIMIT ?1 OFFSET ?2",
    )?;
    let rows = statement.query_map(params![safe_page_size, offset], |row| {
        Ok(SystemLogEntry {
            id: row.get(0)?,
            created_at: row.get(1)?,
            level: row.get(2)?,
            category: row.get(3)?,
            action: row.get(4)?,
            source_id: row.get(5)?,
            target: row.get(6)?,
            success: row.get::<_, i64>(7)? != 0,
            message: row.get(8)?,
            detail: row
                .get::<_, String>(9)
                .ok()
                .filter(|value| !value.trim().is_empty()),
        })
    })?;
    Ok(SystemLogPage {
        items: rows.collect::<Result<Vec<_>, _>>()?,
        page: safe_page,
        page_size: safe_page_size,
        total,
    })
}
