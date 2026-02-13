use rig::completion::Prompt;
use rig::prelude::CompletionClient;
use rig::providers::openai;
use serde::Deserialize;
use tauri::State;

use crate::ai::tools::{
    FindObjectsTool, GetFieldMetadataTool, GetObjectMetadataTool, GetRelationshipGraphTool,
    SearchFieldsTool,
};
use crate::app_state::AppState;
use crate::llm::{LlmChatMessage, LlmChatRole};
use crate::models::{
    AiActionItem, AiChatTurnV2Request, AiChatTurnV2Response, AiDiagnostics, LlmSettings,
};

/// AI 编排器：完全使用 rig agent + tools 生成结构化结果。
pub struct AiOrchestrator;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RigSoqlOutput {
    mode: Option<String>,
    status: Option<String>,
    questions: Option<Vec<String>>,
    answer: Option<String>,
    soql: Option<String>,
    reason: Option<String>,
}

impl AiOrchestrator {
    /// 执行 AI v2 单轮对话：rig 负责工具调用与推理，后端负责状态落库与协议映射。
    pub async fn run_turn(
        app: &tauri::AppHandle,
        state: &State<'_, AppState>,
        llm_settings: &LlmSettings,
        payload: &AiChatTurnV2Request,
    ) -> Result<AiChatTurnV2Response, String> {
        let user_message = payload.message.trim().to_string();
        if user_message.is_empty() {
            return Err("用户输入不能为空。".to_string());
        }
        if llm_settings.api_key.trim().is_empty() {
            return Err("LLM apiKey 未配置，请先到设置页保存。".to_string());
        }
        // 非明确生成意图时，后续链路将硬性忽略 SOQL 输出。
        let allow_soql_generation = has_explicit_soql_generation_intent(&user_message);

        let conversation_id = payload
            .conversation_id
            .clone()
            .filter(|item| !item.trim().is_empty())
            .unwrap_or_else(|| format!("conv-{}", uuid::Uuid::new_v4()));

        let history = {
            let map = state
                .llm_conversations
                .lock()
                .map_err(|error| format!("LLM 会话锁失败: {error}"))?;
            map.get(&conversation_id).cloned().unwrap_or_default()
        };

        let client = openai::Client::<reqwest::Client>::builder()
            .api_key(llm_settings.api_key.clone())
            .base_url(llm_settings.base_url.clone())
            .build()
            .map_err(|error| format!("构建 rig OpenAI 客户端失败: {error}"))?;

        let model = client.completion_model(llm_settings.model.clone());
        let agent = rig::agent::AgentBuilder::new(model)
            .preamble(&build_system_prompt(allow_soql_generation))
            .temperature(0.1)
            .max_tokens(1800)
            .tool(FindObjectsTool {
                app: app.clone(),
                source_id: payload.source_id.clone(),
            })
            .tool(GetObjectMetadataTool {
                app: app.clone(),
                source_id: payload.source_id.clone(),
            })
            .tool(SearchFieldsTool {
                app: app.clone(),
                source_id: payload.source_id.clone(),
            })
            .tool(GetFieldMetadataTool {
                app: app.clone(),
                source_id: payload.source_id.clone(),
            })
            .tool(GetRelationshipGraphTool {
                app: app.clone(),
                source_id: payload.source_id.clone(),
            })
            .build();

        let composed_prompt =
            build_user_prompt(&user_message, payload, &history, allow_soql_generation);
        let raw = agent
            .prompt(composed_prompt)
            .max_turns(6)
            .await
            .map_err(|error| format!("rig agent 调用失败: {error}"))?;

        let parsed = parse_rig_soql_output(&raw);
        let response = map_to_v2_response(&conversation_id, parsed, allow_soql_generation);

        persist_conversation_turn(state, &conversation_id, &user_message, &response)?;
        Ok(response)
    }
}

