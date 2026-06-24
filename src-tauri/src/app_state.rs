use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

use tauri::Manager;

use crate::lan_file_receiver::LanFileReceiverRuntime;
use crate::llm::LlmChatMessage;
use crate::salesforce::SalesforceClient;
use crate::storage::Storage;
use crate::terminal::TerminalSession;

/// 全局应用状态：包含 SQLite v2 存储入口和共享客户端。
pub struct AppState {
    /// SQLite v2 存储入口：命令层统一通过它访问本地库。
    pub storage: Storage,
    /// Salesforce HTTP 客户端（可复用连接池）。
    pub sf_client: SalesforceClient,
    /// 当前进行中的 CLI 登录取消令牌（关闭登录窗时置为 true）。
    pub cli_login_cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// LLM 多轮会话缓存（按 conversationId 保存历史消息）。
    pub llm_conversations: Mutex<HashMap<String, Vec<LlmChatMessage>>>,
    /// LLM 流式请求取消令牌（按 requestId 存储）。
    pub llm_stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 终端会话池（按前端 Tab ID 持有 PTY 进程句柄）。
    pub terminal_sessions: Mutex<HashMap<String, TerminalSession>>,
    /// 局域网文件接收服务运行时（包含端口与关闭句柄）。
    pub lan_file_receiver: Mutex<Option<LanFileReceiverRuntime>>,
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
