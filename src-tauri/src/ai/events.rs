use serde::{Deserialize, Serialize};
use serde_json::Value;

/// AI 助手运行模式：ask 为只读问答与生成，agent 为可自主调用查询与诊断工具的多轮循环。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum AiAssistantMode {
    Ask,
    Agent,
}

impl Default for AiAssistantMode {
    fn default() -> Self {
        Self::Ask
    }
}

/// 工具定义：描述供模型调用的函数名、说明、JSON Schema 参数与是否允许并发执行。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolDefinition {
    /// 工具唯一名称。
    pub name: String,
    /// 工具用途说明。
    pub description: String,
    /// JSON Schema 参数对象。
    pub parameters: Value,
    /// 是否允许在同一轮内与其他只读工具并行执行。
    pub parallel_ok: bool,
}

/// 模型发起的单次工具调用请求。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    /// 工具调用 ID（用于回传 tool_result 关联）。
    pub id: String,
    /// 目标工具名称。
    pub name: String,
    /// 调用参数 JSON。
    pub arguments: Value,
}

/// 单次工具执行结果。
#[derive(Debug, Clone)]
pub struct ToolResult {
    /// 对应工具调用 ID。
    pub tool_call_id: String,
    /// 工具名称。
    pub tool_name: String,
    /// 序列化文本结果（截断保护后）。
    pub content: String,
    /// 是否执行失败。
    pub is_error: bool,
}

/// 用户消息携带的图片附件（Data URL 形式）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiImageAttachment {
    /// 图片文件名。
    pub name: String,
    /// 图片 Data URL（如 `data:image/png;base64,...`）。
    pub data_url: String,
}

/// 内部多轮对话消息（兼容纯文本、多模态图片、模型工具调用与工具结果回传）。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatMessage {
    /// 角色：system / user / assistant / tool。
    pub role: String,
    /// 文本正文。
    pub content: String,
    /// 当 role == "assistant" 且模型发起工具调用时携带。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub tool_calls: Vec<ToolCall>,
    /// 当 role == "tool" 时关联的 tool_call_id。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_call_id: Option<String>,
    /// 当 role == "tool" 时关联的工具名。
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub tool_name: Option<String>,
    /// 用户消息携带的图片附件列表（仅多模态 user 消息使用）。
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub images: Vec<AiImageAttachment>,
}

/// 流式推送给前端的 Agent 事件（参考 dbx `AgentEvent` 协议）。
#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "snake_case")]
pub enum AgentEvent {
    /// 单轮推理开始。
    TurnStart { turn: usize },
    /// 单轮推理结束。
    TurnEnd { turn: usize },
    /// 正文增量文本。
    TextDelta { delta: String },
    /// 深度思考增量文本。
    ReasoningDelta { delta: String },
    /// 工具调用开始。
    ToolCallStart {
        tool_call_id: String,
        tool_name: String,
        args: Value,
    },
    /// 工具调用结束。
    ToolCallEnd {
        tool_call_id: String,
        tool_name: String,
        result: String,
        is_error: bool,
    },
    /// 非生产写操作或高危 SQL 需要前端二次确认。
    WriteSqlConfirmationRequired { sql: String, reason: String },
    /// 生产环境或只读数据源写操作被安全网关硬拦截。
    ProductionWriteBlocked { sql: String, reason: String },
    /// 历史上下文触发自动压缩。
    ContextCompacted {
        removed_count: usize,
        remaining_count: usize,
    },
    /// 整次 Agent 运行结束。
    AgentEnd {
        input_tokens: u64,
        output_tokens: u64,
    },
    /// 发生异常或被中断。
    Error { message: String },
}

/// 前端监听的 `ai-agent-event` 事件载荷。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentEventPayload {
    /// 当前流式会话请求 ID。
    pub session_id: String,
    /// 扁平化展开的事件字段。
    #[serde(flatten)]
    pub event: AgentEvent,
}

/// 前端发起流式 Agent 对话的请求参数。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiAgentStreamRequest {
    /// 本次流式请求唯一 ID（用于事件路由与取消中断）。
    pub session_id: String,
    /// 目标数据源 ID。
    pub source_id: String,
    /// 指定使用的 AI 配置 ID（为空时自动使用默认配置）。
    pub config_id: Option<String>,
    /// 运行模式：ask 或 agent。
    #[serde(default)]
    pub mode: AiAssistantMode,
    /// 快捷技能标识（general / generate / explain / optimize / fix / explore）。
    #[serde(default)]
    pub action: Option<String>,
    /// 用户当前输入消息。
    pub prompt: String,
    /// 历史消息列表（仅含 user / assistant 文本轮次）。
    #[serde(default)]
    pub history: Vec<AgentChatMessage>,
    /// 当前编辑器中的 SQL/SOQL 草稿。
    #[serde(default)]
    pub current_editor_sql: String,
    /// 当前编辑器中的选中文本。
    #[serde(default)]
    pub selected_editor_sql: String,
    /// 当前上下文对象/表提示（及 `@` 引用的对象列表）。
    #[serde(default)]
    pub mentioned_objects: Vec<String>,
    /// 当前工作区状态摘要（当前 Tab 类型、表名、筛选条件与查询结果摘要）。
    #[serde(default)]
    pub workspace_context_summary: String,
    /// 当前轮次用户附加的图片列表（多模态视觉输入）。
    #[serde(default)]
    pub images: Vec<AiImageAttachment>,
    /// 最近一次执行报错信息（用于 Fix with AI）。
    #[serde(default)]
    pub error_message: String,
    /// 全局自定义指令或模板补充说明。
    #[serde(default)]
    pub custom_instructions: String,
    /// 用户已在前端确认执行的写操作 SQL 快照（Fail-Closed 精确匹配）。
    #[serde(default)]
    pub confirmed_write_sql: Option<String>,
    /// 确认时绑定的目标数据源 ID 快照，防止切换数据源后越权执行。
    #[serde(default)]
    pub confirmed_source_id: Option<String>,
    /// 最大 Agent 循环轮数（默认 20，限制在 5..=40）。
    #[serde(default)]
    pub max_turns: Option<usize>,
}
