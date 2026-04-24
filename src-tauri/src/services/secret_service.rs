use crate::error::AppError;
use crate::storage::{secret_repo, Storage};

/// Secret 领域服务：统一封装按 owner 读取 secret。
pub struct SecretService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> SecretService<'a> {
    /// 创建 secret 服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 读取 source 下指定 secret 键的明文。
    pub fn read_source_secret(
        &self,
        source_id: &str,
        secret_key: &str,
    ) -> Result<Option<String>, AppError> {
        self.storage.write_tx(|tx| {
            let bundle = secret_repo::find_bundle_by_owner(tx, "data_source", source_id)?;
            let Some(bundle) = bundle else {
                return Ok(None);
            };
            secret_repo::read_secret_item_plaintext(tx, &bundle.id, secret_key)
        })
    }
}
