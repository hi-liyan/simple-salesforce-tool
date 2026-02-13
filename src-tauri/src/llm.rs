use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use futures_util::StreamExt;

use crate::error::AppError;

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

/// OpenAI Chat Completions 返回体（仅保留本项目需要字段）。
#[derive(Debug, Deserialize)]
struct OpenAiChatResponse {
    /// 候选输出列表。
    choices: Vec<OpenAiChoice>,
}

/// OpenAI 单条候选输出。
#[derive(Debug, Deserialize)]
struct OpenAiChoice {
    /// 消息体。
    message: OpenAiMessage,
}

/// OpenAI 消息体。
#[derive(Debug, Deserialize)]
struct OpenAiMessage {
    /// 文本内容。
    content: Option<String>,
}

/// OpenAI 错误包结构（用于提取 error.message）。
#[derive(Debug, Deserialize)]
struct OpenAiErrorEnvelope {
    /// 统一错误对象。
    error: Option<OpenAiErrorBody>,
}

/// OpenAI 错误对象。
#[derive(Debug, Deserialize)]
struct OpenAiErrorBody {
    /// 错误消息正文。
    message: Option<String>,
}

/// 调用 OpenAI Chat Completions，并要求返回 JSON 结构。
pub async fn openai_chat_json(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmChatMessage],
    timeout_ms: u64,
) -> Result<Value, AppError> {
    let normalized_base = base_url.trim_end_matches('/');
    if normalized_base.is_empty() {
        return Err(AppError::Biz("LLM baseUrl 不能为空。".to_string()));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::Biz("LLM apiKey 未配置。".to_string()));
    }
    if model.trim().is_empty() {
        return Err(AppError::Biz("LLM model 不能为空。".to_string()));
    }

    // 构建独立 HTTP 客户端并附加超时，避免模型调用阻塞主流程。
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms.max(1000)))
        .build()
        .map_err(|error| AppError::Http(format!("创建 LLM HTTP 客户端失败: {error}")))?;

    let payload_messages: Vec<Value> = messages
        .iter()
        .map(|item| {
            let role = match item.role {
                LlmChatRole::System => "system",
                LlmChatRole::User => "user",
                LlmChatRole::Assistant => "assistant",
            };
            json!({ "role": role, "content": item.content })
        })
        .collect();

    let request_body = json!({
        "model": model,
        "messages": payload_messages,
        "temperature": 0.1,
        "response_format": { "type": "json_object" }
    });

    let endpoint = format!("{normalized_base}/chat/completions");
    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| AppError::Http(format!("调用 OpenAI 失败: {error}")))?;

    if !response.status().is_success() {
        return Err(build_openai_http_error(response, model).await);
    }

    let body: OpenAiChatResponse = response
        .json()
        .await
        .map_err(|error| AppError::Http(format!("解析 OpenAI 响应失败: {error}")))?;

    let content = body
        .choices
        .first()
        .and_then(|item| item.message.content.clone())
        .unwrap_or_default();

    // 某些模型会返回 markdown code fence，这里做一层清洗再解析 JSON。
    let normalized = strip_markdown_json_fence(&content);
    let parsed: Value = serde_json::from_str(&normalized)
        .map_err(|error| AppError::Biz(format!("LLM 返回 JSON 解析失败: {error}")))?;

    Ok(parsed)
}

