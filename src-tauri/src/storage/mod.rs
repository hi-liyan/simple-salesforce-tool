pub mod automation_repo;
pub mod bootstrap;
pub mod config_repo;
pub mod log_repo;
pub mod metadata_repo;
pub mod pragma;
pub mod schema;
pub mod secret_repo;
pub mod source_repo;
pub mod tx;
pub mod workspace_repo;

use rusqlite::Connection;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::error::AppError;

/// SQLite v2 存储入口：统一管理连接、事务与 schema 初始化。
pub struct Storage {
    /// SQLite 连接：当前阶段仍使用单连接串行化访问。
    connection: Mutex<Connection>,
    /// 数据库文件路径：供诊断与测试场景读取。
    db_path: PathBuf,
}

impl Storage {
    /// 打开或 bootstrap v2 数据库。
    pub fn open_or_bootstrap(data_dir: &Path) -> Result<Self, AppError> {
        let db_path = bootstrap::open_or_bootstrap_storage(data_dir)?;
        let connection = Connection::open(&db_path)?;
        pragma::apply_pragmas(&connection)?;
        schema::init_v2_schema(&connection)?;
        Ok(Self {
            connection: Mutex::new(connection),
            db_path,
        })
    }

    /// 为测试创建独立的临时数据库目录。
    #[cfg(test)]
    pub fn open_test() -> Result<Self, AppError> {
        let root = std::env::temp_dir().join(format!(
            "sqlite-v2-test-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root)?;
        Self::open_or_bootstrap(&root)
    }

    /// 读取数据库：只暴露 `&Connection`，避免外部直接持有连接。
    pub fn read<T, F>(&self, reader: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError>,
    {
        let connection = self
            .connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取数据库锁失败: {error}")))?;
        reader(&connection)
    }

    /// 普通写入：与读取共用同一连接边界，便于逐步收敛旧逻辑。
    pub fn write<T, F>(&self, writer: F) -> Result<T, AppError>
    where
        F: FnOnce(&Connection) -> Result<T, AppError>,
    {
        let connection = self
            .connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取数据库锁失败: {error}")))?;
        writer(&connection)
    }

    /// 显式事务写入：所有跨表写入统一通过这里进入。
    pub fn write_tx<T, F>(&self, writer: F) -> Result<T, AppError>
    where
        F: FnOnce(&rusqlite::Transaction<'_>) -> Result<T, AppError>,
    {
        let mut connection = self
            .connection
            .lock()
            .map_err(|error| AppError::Biz(format!("获取数据库锁失败: {error}")))?;
        let transaction = connection.transaction()?;
        let result = writer(&transaction)?;
        transaction.commit()?;
        Ok(result)
    }

    /// 返回当前数据库文件路径。
    pub fn db_path(&self) -> &Path {
        &self.db_path
    }
}
