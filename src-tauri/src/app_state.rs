use std::path::PathBuf;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use crate::salesforce::SalesforceClient;

/// 全局应用状态：包含数据库连接和 HTTP 客户端。
pub struct AppState {
    /// SQLite 连接（通过 Mutex 串行化 DB 访问，避免并发写冲突）。
    pub db: Mutex<Connection>,
    /// Salesforce HTTP 客户端（可复用连接池）。
    pub sf_client: SalesforceClient,
}

/// 解析并创建应用数据目录，确保数据库可持久化。
pub fn ensure_data_dir(app_handle: &tauri::AppHandle) -> Result<PathBuf, String> {
    let mut dir = app_handle
        .path()
        .app_data_dir()
        .map_err(|error| format!("获取应用数据目录失败: {error}"))?;

    dir.push("simple-salesforce-tool");
    std::fs::create_dir_all(&dir).map_err(|error| format!("创建应用数据目录失败: {error}"))?;
    Ok(dir)
}