/// 调用 OpenAI Chat Completions（流式），并在每个增量文本片段到达时回调。
pub async fn openai_chat_json_stream<F, C>(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[LlmChatMessage],
    timeout_ms: u64,
    mut on_chunk: F,
    should_cancel: C,
) -> Result<Value, AppError>
where
    F: FnMut(&str) -> Result<(), AppError>,
    C: Fn() -> bool,
{
    let normalized_base = base_url.trim_end_matches('/');
    if normalized_base.is_empty() {
        return Err(AppError::Biz("LLM baseUrl 不能为空。".to_string()));
    }
    if api_key.trim().is_empty() {
        return Err(AppError::Biz("LLM apiKey 未配置。".to_string()));
    }
    if model.trim().is_empty() {
        return Err(AppError::Biz("LLM model 不能为空。".to_string()));
    }

    // 构建独立 HTTP 客户端并附加超时，避免模型调用阻塞主流程。
    let client = Client::builder()
        .timeout(Duration::from_millis(timeout_ms.max(60_000)))
        .build()
        .map_err(|error| AppError::Http(format!("创建 LLM HTTP 客户端失败: {error}")))?;

    let payload_messages: Vec<Value> = messages
        .iter()
        .map(|item| {
            let role = match item.role {
                LlmChatRole::System => "system",
                LlmChatRole::User => "user",
                LlmChatRole::Assistant => "assistant",
            };
            json!({ "role": role, "content": item.content })
        })
        .collect();

    let request_body = json!({
        "model": model,
        "messages": payload_messages,
        "temperature": 0.1,
        "stream": true
    });

    let endpoint = format!("{normalized_base}/chat/completions");
    let response = client
        .post(&endpoint)
        .bearer_auth(api_key)
        .header("Content-Type", "application/json")
        .json(&request_body)
        .send()
        .await
        .map_err(|error| AppError::Http(format!("调用 OpenAI 失败: {error}")))?;

    if !response.status().is_success() {
        return Err(build_openai_http_error(response, model).await);
    }

    let mut buffer = String::new();
    let mut aggregated = String::new();
    let mut stream = response.bytes_stream();
    while let Some(chunk_result) = stream.next().await {
        if should_cancel() {
            return Err(AppError::Biz("用户已停止生成。".to_string()));
        }
        let chunk = chunk_result.map_err(|error| AppError::Http(format!("读取 OpenAI 流式响应失败: {error}")))?;
        let text = String::from_utf8_lossy(&chunk).to_string();
        buffer.push_str(&text);

        while let Some(line_end) = buffer.find('\n') {
            let line = buffer[..line_end].trim().to_string();
            buffer = buffer[line_end + 1..].to_string();
            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let payload = line.trim_start_matches("data:").trim();
            if payload == "[DONE]" {
                break;
            }
            if let Some(delta) = extract_stream_delta_content(payload) {
                if !delta.is_empty() {
                    aggregated.push_str(&delta);
                    on_chunk(&delta)?; // 每个片段推送给上层（前端做流式展示）。
                }
            }
        }
    }

    // 兼容“最后一个 data 行不带换行”的网关实现，避免丢失尾包导致 JSON 不完整。
    let trailing = buffer.trim();
    if trailing.starts_with("data:") {
        let payload = trailing.trim_start_matches("data:").trim();
        if payload != "[DONE]" {
            if let Some(delta) = extract_stream_delta_content(payload) {
                if !delta.is_empty() {
                    aggregated.push_str(&delta);
                    on_chunk(&delta)?;
                }
            }
        }
    }

    let normalized = strip_markdown_json_fence(&aggregated);
    let parsed: Value = serde_json::from_str(&normalized)
        .map_err(|error| AppError::Biz(format!("LLM 返回 JSON 解析失败: {error}")))?;
    Ok(parsed)
}

/// 去掉可能包裹在 ```json ... ``` 的 markdown 外壳。
fn strip_markdown_json_fence(text: &str) -> String {
    let trimmed = text.trim();
    if !trimmed.starts_with("```") {
        return trimmed.to_string();
    }

    let without_prefix = trimmed
        .trim_start_matches("```json")
        .trim_start_matches("```")
        .trim();
    let without_suffix = without_prefix.trim_end_matches("```").trim();
    without_suffix.to_string()
}

/// 从流式 chunk JSON 中提取 delta.content 文本。
fn extract_stream_delta_content(raw: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(raw).ok()?;
    value
        .get("choices")
        .and_then(|item| item.as_array())
        .and_then(|items| items.first())
        .and_then(|item| item.get("delta"))
        .and_then(|item| item.get("content"))
        .and_then(|item| item.as_str())
        .map(|item| item.to_string())
}

/// 尝试从 OpenAI 错误响应中提取可读错误信息，失败时回退原文。
fn extract_openai_error_message(raw_text: &str) -> String {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return "<empty>".to_string();
    }

    let parsed = serde_json::from_str::<OpenAiErrorEnvelope>(trimmed);
    if let Ok(body) = parsed {
        if let Some(message) = body.error.and_then(|item| item.message).map(|item| item.trim().to_string()) {
            if !message.is_empty() {
                return message;
            }
        }
    }

    trimmed.to_string()
}

/// 统一构造 OpenAI 非 2xx 错误，输出可操作提示。
async fn build_openai_http_error(response: reqwest::Response, model: &str) -> AppError {
    let status = response.status();
    let text = response.text().await.unwrap_or_else(|_| "<empty>".to_string());
    let error_message = extract_openai_error_message(&text);
    let normalized = error_message.to_lowercase();

    // 模型不受当前网关支持：返回可操作的业务错误，提示用户修改 model 配置。
    if normalized.contains("unknown provider for model")
        || normalized.contains("unknown model")
        || normalized.contains("model_not_found")
    {
        return AppError::Biz(format!(
            "当前模型 `{}` 在该 OpenAI 网关不可用：{}。请到“设置 -> LLM设置”将 model 改为网关支持的模型后重试。",
            model, error_message
        ));
    }

    // 认证失败：明确提示 API Key 问题，避免误判为网络故障。
    if status == StatusCode::UNAUTHORIZED {
        return AppError::Biz(format!(
            "LLM 认证失败（401）：{}。请检查 API Key 是否正确。",
            error_message
        ));
    }

    AppError::Http(format!(
        "OpenAI 调用失败，状态码 {status}: {error_message}"
    ))
}
