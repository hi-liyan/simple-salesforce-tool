use crate::error::AppError;
use crate::storage::{plugin_repo, Storage};

/// 插件持久化领域服务：为前端插件 `ctx.storage` 提供按 `plugin_id` 隔离的读写能力。
pub struct PluginService<'a> {
    /// 存储入口。
    storage: &'a Storage,
}

impl<'a> PluginService<'a> {
    /// 创建插件服务。
    pub fn new(storage: &'a Storage) -> Self {
        Self { storage }
    }

    /// 读取插件键值。
    pub fn get_kv(&self, plugin_id: &str, key: &str) -> Result<Option<String>, AppError> {
        self.storage
            .read(|conn| plugin_repo::get_plugin_kv(conn, plugin_id, key))
    }

    /// 写入插件键值。
    pub fn set_kv(&self, plugin_id: &str, key: &str, value_json: &str) -> Result<(), AppError> {
        self.storage
            .write_tx(|tx| plugin_repo::set_plugin_kv(tx, plugin_id, key, value_json))
    }

    /// 删除插件键值。
    pub fn delete_kv(&self, plugin_id: &str, key: &str) -> Result<(), AppError> {
        self.storage
            .write_tx(|tx| plugin_repo::delete_plugin_kv(tx, plugin_id, key))
    }
}

#[cfg(test)]
mod tests {
    use super::PluginService;
    use crate::storage::Storage;

    #[test]
    fn isolates_plugin_kv_by_plugin_id() {
        let storage = Storage::open_test().unwrap();
        let service = PluginService::new(&storage);

        service
            .set_kv("builtin.qr-code", "history", "[1,2]")
            .unwrap();
        service
            .set_kv("builtin.json-diff", "history", "[3,4]")
            .unwrap();

        assert_eq!(
            service.get_kv("builtin.qr-code", "history").unwrap(),
            Some("[1,2]".to_string())
        );
        assert_eq!(
            service.get_kv("builtin.json-diff", "history").unwrap(),
            Some("[3,4]".to_string())
        );

        service.delete_kv("builtin.qr-code", "history").unwrap();
        assert_eq!(service.get_kv("builtin.qr-code", "history").unwrap(), None);
        assert_eq!(
            service.get_kv("builtin.json-diff", "history").unwrap(),
            Some("[3,4]".to_string())
        );
    }
}
