use serde_json::Value;

use crate::error::AppError;
use crate::models::{SalesforceSource, SourceSecretView, SourceUpsertPayload};
use crate::storage::{secret_repo, source_repo, Storage};

/// 数据源领域服务：统一负责普通配置与 secret 分表写入。
pub struct SourceService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> SourceService<'a> {
    /// 创建数据源服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 列出公共数据源 DTO：不直接返回 secret 明文。
    pub fn list_sources(&self) -> Result<Vec<SalesforceSource>, AppError> {
        self.storage.read(|conn| {
            let records = source_repo::list_sources(conn)?;
            Ok(records
                .into_iter()
                .map(|record| source_repo::into_public_source(record, String::new()))
                .collect())
        })
    }

    /// 读取单个公共数据源 DTO。
    pub fn get_source(&self, source_id: &str) -> Result<SalesforceSource, AppError> {
        self.storage.read(|conn| {
            let record = source_repo::get_source(conn, source_id)?;
            Ok(source_repo::into_public_source(record, String::new()))
        })
    }

    /// 读取运行时数据源：包含 provider 所需的 secret 明文。
    pub fn get_runtime_source(&self, source_id: &str) -> Result<SalesforceSource, AppError> {
        self.storage.write_tx(|tx| {
            let record = source_repo::get_source(tx, source_id)?;
            let secrets = self.read_source_secrets(tx, &record)?;
            Ok(source_repo::into_public_source(
                record,
                secrets
                    .get("accessToken")
                    .or_else(|| secrets.get("password"))
                    .cloned()
                    .unwrap_or_default(),
            ))
        })
    }

    /// 创建数据源。
    pub fn create_source(&self, payload: SourceUpsertPayload) -> Result<SalesforceSource, AppError> {
        self.storage.write_tx(|tx| {
            let source_id = uuid::Uuid::new_v4().to_string();
            let secret_bundle_id = self.persist_source_secrets(tx, &source_id, None, &payload)?;
            let record =
                source_repo::insert_source(tx, &source_id, &payload, secret_bundle_id.as_deref())?;
            Ok(source_repo::into_public_source(record, String::new()))
        })
    }

    /// 更新数据源。
    pub fn update_source(
        &self,
        source_id: &str,
        payload: SourceUpsertPayload,
    ) -> Result<SalesforceSource, AppError> {
        self.storage.write_tx(|tx| {
            let current = source_repo::get_source(tx, source_id)?;
            let secret_bundle_id = self.persist_source_secrets(
                tx,
                source_id,
                current.secret_bundle_id.as_deref(),
                &payload,
            )?;
            let record =
                source_repo::update_source(tx, source_id, &payload, secret_bundle_id.as_deref())?;
            Ok(source_repo::into_public_source(record, String::new()))
        })
    }

    /// 指定 ID 执行 upsert：供 CLI 数据源同步链路使用。
    pub fn upsert_source_with_id(
        &self,
        source_id: &str,
        payload: SourceUpsertPayload,
    ) -> Result<SalesforceSource, AppError> {
        self.storage.write_tx(|tx| {
            let existing = source_repo::get_source(tx, source_id).ok();
            let secret_bundle_id = self.persist_source_secrets(
                tx,
                source_id,
                existing.as_ref().and_then(|item| item.secret_bundle_id.as_deref()),
                &payload,
            )?;
            let record = source_repo::upsert_source_with_id(
                tx,
                source_id,
                &payload,
                secret_bundle_id.as_deref(),
            )?;
            Ok(source_repo::into_public_source(record, String::new()))
        })
    }

    /// 删除数据源。
    pub fn delete_source(&self, source_id: &str) -> Result<(), AppError> {
        self.storage.write_tx(|tx| source_repo::delete_source(tx, source_id))
    }

    /// 调整数据源排序。
    pub fn reorder_sources(&self, ordered_ids: &[String]) -> Result<Vec<SalesforceSource>, AppError> {
        self.storage.write(|conn| {
            source_repo::reorder_sources(conn, ordered_ids)?;
            let records = source_repo::list_sources(conn)?;
            Ok(records
                .into_iter()
                .map(|record| source_repo::into_public_source(record, String::new()))
                .collect())
        })
    }

    /// 清理未保留的 CLI 数据源。
    pub fn prune_cli_sources(&self, keep_ids: &[String]) -> Result<(), AppError> {
        self.storage.write(|conn| source_repo::prune_cli_sources(conn, keep_ids))
    }

    /// 读取设置页显式 secret 明文视图。
    pub fn get_source_secret_view(&self, source_id: &str) -> Result<SourceSecretView, AppError> {
        self.storage.write_tx(|tx| {
            let record = source_repo::get_source(tx, source_id)?;
            let mut view = SourceSecretView {
                source_id: source_id.to_string(),
                access_token: String::new(),
                password: String::new(),
            };
            if let Some(bundle_id) = &record.secret_bundle_id {
                view.access_token = secret_repo::read_secret_item_plaintext(
                    tx,
                    bundle_id,
                    "accessToken",
                )?
                .unwrap_or_default();
                view.password = secret_repo::read_secret_item_plaintext(tx, bundle_id, "password")?
                    .unwrap_or_default();
                secret_repo::insert_secret_access_audit(
                    tx,
                    bundle_id,
                    None,
                    "read_plaintext_for_edit",
                    "settings.edit-source",
                    true,
                    "允许设置页显式读取 secret 明文",
                    "",
                    "{}",
                )?;
            }
            Ok(view)
        })
    }

    /// 从 payload 中抽取并持久化数据源 secret。
    fn persist_source_secrets(
        &self,
        tx: &rusqlite::Transaction<'_>,
        source_id: &str,
        existing_bundle_id: Option<&str>,
        payload: &SourceUpsertPayload,
    ) -> Result<Option<String>, AppError> {
        let secrets = extract_source_secrets(payload);
        if secrets.is_empty() && existing_bundle_id.is_none() {
            return Ok(None);
        }
        let bundle_id = secret_repo::ensure_secret_bundle(
            tx,
            "data_source",
            source_id,
            existing_bundle_id,
            "data source secrets",
        )?;
        let keep_keys = secrets.keys().cloned().collect::<Vec<_>>();
        for (secret_key, plain_text) in secrets {
            secret_repo::upsert_secret_item(
                tx,
                &secret_repo::SecretItemRecord {
                    id: uuid::Uuid::new_v4().to_string(),
                    bundle_id: bundle_id.clone(),
                    secret_key,
                    plain_text,
                },
            )?;
        }
        secret_repo::delete_missing_secret_items(tx, &bundle_id, &keep_keys)?;
        Ok(Some(bundle_id))
    }

    /// 读取 source 当前 secret 字典。
    fn read_source_secrets(
        &self,
        tx: &rusqlite::Transaction<'_>,
        record: &source_repo::SourceRecord,
    ) -> Result<std::collections::HashMap<String, String>, AppError> {
        let mut secrets = std::collections::HashMap::new();
        let Some(bundle_id) = &record.secret_bundle_id else {
            return Ok(secrets);
        };
        for key in ["accessToken", "password"] {
            if let Some(value) = secret_repo::read_secret_item_plaintext(tx, bundle_id, key)? {
                secrets.insert(key.to_string(), value);
            }
        }
        Ok(secrets)
    }
}

