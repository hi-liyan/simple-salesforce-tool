use serde::{Deserialize, Serialize};

/// LLM 聊天消息角色。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LlmChatRole {
    /// 系统提示词角色。
    System,
    /// 用户输入角色。
    User,
    /// 助手回复角色。
    Assistant,
}

/// LLM 聊天消息。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LlmChatMessage {
    /// 消息角色。
    pub role: LlmChatRole,
    /// 消息内容。
    pub content: String,
}
