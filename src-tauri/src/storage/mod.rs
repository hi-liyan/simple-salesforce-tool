pub mod audit_repo;
pub mod automation_repo;
pub mod bootstrap;
pub mod config_repo;
pub mod log_repo;
pub mod metadata_repo;
pub mod migrations;
pub mod plugin_repo;
pub mod pragma;
pub mod schema;
pub mod secret_repo;
pub mod source_repo;
pub mod tx;
pub mod workspace_repo;

use rusqlite::{Connection, OpenFlags};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use crate::error::AppError;

/// 只读连接池最大保留连接数。
const MAX_READ_POOL_SIZE: usize = 4;

/// SQLite 存储入口：采用“单写连接 + 只读连接池”读写分离架构，充分发挥 WAL 并发能力。
pub struct Storage {
    /// 写连接：通过单把互斥锁串行化写事务，配合 `SQLITE_BUSY` 退避重试保障写入一致性。
    write_connection: Mutex<Connection>,
    /// 只读连接池：并发读请求各自检出独立只读连接，与写事务互不阻塞。
    read_pool: Mutex<Vec<Connection>>,
    /// 数据库文件路径：供按需创建只读连接及诊断场景使用。
    db_path: PathBuf,
}

impl Storage {
    /// 打开或引导数据库，并执行版本化增量迁移。
    pub fn open_or_bootstrap(data_dir: &Path) -> Result<Self, AppError> {
        let db_path = bootstrap::open_or_bootstrap_storage(data_dir)?;
        let mut connection = Connection::open(&db_path)?;
        pragma::apply_write_pragmas(&connection)?;
        migrations::run_migrations(&mut connection)?;
        Ok(Self {
            write_connection: Mutex::new(connection),
            read_pool: Mutex::new(Vec::new()),
            db_path,
        })
    }

    /// 为测试创建独立的临时数据库目录。
    #[cfg(test)]
    pub fn open_test() -> Result<Self, AppError> {
        let root = std::env::temp_dir().join(format!("sqlite-v2-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&root)?;
        Self::open_or_bootstrap(&root)
    }

    /// 并发只读查询：从只读连接池检出独立 `SQLITE_OPEN_READ_ONLY` 连接，不阻塞写事务。
    pub fn read<T, F>(&self, reader: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError>,
    {
        let connection = self.checkout_read_connection()?;
        let result = reader(&connection);
        self.return_read_connection(connection);
        result
    }

    /// 普通写入：通过写连接执行。
    pub fn write<T, F>(&self, writer: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError>,
    {
        let connection = self
            .write_connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取写数据库锁失败: {error}")))?;
        writer(&connection)
    }

    /// 显式事务写入：所有跨表写入统一通过这里进入。
    pub fn write_tx<T, F>(&self, writer: F) -> Result<T, AppError>
    where
        F: FnOnce(&rusqlite::Transaction<'_>) -> Result<T, AppError>,
    {
        let mut connection = self
            .write_connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取写数据库锁失败: {error}")))?;
        let transaction = connection.transaction()?;
        let result = writer(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    /// 带 `SQLITE_BUSY` 退避重试的显式事务写入。
    pub fn write_tx_retry<T, F>(&self, mut writer: F) -> Result<T, AppError>
    where
        F: FnMut(&rusqlite::Transaction<'_>) -> Result<T, AppError>,
    {
        tx::with_sqlite_retry(|| {
            let mut connection = self
                .write_connection
                .lock()
                .map_err(|error| AppError::Biz(format!("获取写数据库锁失败: {error}")))?;
            let transaction = connection.transaction()?;
            let result = writer(&transaction)?;
            transaction.commit()?;
            Ok(result)
        })
    }

    /// 返回当前数据库文件路径。
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }

    /// 迁移期兼容入口：供尚未收口至 `services/` 的旧命令临时复用，新代码严禁调用。
    #[deprecated(note = "禁止直接暴露裸连接锁，请使用 read()/write_tx() 与 repo 层")]
    pub fn connection(&self) -> Result<MutexGuard<'_, Connection>, AppError> {
        self.write_connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取数据库锁失败: {error}")))
    }

    /// 从只读连接池检出连接；池空时按只读标志新建连接。
    fn checkout_read_connection(&self) -> Result<Connection, AppError> {
        if let Ok(mut pool) = self.read_pool.lock() {
            if let Some(conn) = pool.pop() {
                return Ok(conn);
            }
        }
        let conn = Connection::open_with_flags(
            &self.db_path,
            OpenFlags::SQLITE_OPEN_READ_ONLY | OpenFlags::SQLITE_OPEN_NO_MUTEX,
        )?;
        pragma::apply_read_pragmas(&conn)?;
        Ok(conn)
    }

    /// 归还只读连接到池中，超出上限则直接关闭释放。
    fn return_read_connection(&self, connection: Connection) {
        if let Ok(mut pool) = self.read_pool.lock() {
            if pool.len() < MAX_READ_POOL_SIZE {
                pool.push(connection);
            }
        }
    }
}
