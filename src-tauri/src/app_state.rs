use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::sync::Mutex;

use tauri::Manager;

use crate::drivers::connection_manager::ConnectionManager;
use crate::drivers::DriverRegistry;
use crate::lan_file_receiver::LanFileReceiverRuntime;
use crate::llm::LlmChatMessage;
use crate::salesforce::SalesforceClient;
use crate::services::mutation_plan_service::MutationPlanCache;
use crate::storage::Storage;
use crate::terminal::TerminalSession;

/// 全局应用状态：包含 SQLite 存储入口、驱动注册表、连接池管理器与共享客户端。
pub struct AppState {
    /// SQLite 存储入口：命令层与服务层统一通过它访问本地库。
    pub storage: Storage,
    /// 数据源驱动注册表：按 source_type 动态路由到对应实现。
    pub driver_registry: DriverRegistry,
    /// 数据源连接池管理器：按 source_id 缓存与驱逐连接池。
    pub connection_manager: Arc<ConnectionManager>,
    /// 两阶段变更计划缓存：保证预览与落库执行一致性。
    pub mutation_plan_cache: MutationPlanCache,
    /// Salesforce HTTP 客户端（可复用连接池）。
    pub sf_client: Arc<SalesforceClient>,
    /// 当前进行中的 CLI 登录取消令牌（关闭登录窗时置为 true）。
    pub cli_login_cancel: Mutex<Option<Arc<AtomicBool>>>,
    /// LLM 多轮会话缓存（按 conversationId 保存历史消息）。
    pub llm_conversations: Mutex<HashMap<String, Vec<LlmChatMessage>>>,
    /// LLM 流式请求取消令牌（按 requestId 存储）。
    pub llm_stream_cancels: Mutex<HashMap<String, Arc<AtomicBool>>>,
    /// 进行中的慢查询取消令牌（按 queryId 存储）。
    pub query_cancels: Mutex<HashMap<String, tokio::sync::watch::Sender<bool>>>,
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
