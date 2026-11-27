use std::sync::Arc;
use tauri::State;
use tokio::sync::Notify;

use crate::ai::events::AgentChatMessage;
use crate::ai::provider::stream_model_turn;
use crate::app_state::AppState;
use crate::models::{
    AiActionItem, AiChatTurnV2Request, AiChatTurnV2Response, AiDiagnostics, LlmSettings,
};
use crate::storage::ai_repo::AiConfigRecord;

/// AI 兼容编排器：保留 `ai_chat_turn_v2` 兼容接口，底层已切换至新版多 Provider 流式引擎。
pub struct AiOrchestrator;

impl AiOrchestrator {
    /// 执行兼容单轮对话。
    pub async fn run_turn(
        _app: &tauri::AppHandle,
        _state: &State<'_, AppState>,
        llm_settings: &LlmSettings,
        payload: &AiChatTurnV2Request,
    ) -> Result<AiChatTurnV2Response, String> {
        let temp_cfg = AiConfigRecord {
            id: "compat-default".to_string(),
            name: "Compat".to_string(),
            provider: llm_settings.provider.clone(),
            api_style: "completions".to_string(),
            base_url: llm_settings.base_url.clone(),
            model: llm_settings.model.clone(),
            timeout_ms: llm_settings.timeout_ms as i64,
            is_default: true,
            created_at: String::new(),
            updated_at: String::new(),
        };
        let cancel_notify = Arc::new(Notify::new());
        let messages = vec![AgentChatMessage {
            role: "user".to_string(),
            content: payload.message.clone(),
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            images: Vec::new(),
        }];
        let output = stream_model_turn(
            &temp_cfg,
            &llm_settings.api_key,
            "你是 DataStudio 数据库 AI 助手，请用简洁中文回答。",
            &messages,
            &[],
            &cancel_notify,
            |_| {},
            |_| {},
        )
        .await
        .map_err(|e| e.to_string())?;

        Ok(AiChatTurnV2Response {
            conversation_id: payload
                .conversation_id
                .clone()
                .unwrap_or_else(|| format!("conv-{}", uuid::Uuid::new_v4())),
            state: "answer".to_string(),
            assistant_message: output.text,
            questions: Vec::new(),
            proposed_soql: None,
            actions: vec![AiActionItem {
                action_type: "none".to_string(),
                label: "完成".to_string(),
            }],
            diagnostics: AiDiagnostics {
                risk_level: "low".to_string(),
                warnings: Vec::new(),
                tools_used: Vec::new(),
            },
        })
    }
}
