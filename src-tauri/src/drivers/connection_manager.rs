use std::collections::HashMap;
use std::hash::{Hash, Hasher};

use sqlx::mysql::MySqlPool;
use sqlx::pool::PoolConnection;
use sqlx::MySql;
use tokio::sync::Mutex;

use crate::drivers::{ConsoleTransactionStatus, TransactionMode};

/// 缓存的 MySQL 连接池条目：绑定配置指纹，配置变更时自动淘汰重建。
struct CachedMySqlPool {
    /// 连接配置指纹哈希。
    config_hash: u64,
    /// 复用的 sqlx 连接池。
    pool: MySqlPool,
}

/// MySQL 控制台交互式事务会话状态：按控制台 Tab 绑定物理连接以维持跨语句事务上下文。
pub struct ConsoleTxSession {
    /// 当前绑定的数据源 ID。
    pub source_id: String,
    /// 当前事务模式（auto / manual / smart）。
    pub mode: TransactionMode,
    /// 当前是否已开启未提交事务。
    pub in_transaction: bool,
    /// 锁定的物理连接（仅在开启或维持会话事务时持有）。
    pub conn: Option<PoolConnection<MySql>>,
    /// 未提交 SQL 语句摘要（供前端 Transaction Log 展示）。
    pub uncommitted_sqls: Vec<String>,
}

impl ConsoleTxSession {
    /// 生成面向前端的事务状态快照。
    pub fn to_status(&self, session_id: &str) -> ConsoleTransactionStatus {
        ConsoleTransactionStatus {
            session_id: session_id.to_string(),
            source_id: self.source_id.clone(),
            mode: self.mode,
            in_transaction: self.in_transaction,
            uncommitted_sqls: self.uncommitted_sqls.clone(),
            supported: true,
        }
    }
}

/// 统一连接池管理器：按 `source_id` 缓存并复用关系型数据库连接池，并托管控制台事务会话连接。
#[derive(Default)]
pub struct ConnectionManager {
    /// MySQL 连接池缓存表。
    mysql_pools: Mutex<HashMap<String, CachedMySqlPool>>,
    /// MySQL 控制台事务会话表（key 为 `console_tab_id`）。
    console_sessions: Mutex<HashMap<String, ConsoleTxSession>>,
}

impl ConnectionManager {
    /// 创建连接管理器。
    pub fn new() -> Self {
        Self {
            mysql_pools: Mutex::new(HashMap::new()),
            console_sessions: Mutex::new(HashMap::new()),
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

    /// 读取指定控制台会话的事务状态快照（不持有锁进行数据库 IO）。
    pub async fn get_console_session_status(
        &self,
        session_id: &str,
        source_id: &str,
        default_mode: TransactionMode,
    ) -> ConsoleTransactionStatus {
        let guard = self.console_sessions.lock().await;
        if let Some(session) = guard.get(session_id) {
            if session.source_id == source_id {
                return session.to_status(session_id);
            }
        }
        ConsoleTransactionStatus {
            session_id: session_id.to_string(),
            source_id: source_id.to_string(),
            mode: default_mode,
            in_transaction: false,
            uncommitted_sqls: Vec::new(),
            supported: true,
        }
    }

    /// 取出（或按默认模式新建）控制台事务会话，供单次执行/提交/回滚独占使用。
    /// 若原有会话绑定了其他数据源，则先在锁外安全回滚旧连接后再新建会话。
    pub async fn take_or_init_console_session(
        &self,
        session_id: &str,
        source_id: &str,
        default_mode: TransactionMode,
    ) -> ConsoleTxSession {
        let removed = {
            let mut guard = self.console_sessions.lock().await;
            guard.remove(session_id)
        };
        if let Some(existing) = removed {
            if existing.source_id == source_id {
                return existing;
            }
            // 行内注释：会话切换了数据源，先安全回滚并释放旧连接再创建新会话。
            rollback_and_release_session(existing).await;
        }
        ConsoleTxSession {
            source_id: source_id.to_string(),
            mode: default_mode,
            in_transaction: false,
            conn: None,
            uncommitted_sqls: Vec::new(),
        }
    }

    /// 归还控制台事务会话至缓存表。
    pub async fn put_console_session(&self, session_id: String, session: ConsoleTxSession) {
        let displaced = {
            let mut guard = self.console_sessions.lock().await;
            guard.insert(session_id, session)
        };
        if let Some(old) = displaced {
            rollback_and_release_session(old).await;
        }
    }

    /// 关闭并清理指定控制台会话（若存在未提交事务则自动回滚后归还连接）。
    pub async fn close_console_session(&self, session_id: &str) {
        let removed = {
            let mut guard = self.console_sessions.lock().await;
            guard.remove(session_id)
        };
        if let Some(session) = removed {
            rollback_and_release_session(session).await;
        }
    }

    /// 驱逐指定数据源的缓存连接池，并回滚清理关联的控制台会话。
    pub async fn evict(&self, source_id: &str) {
        let sessions_to_close = {
            let mut guard = self.console_sessions.lock().await;
            let keys: Vec<String> = guard
                .iter()
                .filter(|(_, session)| session.source_id == source_id)
                .map(|(k, _)| k.clone())
                .collect();
            keys.into_iter()
                .filter_map(|k| guard.remove(&k))
                .collect::<Vec<_>>()
        };
        for session in sessions_to_close {
            rollback_and_release_session(session).await;
        }

        let old_pool = {
            let mut guard = self.mysql_pools.lock().await;
            guard.remove(source_id).map(|item| item.pool)
        };
        if let Some(old) = old_pool {
            old.close().await;
        }
    }

    /// 关闭全部已缓存的连接池与控制台会话（应用退出时调用）。
    pub async fn close_all(&self) {
        let sessions = {
            let mut guard = self.console_sessions.lock().await;
            guard
                .drain()
                .map(|(_, session)| session)
                .collect::<Vec<_>>()
        };
        for session in sessions {
            rollback_and_release_session(session).await;
        }

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

/// 安全回滚并释放会话持有的物理连接。
async fn rollback_and_release_session(mut session: ConsoleTxSession) {
    if let Some(mut conn) = session.conn.take() {
        if session.in_transaction {
            let _ = sqlx::query("ROLLBACK").execute(&mut *conn).await;
        }
        let _ = sqlx::query("SET autocommit = 1").execute(&mut *conn).await;
        drop(conn);
    }
}
