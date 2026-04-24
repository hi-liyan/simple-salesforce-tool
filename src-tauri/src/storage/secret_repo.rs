use chrono::Utc;
use rusqlite::{params, OptionalExtension, Transaction};

use crate::error::AppError;

/// 单条 secret 容器记录。
#[derive(Debug, Clone)]
pub struct SecretBundleRecord {
    /// 容器 ID。
    pub id: String,
    /// 归属类型。
    pub owner_type: String,
    /// 归属对象 ID。
    pub owner_id: String,
}

/// 单条 secret 项。
#[derive(Debug, Clone)]
pub struct SecretItemRecord {
    /// secret 主键。
    pub id: String,
    /// 容器 ID。
    pub bundle_id: String,
    /// secret 键名。
    pub secret_key: String,
    /// 当前阶段仍保存为可逆明文，但已独立分域。
    pub plain_text: String,
}

/// 确保 secret bundle 存在。
pub fn ensure_secret_bundle(
    tx: &Transaction<'_>,
    owner_type: &str,
    owner_id: &str,
    existing_bundle_id: Option<&str>,
    description: &str,
) -> Result<String, AppError> {
    let now = Utc::now().to_rfc3339();
    let bundle_id = existing_bundle_id
        .filter(|value| !value.trim().is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| uuid::Uuid::new_v4().to_string());
    tx.execute(
        "INSERT INTO secret_bundles (id, owner_type, owner_id, status, description, created_at, updated_at)
         VALUES (?1, ?2, ?3, 'active', ?4, ?5, ?5)
         ON CONFLICT(id) DO UPDATE SET
           owner_type = excluded.owner_type,
           owner_id = excluded.owner_id,
           description = excluded.description,
           updated_at = excluded.updated_at",
        params![bundle_id, owner_type, owner_id, description, now],
    )?;
    Ok(bundle_id)
}

/// 写入或更新单条 secret。
pub fn upsert_secret_item(tx: &Transaction<'_>, record: &SecretItemRecord) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO secret_items (
            id, bundle_id, secret_key, cipher_text, algorithm, key_version, nonce, fingerprint,
            last_verified_at, rotated_at, expires_at, updated_at
        ) VALUES (?1, ?2, ?3, ?4, 'plain-text/v1', 1, '', ?5, NULL, NULL, NULL, ?6)
         ON CONFLICT(bundle_id, secret_key) DO UPDATE SET
           cipher_text = excluded.cipher_text,
           algorithm = excluded.algorithm,
           key_version = excluded.key_version,
           nonce = excluded.nonce,
           fingerprint = excluded.fingerprint,
           updated_at = excluded.updated_at",
        params![
            record.id,
            record.bundle_id,
            record.secret_key,
            record.plain_text,
            build_secret_fingerprint(&record.plain_text),
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

/// 删除容器下未保留的 secret 键。
pub fn delete_missing_secret_items(
    tx: &Transaction<'_>,
    bundle_id: &str,
    keep_keys: &[String],
) -> Result<(), AppError> {
    let existing_keys = list_secret_keys(tx, bundle_id)?;
    for key in existing_keys {
        if keep_keys.iter().any(|item| item == &key) {
            continue;
        }
        tx.execute(
            "DELETE FROM secret_items WHERE bundle_id = ?1 AND secret_key = ?2",
            params![bundle_id, key],
        )?;
    }
    Ok(())
}

/// 读取 bundle 下的单条 secret 明文。
pub fn read_secret_item_plaintext(
    tx: &Transaction<'_>,
    bundle_id: &str,
    secret_key: &str,
) -> Result<Option<String>, AppError> {
    let value = tx
        .query_row(
            "SELECT cipher_text FROM secret_items WHERE bundle_id = ?1 AND secret_key = ?2",
            params![bundle_id, secret_key],
            |row| row.get::<_, String>(0),
        )
        .optional()?;
    Ok(value)
}

/// 读取 source 关联的 secret bundle。
pub fn find_bundle_by_owner(
    tx: &Transaction<'_>,
    owner_type: &str,
    owner_id: &str,
) -> Result<Option<SecretBundleRecord>, AppError> {
    let record = tx
        .query_row(
            "SELECT id, owner_type, owner_id FROM secret_bundles
             WHERE owner_type = ?1 AND owner_id = ?2
             ORDER BY updated_at DESC
             LIMIT 1",
            params![owner_type, owner_id],
            |row| {
                Ok(SecretBundleRecord {
                    id: row.get(0)?,
                    owner_type: row.get(1)?,
                    owner_id: row.get(2)?,
                })
            },
        )
        .optional()?;
    Ok(record)
}

/// 写入 secret 访问审计。
pub fn insert_secret_access_audit(
    tx: &Transaction<'_>,
    bundle_id: &str,
    secret_item_id: Option<&str>,
    action: &str,
    trigger_source: &str,
    success: bool,
    message: &str,
    correlation_id: &str,
    detail_json: &str,
) -> Result<(), AppError> {
    tx.execute(
        "INSERT INTO secret_access_audit (
            bundle_id, secret_item_id, action, trigger_source, success,
            message, correlation_id, detail_json, created_at
        ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
        params![
            bundle_id,
            secret_item_id,
            action,
            trigger_source,
            if success { 1 } else { 0 },
            message,
            correlation_id,
            detail_json,
            Utc::now().to_rfc3339()
        ],
    )?;
    Ok(())
}

/// 列出 bundle 下已有的 secret 键。
fn list_secret_keys(tx: &Transaction<'_>, bundle_id: &str) -> Result<Vec<String>, AppError> {
    let mut statement = tx.prepare(
        "SELECT secret_key FROM secret_items WHERE bundle_id = ?1 ORDER BY secret_key ASC",
    )?;
    let rows = statement.query_map([bundle_id], |row| row.get::<_, String>(0))?;
    Ok(rows.collect::<Result<Vec<_>, _>>()?)
}

/// 生成轻量指纹：当前阶段只用于审计与“值已变化”判断。
fn build_secret_fingerprint(value: &str) -> String {
    format!("len:{}:{}", value.chars().count(), value.is_empty())
}