/// 从 `SourceUpsertPayload` 中提取需要独立入库的 secret。
fn extract_source_secrets(payload: &SourceUpsertPayload) -> std::collections::HashMap<String, String> {
    let mut secrets = std::collections::HashMap::new();
    let access_token = payload.access_token.trim().to_string();
    if !access_token.is_empty() {
        secrets.insert("accessToken".to_string(), access_token);
    }
    if let Some(password) = payload
        .config_json
        .as_object()
        .and_then(|config| config.get("password"))
        .and_then(Value::as_str)
        .map(str::to_string)
    {
        if !password.is_empty() {
            secrets.insert("password".to_string(), password);
        }
    }
    secrets
}

#[cfg(test)]
mod tests {
    use super::SourceService;
    use crate::models::SourceUpsertPayload;
    use crate::storage::Storage;
    use serde_json::json;

    #[test]
    fn upsert_source_persists_secret_in_secret_items_and_can_read_plaintext_for_edit() {
        let storage = Storage::open_test().unwrap();
        let service = SourceService::new(&storage);

        let created = service
            .create_source(SourceUpsertPayload {
                name: "Prod".into(),
                source_type: "salesforce".into(),
                config_json: json!({
                    "instanceUrl": "https://example.my.salesforce.com",
                    "apiVersion": "v61.0"
                }),
                instance_url: "https://example.my.salesforce.com".into(),
                access_token: "secret-token".into(),
                api_version: "v61.0".into(),
            })
            .unwrap();

        let list_item = service.get_source(created.id.as_str()).unwrap();
        assert_eq!(list_item.access_token, "", "普通 DTO 不应再直接返回明文 token");

        let edit_view = service.get_source_secret_view(created.id.as_str()).unwrap();
        assert_eq!(
            edit_view.access_token, "secret-token",
            "设置页编辑链路必须能显式拿到完整明文"
        );
    }
}
