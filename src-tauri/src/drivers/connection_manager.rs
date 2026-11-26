use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use sqlx::mysql::MySqlPool;
use tokio::sync::Mutex;

/// 缓存的 MySQL 连接池条目：绑定配置指纹，配置变更时自动淘汰重建。
struct CachedMySqlPool {
    /// 连接配置指纹哈希。
    config_hash: u64,
    /// 复用的 sqlx 连接池。
    pool: MySqlPool,
}

/// 统一连接池管理器：按 `source_id` 缓存并复用关系型数据库连接池，并在配置变更或退出时清理。
#[derive(Default)]
pub struct ConnectionManager {
    /// MySQL 连接池缓存表。
    mysql_pools: Mutex<HashMap<String, CachedMySqlPool>>,
}

impl ConnectionManager {
    /// 创建连接管理器。
    pub fn new() -> Self {
        Self {
            mysql_pools: Mutex::new(HashMap::new()),
        }
    }

    /// 计算任意连接配置的稳定指纹哈希，用于判断连接池是否需要重建。
    pub fn compute_config_hash(fingerprint_input: &str) -> u64 {
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        fingerprint_input.hash(&mut hasher);
        hasher.finish()
    }

    /// 读取已缓存且配置指纹一致的 MySQL 连接池。
    pub async fn get_mysql_pool(&self, source_id: &str, config_hash: u64) -> Option<MySqlPool> {
        let guard = self.mysql_pools.lock().await;
        guard.get(source_id).and_then(|entry| {
            if entry.config_hash == config_hash {
                Some(entry.pool.clone())
            } else {
                None
            }
        })
    }

    /// 写入或替换 MySQL 连接池；若旧池存在则在锁外异步关闭。
    pub async fn put_mysql_pool(&self, source_id: &str, config_hash: u64, pool: MySqlPool) {
        let old_pool = {
            let mut guard = self.mysql_pools.lock().await;
            guard
                .insert(
                    source_id.to_string(),
                    CachedMySqlPool { config_hash, pool },
                )
                .map(|item| item.pool)
        };
        if let Some(old) = old_pool {
            old.close().await;
        }
    }

    /// 驱逐指定数据源的缓存连接池（配置更新或删除数据源时调用）。
    pub async fn evict(&self, source_id: &str) {
        let old_pool = {
            let mut guard = self.mysql_pools.lock().await;
            guard.remove(source_id).map(|item| item.pool)
        };
        if let Some(old) = old_pool {
            old.close().await;
        }
    }

    /// 关闭全部已缓存的连接池（应用退出时调用）。
    pub async fn close_all(&self) {
        let pools = {
            let mut guard = self.mysql_pools.lock().await;
            guard
                .drain()
                .map(|(_, entry)| entry.pool)
                .collect::<Vec<_>>()
        };
        for pool in pools {
            pool.close().await;
        }
    }
}
