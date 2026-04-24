use crate::error::AppError;
use crate::models::{SecretAuditEntry, SecretAuditRecord};
use crate::storage::{log_repo, secret_repo, Storage};

/// 诊断服务：负责系统日志与 secret 访问审计。
pub struct DiagnosticService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> DiagnosticService<'a> {
    /// 创建诊断服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 记录 secret 读取审计，并同步写结构化系统日志。
    pub fn record_secret_read(&self, record: SecretAuditRecord) -> Result<(), AppError> {
        self.storage.write_tx(|tx| {
            secret_repo::insert_secret_access_audit(
                tx,
                &record.bundle_id,
                record.secret_item_id.as_deref(),
                &record.action,
                &record.trigger_source,
                record.success,
                &record.message,
                &record.correlation_id,
                &serde_json::to_string(&record.detail_json)?,
            )?;
            log_repo::insert_system_log(
                tx,
                &log_repo::SystemLogRecord {
                    created_at: chrono::Utc::now().to_rfc3339(),
                    level: "INFO".to_string(),
                    category: "SECRET_ACCESS".to_string(),
                    action: record.action,
                    source_id: None,
                    workspace_tab_id: None,
                    target: None,
                    success: record.success,
                    message: record.message,
                    detail_text: String::new(),
                    detail_json: serde_json::to_string(&record.detail_json)?,
                    correlation_id: record.correlation_id,
                    retention_policy: "standard".to_string(),
                    expires_at: None,
                },
            )?;
            Ok(())
        })
    }

    /// 列出指定 bundle 的 secret 审计记录。
    pub fn list_secret_audits(&self, bundle_id: &str) -> Result<Vec<SecretAuditEntry>, AppError> {
        self.storage.read(|conn| {
            let mut statement = conn.prepare(
                "SELECT id, bundle_id, secret_item_id, action, trigger_source, success, message, correlation_id, detail_json, created_at
                 FROM secret_access_audit
                 WHERE bundle_id = ?1
                 ORDER BY id ASC",
            )?;
            let rows = statement.query_map([bundle_id], |row| {
                let detail_json: String = row.get(8)?;
                Ok(SecretAuditEntry {
                    id: row.get(0)?,
                    bundle_id: row.get(1)?,
                    secret_item_id: row.get(2)?,
                    action: row.get(3)?,
                    trigger_source: row.get(4)?,
                    success: row.get::<_, i64>(5)? != 0,
                    message: row.get(6)?,
                    correlation_id: row.get(7)?,
                    detail_json: serde_json::from_str(&detail_json).unwrap_or(Value::Null),
                    created_at: row.get(9)?,
                })
            })?;
            Ok(rows.collect::<Result<Vec<_>, _>>()?)
        })
    }
}

use serde_json::Value;

#[cfg(test)]
mod tests {
    use super::DiagnosticService;
    use crate::models::SecretAuditRecord;
    use crate::storage::Storage;

    #[test]
    fn reading_secret_for_edit_writes_secret_access_audit_and_redacts_system_log() {
        let storage = Storage::open_test().unwrap();
        let diagnostic = DiagnosticService::new(&storage);

        diagnostic
            .record_secret_read(SecretAuditRecord {
                bundle_id: "bundle-1".into(),
                secret_item_id: Some("item-1".into()),
                action: "read_plaintext_for_edit".into(),
                trigger_source: "settings.edit-source".into(),
                success: true,
                message: "允许设置页显式读取 secret 明文".into(),
                correlation_id: String::new(),
                detail_json: serde_json::Value::Object(serde_json::Map::new()),
            })
            .unwrap();

        let audits = diagnostic.list_secret_audits("bundle-1").unwrap();
        assert_eq!(audits.len(), 1);
        assert!(!audits[0].message.contains("secret-token"));
    }
}