/// 判断用户是否明确表达“生成 SOQL”意图（严格匹配，避免普通问答误触发）。
fn has_explicit_soql_generation_intent(user_message: &str) -> bool {
    let normalized = user_message.to_lowercase();
    let compact = normalized.split_whitespace().collect::<String>();

    // 否定表达优先级最高：用户明确说“不要生成 SOQL”时必须禁用生成。
    let deny_markers = [
        "不要生成soql",
        "不用生成soql",
        "先别生成soql",
        "不需要soql",
        "dontgeneratesoql",
        "don'tgeneratesoql",
        "donotgeneratesoql",
        "nosoql",
    ];
    if deny_markers.iter().any(|item| compact.contains(item)) {
        return false;
    }

    let explicit_markers = [
        "生成soql",
        "输出soql",
        "写soql",
        "给我soql",
        "构造soql",
        "请生成soql",
        "请输出soql",
        "generatesoql",
        "buildsoql",
        "writesoql",
        "outputsoql",
        "createsoql",
        "givemesoql",
    ];
    explicit_markers.iter().any(|item| compact.contains(item))
}

/// 组装系统提示词：要求模型必须通过工具读取元数据，并输出 JSON。
fn build_system_prompt(allow_soql_generation: bool) -> String {
    let generation_policy = if allow_soql_generation {
        "6) 本轮已明确要求生成 SOQL：当信息充分时可返回 mode=generate、status=ready，并提供非空 soql。"
    } else {
        "6) 本轮未明确要求生成 SOQL：必须返回 mode=answer 或 mode=clarify，status 必须为 clarify，soql 必须为空字符串或 null。"
    };
    r#"
你是 Salesforce SOQL 专家助手。
必须遵守：
1) 只能使用工具返回的元数据，不允许臆造对象、字段、关系。
2) 可使用工具：
   - find_salesforce_objects
   - get_salesforce_object_metadata
   - search_salesforce_object_fields
   - get_salesforce_field_metadata
   - get_salesforce_object_relationship_graph
3) 仅允许生成 SELECT 语句，不允许 INSERT/UPDATE/DELETE/UPSERT/MERGE。
4) 输出必须是 JSON 对象，不要输出额外文本，结构如下：
{
  "mode": "answer|generate|clarify",
  "status": "clarify|ready",
  "questions": ["..."],
  "answer": "...",
  "soql": "...",
  "objectName": "...",
  "fieldNames": ["..."],
  "reason": "..."
}
5) 若信息不足，返回 clarify 并给出最小问题列表。
__GENERATION_POLICY__
7) 回答默认使用中文；仅当用户明确要求其他语言时，才可切换对应语言作答。
"#
    .trim()
    .replace("__GENERATION_POLICY__", generation_policy)
}

/// 组装用户输入：附带 UI 上下文和历史摘要。
fn build_user_prompt(
    user_message: &str,
    payload: &AiChatTurnV2Request,
    history: &[LlmChatMessage],
    allow_soql_generation: bool,
) -> String {
    let history_text = history
        .iter()
        .rev()
        .take(16)
        .rev()
        .map(|item| {
            let role = match item.role {
                LlmChatRole::System => "system",
                LlmChatRole::User => "user",
                LlmChatRole::Assistant => "assistant",
            };
            format!("[{role}] {}", item.content)
        })
        .collect::<Vec<_>>()
        .join("\n");

    let context_object = payload
        .ui_context
        .as_ref()
        .and_then(|item| item.context_object_hint.clone())
        .unwrap_or_default();
    let current_soql = payload
        .ui_context
        .as_ref()
        .and_then(|item| item.current_tab_soql.clone())
        .unwrap_or_default();
    format!(
        "sourceId={}\nallowSoqlGeneration={}\ncontextObjectHint={}\ncurrentTabSoql={}\nhistory=\n{}\n\nuserMessage={}",
        payload.source_id,
        allow_soql_generation,
        context_object,
        current_soql,
        history_text,
        user_message
    )
}

/// 解析 rig 返回文本为结构化对象。
fn parse_rig_soql_output(raw: &str) -> RigSoqlOutput {
    let normalized = strip_markdown_json_fence(raw);
    serde_json::from_str::<RigSoqlOutput>(&normalized).unwrap_or(RigSoqlOutput {
        mode: Some("clarify".to_string()),
        status: Some("clarify".to_string()),
        questions: Some(vec![
            "请明确 Salesforce 对象 API Name（例如 Account、Contact）。".to_string(),
            "请补充需要查询的字段和过滤条件。".to_string(),
        ]),
        answer: Some("当前输出未能解析为合法 JSON，已降级为澄清模式。".to_string()),
        soql: None,
        reason: Some("模型输出格式不符合约定。".to_string()),
    })
}

