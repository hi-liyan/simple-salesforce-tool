use crate::error::AppError;
use crate::storage::audit_repo::{self, SqlExecutionAuditEntry, SqlExecutionAuditRecord};
use crate::storage::Storage;

/// SQL 执行审计服务：可靠记录每次查询/变更/拦截，禁止静默吞掉审计错误。
pub struct AuditService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> AuditService<'a> {
    /// 创建审计服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 记录一次 SQL 执行或拦截审计；使用退避重试写事务，写库失败时向调用方显式返回错误。
    pub fn record_sql_execution(&self, record: &SqlExecutionAuditRecord) -> Result<i64, AppError> {
        self.storage
            .write_tx_retry(|tx| audit_repo::insert_sql_execution_audit(tx, record))
    }

    /// 查询最近执行的 SQL 审计日志。
    pub fn list_sql_audits(
        &self,
        source_id: Option<&str>,
        limit: i64,
    ) -> Result<Vec<SqlExecutionAuditEntry>, AppError> {
        self.storage
            .read(|conn| audit_repo::list_sql_execution_audits(conn, source_id, limit))
    }
}

#[cfg(test)]
mod tests {
    use super::AuditService;
    use crate::storage::audit_repo::SqlExecutionAuditRecord;
    use crate::storage::Storage;

    #[test]
    fn records_and_lists_sql_execution_audits() {
        let storage = Storage::open_test().unwrap();
        let service = AuditService::new(&storage);

        service
            .record_sql_execution(&SqlExecutionAuditRecord {
                source_id: "src-1".into(),
                source_name: "Prod MySQL".into(),
                environment: "prod".into(),
                operation_source: "console".into(),
                raw_sql: "SELECT * FROM users".into(),
                executed_sql: "SELECT * FROM users LIMIT 200".into(),
                statement_type: "SELECT".into(),
                risk_level: "low".into(),
                plan_hash: String::new(),
                rows_affected: 0,
                rows_returned: 10,
                duration_ms: 15,
                success: true,
                error_message: String::new(),
            })
            .unwrap();

        let list = service.list_sql_audits(Some("src-1"), 20).unwrap();
        assert_eq!(list.len(), 1);
        assert_eq!(list[0].executed_sql, "SELECT * FROM users LIMIT 200");
        assert!(list[0].success);
    }
}
