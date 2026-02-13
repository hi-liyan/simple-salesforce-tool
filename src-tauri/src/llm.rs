use std::time::Duration;

use reqwest::{Client, StatusCode};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

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
    /// 工具调用列表。
    #[serde(default)]
    tool_calls: Vec<OpenAiToolCallBody>,
}

/// OpenAI 工具调用结构（原始响应体）。
#[derive(Debug, Deserialize)]
struct OpenAiToolCallBody {
    /// tool_call 唯一 ID，用于回填 tool 结果。
    id: String,
    /// tool call 类型，当前固定为 function。
    #[serde(default)]
    r#type: String,
    /// 函数调用体。
    function: OpenAiToolCallFunctionBody,
}

/// OpenAI 工具调用函数体（原始响应体）。
#[derive(Debug, Deserialize)]
struct OpenAiToolCallFunctionBody {
    /// 函数名称。
    name: String,
    /// 函数参数（JSON 字符串）。
    arguments: String,
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

/// 标准化后的工具调用信息。
#[derive(Debug, Clone)]
pub struct OpenAiToolCall {
    /// tool_call 唯一 ID，用于后续 tool 角色消息回填。
    pub id: String,
    /// 工具函数名。
    pub name: String,
    /// 工具参数（JSON 字符串）。
    pub arguments: String,
}

/// 含工具调用的聊天补全结果。
#[derive(Debug, Clone)]
pub struct OpenAiToolCompletion {
    /// assistant 原始消息（用于原样回填到下一轮 messages）。
    pub assistant_message: Value,
    /// assistant 文本内容（可能为空）。
    pub raw_content: String,
    /// assistant 文本解析后的 JSON（可选）。
    pub parsed_json: Option<Value>,
    /// assistant 文本 JSON 解析错误（可选）。
    pub parsed_json_error: Option<String>,
    /// assistant 发起的工具调用列表。
    pub tool_calls: Vec<OpenAiToolCall>,
}

/// 统一构建 LLM HTTP 客户端：关闭压缩解码，降低部分网关传输截断导致的解码失败概率。
fn build_llm_http_client(timeout_ms: u64) -> Result<Client, AppError> {
    Client::builder()
        .timeout(Duration::from_millis(timeout_ms.max(1000)))
        .http1_only()
        .no_gzip()
        .no_brotli()
        .no_deflate()
        .build()
        .map_err(|error| AppError::Http(format!("创建 LLM HTTP 客户端失败: {error}")))
}

/// 判断是否属于可重试的响应体解码错误。
fn is_retryable_decode_error(error_text: &str) -> bool {
    let normalized = error_text.to_lowercase();
    normalized.contains("error decoding response body")
        || normalized.contains("connection reset")
        || normalized.contains("incomplete message")
        || normalized.contains("unexpected eof")
}

/// 判断 reqwest 错误是否可重试（连接/超时/解码）。
fn is_retryable_reqwest_error(error: &reqwest::Error) -> bool {
    error.is_timeout() || error.is_connect() || error.is_decode()
}

/// 统一分类 reqwest 错误，返回更细粒度可操作提示。
fn classify_reqwest_error(stage: &str, error: reqwest::Error) -> AppError {
    if error.is_timeout() {
        return AppError::Http(format!(
            "{stage}超时：请求在设定时间内未完成，请检查网络或适当增大 LLM timeoutMs。"
        ));
    }
    if error.is_connect() {
        return AppError::Http(format!(
            "{stage}连接失败：无法连接到 LLM 网关，请检查 baseUrl、代理或网络连通性。"
        ));
    }
    if error.is_decode() {
        return AppError::Http(format!(
            "{stage}失败（响应解码）：网关响应体可能被截断或格式异常（{error}）。"
        ));
    }
    if let Some(status) = error.status() {
        return AppError::Http(format!("{stage}失败，状态码 {status}：{error}"));
    }
    AppError::Http(format!("{stage}失败：{error}"))
}

/// 调用 OpenAI Chat Completions（工具模式）：返回 assistant 消息、工具调用和可选 JSON 内容。
pub async fn openai_chat_completion_with_tools(
    base_url: &str,
    api_key: &str,
    model: &str,
    messages: &[Value],
    tools: &[Value],
    timeout_ms: u64,
) -> Result<OpenAiToolCompletion, AppError> {
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

    // 显式开启 tools + auto，让模型自行决定是否补充元数据。
    let request_body = json!({
        "model": model,
        "messages": messages,
        "temperature": 0.1,
        "response_format": { "type": "json_object" },
        "tools": tools,
        "tool_choice": "auto"
    });

    let endpoint = format!("{normalized_base}/chat/completions");
    let mut attempt = 0usize;
    let max_attempts = 2usize;
    let body: OpenAiChatResponse = loop {
        attempt += 1;
        // 每次重试都使用新连接，避免复用异常连接导致连续解码失败。
        let client = build_llm_http_client(timeout_ms)?;
        let response = match client
            .post(&endpoint)
            .bearer_auth(api_key)
            .header("Content-Type", "application/json")
            .header("Accept", "application/json")
            .header("Accept-Encoding", "identity")
            .header("Connection", "close")
            .json(&request_body)
            .send()
            .await
        {
            Ok(value) => value,
            Err(error) => {
                if attempt < max_attempts && is_retryable_reqwest_error(&error) {
                    continue;
                }
                return Err(classify_reqwest_error("调用 OpenAI", error));
            }
        };

        if !response.status().is_success() {
            return Err(build_openai_http_error(response, model).await);
        }

        match response.json::<OpenAiChatResponse>().await {
            Ok(parsed) => break parsed,
            Err(error) => {
                let classified = classify_reqwest_error("解析 OpenAI 响应", error);
                let error_text = classified.to_string();
                if attempt < max_attempts && is_retryable_decode_error(&error_text) {
                    // 对可重试解码错误立即重试，降低网关偶发传输抖动影响。
                    continue;
                }
                return Err(classified);
            }
        }
    };

    let first_choice = body
        .choices
        .first()
        .ok_or_else(|| AppError::Biz("OpenAI 未返回候选结果。".to_string()))?;
    let raw_content = first_choice.message.content.clone().unwrap_or_default();
    let normalized = strip_markdown_json_fence(&raw_content);
    let parsed_result = serde_json::from_str::<Value>(&normalized);
    let parsed_json = parsed_result.as_ref().ok().cloned();
    let parsed_json_error = parsed_result
        .err()
        .map(|error| format!("LLM 返回 JSON 解析失败: {error}"));
    let tool_calls = first_choice
        .message
        .tool_calls
        .iter()
        .filter(|item| item.r#type.trim().is_empty() || item.r#type == "function")
        .map(|item| OpenAiToolCall {
            id: item.id.clone(),
            name: item.function.name.clone(),
            arguments: item.function.arguments.clone(),
        })
        .collect::<Vec<_>>();

    // 保留 assistant 原始消息结构，确保下一轮继续 tool loop 时格式正确。
    let assistant_message = json!({
        "role": "assistant",
        "content": first_choice.message.content.clone().unwrap_or_default(),
        "tool_calls": first_choice.message.tool_calls.iter().map(|item| {
            json!({
                "id": item.id,
                "type": item.r#type,
                "function": {
                    "name": item.function.name,
                    "arguments": item.function.arguments
                }
            })
        }).collect::<Vec<_>>()
    });

    Ok(OpenAiToolCompletion {
        assistant_message,
        raw_content,
        parsed_json,
        parsed_json_error,
        tool_calls,
    })
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

/// 尝试从 OpenAI 错误响应中提取可读错误信息，失败时回退原文。
fn extract_openai_error_message(raw_text: &str) -> String {
    let trimmed = raw_text.trim();
    if trimmed.is_empty() {
        return "<empty>".to_string();
    }

    let parsed = serde_json::from_str::<OpenAiErrorEnvelope>(trimmed);
    if let Ok(body) = parsed {
        if let Some(message) = body
            .error
            .and_then(|item| item.message)
            .map(|item| item.trim().to_string())
        {
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
    let text = response
        .text()
        .await
        .unwrap_or_else(|_| "<empty>".to_string());
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
    if status == StatusCode::FORBIDDEN {
        return AppError::Biz(format!(
            "LLM 请求被拒绝（403）：{}。请检查网关访问策略或账号权限。",
            error_message
        ));
    }
    if status == StatusCode::TOO_MANY_REQUESTS {
        return AppError::Biz(format!(
            "LLM 请求过于频繁（429）：{}。请稍后重试或降低请求频率。",
            error_message
        ));
    }
    if status.is_server_error() {
        return AppError::Http(format!(
            "LLM 网关服务异常（{}）：{}。请稍后重试。",
            status, error_message
        ));
    }

    AppError::Http(format!("OpenAI 调用失败，状态码 {status}: {error_message}"))
}
