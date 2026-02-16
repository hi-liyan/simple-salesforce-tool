use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

use rusqlite::Connection;
use tauri::Manager;

use crate::llm::LlmChatMessage;
use crate::salesforce::SalesforceClient;

/// 全局应用状态：包含数据库连接和 HTTP 客户端。
pub struct AppState {
    /// SQLite 连接（通过 Mutex 串行化 DB 访问，避免并发写冲突）。
    pub db: Mutex<Connection>,
    /// Salesforce HTTP 客户端（可复用连接池）。
    pub sf_client: SalesforceClient,
    /// 当前进行中的 CLI 登录取消令牌（关闭登录窗时置为 true）。
    pub cli_login_cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// LLM 多轮会话缓存（按 conversationId 保存历史消息）。
    pub llm_conversations: Mutex<HashMap<String, Vec<LlmChatMessage>>>,
    /// LLM 流式请求取消令牌（按 requestId 存储）。
    pub llm_stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
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