/// 把内部输出映射为前端统一协议。
fn map_to_v2_response(
    conversation_id: &str,
    parsed: RigSoqlOutput,
    allow_soql_generation: bool,
) -> AiChatTurnV2Response {
    let mode = parsed
        .mode
        .unwrap_or_else(|| "clarify".to_string())
        .to_lowercase();
    let raw_soql = parsed.soql.unwrap_or_default();
    let has_non_empty_soql = !raw_soql.trim().is_empty();
    let status = parsed
        .status
        .unwrap_or_else(|| {
            if has_non_empty_soql {
                "ready".to_string()
            } else {
                "clarify".to_string()
            }
        })
        .to_lowercase();
    let questions = parsed.questions.unwrap_or_default();
    let mut proposed_soql = if has_non_empty_soql {
        Some(raw_soql)
    } else {
        None
    };
    let ignored_soql = !allow_soql_generation && proposed_soql.is_some();
    if !allow_soql_generation {
        // 安全兜底：即使模型误返回 SOQL，也在协议映射层强制清空。
        proposed_soql = None;
    }
    let assistant_message = parsed
        .answer
        .or(parsed.reason.clone())
        .unwrap_or_else(|| "已完成处理。".to_string());

    let state = if allow_soql_generation && status == "ready" && proposed_soql.is_some() {
        "ready".to_string()
    } else if mode == "clarify" {
        "clarify".to_string()
    } else {
        "answer".to_string()
    };

    let actions = if state == "ready" {
        vec![
            AiActionItem {
                action_type: "APPLY_CURRENT_TAB".to_string(),
                label: "应用当前Tab".to_string(),
            },
            AiActionItem {
                action_type: "APPLY_NEW_TAB".to_string(),
                label: "新建Tab并应用".to_string(),
            },
        ]
    } else if state == "clarify" {
        vec![AiActionItem {
            action_type: "ASK_MORE".to_string(),
            label: "继续补充信息".to_string(),
        }]
    } else {
        Vec::new()
    };

    let mut tools_used = vec![
        "find_salesforce_objects".to_string(),
        "get_salesforce_object_metadata".to_string(),
        "search_salesforce_object_fields".to_string(),
        "get_salesforce_field_metadata".to_string(),
        "get_salesforce_object_relationship_graph".to_string(),
    ];
    tools_used.sort();
    tools_used.dedup();

    let diagnostics = AiDiagnostics {
        tools_used,
        risk_level: if state == "clarify" {
            "medium".to_string()
        } else {
            "low".to_string()
        },
        warnings: if state == "ready" {
            Vec::new()
        } else if ignored_soql {
            vec!["当前问题未命中“生成 SOQL”意图，系统已忽略本轮 SOQL 输出。".to_string()]
        } else if state == "clarify" {
            vec!["当前信息仍不足以稳定生成 SOQL，请继续补充对象和过滤条件。".to_string()]
        } else {
            Vec::new()
        },
    };

    AiChatTurnV2Response {
        conversation_id: conversation_id.to_string(),
        state,
        assistant_message,
        questions,
        proposed_soql,
        actions,
        diagnostics,
    }
}

/// 会话持久化：保留多轮历史，支持后续连续追问。
fn persist_conversation_turn(
    state: &State<'_, AppState>,
    conversation_id: &str,
    user_message: &str,
    response: &AiChatTurnV2Response,
) -> Result<(), String> {
    let mut map = state
        .llm_conversations
        .lock()
        .map_err(|error| format!("LLM 会话锁失败: {error}"))?;
    let history = map.entry(conversation_id.to_string()).or_default();
    history.push(LlmChatMessage {
        role: LlmChatRole::User,
        content: user_message.to_string(),
    });
    history.push(LlmChatMessage {
        role: LlmChatRole::Assistant,
        content: serde_json::to_string(response).unwrap_or_else(|_| "{}".to_string()),
    });
    if history.len() > 60 {
        let keep_from = history.len().saturating_sub(60);
        let next = history[keep_from..].to_vec();
        *history = next;
    }
    Ok(())
}

/// 兼容 markdown JSON fence，便于解析模型输出。
fn strip_markdown_json_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }
    let without_prefix = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim();
    without_prefix.trim_end_matches("```").trim().to_string()
}
