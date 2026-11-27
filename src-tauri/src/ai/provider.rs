use futures_util::StreamExt;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{LazyLock, RwLock};
use std::time::Duration;
use tokio::sync::Notify;

use crate::ai::events::{AgentChatMessage, ToolCall, ToolDefinition};
use crate::error::AppError;
use crate::storage::ai_repo::AiConfigRecord;

/// 全局在途流取消注册表：按 session_id 存储 Notify 信号，支持随时中断 HTTP 流。
static AI_STREAMS: LazyLock<RwLock<HashMap<String, std::sync::Arc<Notify>>>> =
    LazyLock::new(|| RwLock::new(HashMap::new()));

/// 注册流式会话取消句柄。
pub fn register_stream(session_id: &str) -> std::sync::Arc<Notify> {
    let notify = std::sync::Arc::new(Notify::new());
    if let Ok(mut guard) = AI_STREAMS.write() {
        guard.insert(session_id.to_string(), notify.clone());
    }
    notify
}

/// 触发指定会话的取消信号。
pub fn cancel_stream(session_id: &str) -> bool {
    if let Ok(guard) = AI_STREAMS.read() {
        if let Some(notify) = guard.get(session_id) {
            notify.notify_waiters();
            return true;
        }
    }
    false
}

/// 注销流式会话取消句柄。
pub fn unregister_stream(session_id: &str) {
    if let Ok(mut guard) = AI_STREAMS.write() {
        guard.remove(session_id);
    }
}

/// 单轮模型流式响应汇总。
#[derive(Debug, Clone)]
pub struct ModelTurnOutput {
    /// 本轮输出正文。
    pub text: String,
    /// 本轮模型发起的工具调用列表。
    pub tool_calls: Vec<ToolCall>,
    /// 本轮输入 Token（若接口返回）。
    pub input_tokens: u64,
    /// 本轮输出 Token（若接口返回）。
    pub output_tokens: u64,
}

/// 连接测试结果。
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AiConnectionTestResult {
    /// 是否连通成功。
    pub ok: bool,
    /// 响应耗时（毫秒）。
    pub latency_ms: u64,
    /// 提示消息。
    pub message: String,
}

/// 规范化基础地址，去掉尾部斜杠。
fn normalize_base_url(raw: &str) -> String {
    raw.trim().trim_end_matches('/').to_string()
}

/// 解析 `data:<mime>;base64,<data>` 格式的图片 Data URL，返回 `(media_type, base64_data)`。
fn parse_image_data_url(data_url: &str) -> Option<(String, String)> {
    let trimmed = data_url.trim();
    let rest = trimmed.strip_prefix("data:")?;
    let (meta, payload) = rest.split_once(',')?;
    // 仅处理显式声明为 base64 的图片 Data URL。
    if !meta.to_ascii_lowercase().contains(";base64") || payload.trim().is_empty() {
        return None;
    }
    let media_type = meta
        .split(';')
        .next()
        .map(str::trim)
        .filter(|m| !m.is_empty())
        .unwrap_or("image/png");
    Some((media_type.to_string(), payload.trim().to_string()))
}

/// 构建共享 HTTP 客户端。
fn build_http_client(timeout_ms: i64) -> Result<Client, AppError> {
    let ms = timeout_ms.clamp(3_000, 300_000) as u64;
    Client::builder()
        .timeout(Duration::from_millis(ms))
        .build()
        .map_err(|e| AppError::Biz(format!("初始化 HTTP 客户端失败: {e}")))
}

/// 测试 AI 配置连通性（发送最小请求验证 Base URL / API Key / Model）。
pub async fn test_ai_connection(
    config: &AiConfigRecord,
    api_key: &str,
) -> Result<AiConnectionTestResult, AppError> {
    let started = std::time::Instant::now();
    let client = build_http_client(config.timeout_ms.min(20_000))?;
    let base = normalize_base_url(&config.base_url);

    if config.api_style.eq_ignore_ascii_case("anthropic_messages") {
        let url = if base.ends_with("/v1") {
            format!("{base}/messages")
        } else {
            format!("{base}/v1/messages")
        };
        let resp = client
            .post(&url)
            .header("x-api-key", api_key)
            .header("anthropic-version", "2023-06-01")
            .json(&json!({
                "model": config.model,
                "max_tokens": 8,
                "messages": [{ "role": "user", "content": "ping" }]
            }))
            .send()
            .await
            .map_err(|e| AppError::Biz(format!("连接 Anthropic 接口失败: {e}")))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Biz(format!("接口返回 {status}: {body}")));
        }
    } else {
        let url = format!("{base}/chat/completions");
        let mut req = client.post(&url).json(&json!({
            "model": config.model,
            "max_tokens": 8,
            "messages": [{ "role": "user", "content": "ping" }]
        }));
        if !api_key.trim().is_empty() {
            req = req.bearer_auth(api_key.trim());
        }
        let resp = req
            .send()
            .await
            .map_err(|e| AppError::Biz(format!("连接模型接口失败: {e}")))?;
        let status = resp.status();
        let body = resp.text().await.unwrap_or_default();
        if !status.is_success() {
            return Err(AppError::Biz(format!("接口返回 {status}: {body}")));
        }
    }

    Ok(AiConnectionTestResult {
        ok: true,
        latency_ms: started.elapsed().as_millis() as u64,
        message: format!("连接成功（模型 {} 可用）", config.model),
    })
}

/// 拉取远端可用模型列表（OpenAI 兼容接口调用 `/models`，Anthropic 返回内置常用清单）。
pub async fn list_remote_models(
    config: &AiConfigRecord,
    api_key: &str,
) -> Result<Vec<String>, AppError> {
    if config.api_style.eq_ignore_ascii_case("anthropic_messages") {
        return Ok(vec![
            "claude-sonnet-4-20250514".to_string(),
            "claude-3-7-sonnet-latest".to_string(),
            "claude-3-5-haiku-latest".to_string(),
        ]);
    }

    let client = build_http_client(15_000)?;
    let base = normalize_base_url(&config.base_url);
    let url = format!("{base}/models");
    let mut req = client.get(&url);
    if !api_key.trim().is_empty() {
        req = req.bearer_auth(api_key.trim());
    }
    let resp = req
        .send()
        .await
        .map_err(|e| AppError::Biz(format!("获取模型列表失败: {e}")))?;
    let status = resp.status();
    if !status.is_success() {
        let body = resp.text().await.unwrap_or_default();
        return Err(AppError::Biz(format!("获取模型列表失败 ({status}): {body}")));
    }

    let payload: Value = resp
        .json()
        .await
        .map_err(|e| AppError::Biz(format!("解析模型列表 JSON 失败: {e}")))?;
    let mut models: Vec<String> = payload
        .get("data")
        .and_then(|d| d.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.get("id").and_then(|v| v.as_str()).map(ToOwned::to_owned))
                .collect()
        })
        .unwrap_or_default();
    models.sort();
    models.dedup();
    Ok(models)
}

/// 执行单轮流式模型调用（支持 OpenAI Chat Completions SSE 与 Anthropic Messages SSE），并实时回调正文与思考增量。
pub async fn stream_model_turn<FText, FReason>(
    config: &AiConfigRecord,
    api_key: &str,
    system_prompt: &str,
    messages: &[AgentChatMessage],
    tools: &[ToolDefinition],
    cancel_notify: &std::sync::Arc<Notify>,
    on_text_delta: FText,
    on_reasoning_delta: FReason,
) -> Result<ModelTurnOutput, AppError>
where
    FText: FnMut(String) + Send,
    FReason: FnMut(String) + Send,
{
    if config.api_style.eq_ignore_ascii_case("anthropic_messages") {
        stream_anthropic_turn(
            config,
            api_key,
            system_prompt,
            messages,
            tools,
            cancel_notify,
            on_text_delta,
            on_reasoning_delta,
        )
        .await
    } else {
        stream_openai_completions_turn(
            config,
            api_key,
            system_prompt,
            messages,
            tools,
            cancel_notify,
            on_text_delta,
            on_reasoning_delta,
        )
        .await
    }
}

/// OpenAI Chat Completions 兼容流式请求（兼容 OpenAI / DeepSeek / Qwen / Ollama / OpenRouter 等）。
async fn stream_openai_completions_turn<FText, FReason>(
    config: &AiConfigRecord,
    api_key: &str,
    system_prompt: &str,
    messages: &[AgentChatMessage],
    tools: &[ToolDefinition],
    cancel_notify: &std::sync::Arc<Notify>,
    mut on_text_delta: FText,
    mut on_reasoning_delta: FReason,
) -> Result<ModelTurnOutput, AppError>
where
    FText: FnMut(String) + Send,
    FReason: FnMut(String) + Send,
{
    let client = build_http_client(config.timeout_ms)?;
    let url = format!("{}/chat/completions", normalize_base_url(&config.base_url));

    let mut wire_messages = Vec::with_capacity(messages.len() + 1);
    wire_messages.push(json!({ "role": "system", "content": system_prompt }));
    for msg in messages {
        if msg.role == "assistant" && !msg.tool_calls.is_empty() {
            let calls: Vec<Value> = msg
                .tool_calls
                .iter()
                .map(|tc| {
                    json!({
                        "id": tc.id,
                        "type": "function",
                        "function": {
                            "name": tc.name,
                            "arguments": serde_json::to_string(&tc.arguments).unwrap_or_else(|_| "{}".to_string())
                        }
                    })
                })
                .collect();
            wire_messages.push(json!({
                "role": "assistant",
                "content": if msg.content.is_empty() { Value::Null } else { Value::String(msg.content.clone()) },
                "tool_calls": calls
            }));
        } else if msg.role == "tool" {
            wire_messages.push(json!({
                "role": "tool",
                "tool_call_id": msg.tool_call_id.clone().unwrap_or_default(),
                "content": msg.content
            }));
        } else if msg.role == "user" && !msg.images.is_empty() {
            // 构造 OpenAI Vision 多模态 content 数组（文本 + image_url）。
            let mut parts = vec![json!({
                "type": "text",
                "text": msg.content
            })];
            for img in &msg.images {
                if !img.data_url.trim().is_empty() {
                    parts.push(json!({
                        "type": "image_url",
                        "image_url": { "url": img.data_url }
                    }));
                }
            }
            wire_messages.push(json!({
                "role": msg.role,
                "content": parts
            }));
        } else {
            wire_messages.push(json!({
                "role": msg.role,
                "content": msg.content
            }));
        }
    }

    let mut body = json!({
        "model": config.model,
        "messages": wire_messages,
        "stream": true,
        "temperature": 0.15
    });
    if !tools.is_empty() {
        let tool_defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "type": "function",
                    "function": {
                        "name": t.name,
                        "description": t.description,
                        "parameters": t.parameters
                    }
                })
            })
            .collect();
        body["tools"] = Value::Array(tool_defs);
        body["tool_choice"] = Value::String("auto".to_string());
    }

    let mut req = client
        .post(&url)
        .header("Accept", "text/event-stream")
        .header("Cache-Control", "no-cache")
        .json(&body);
    if !api_key.trim().is_empty() {
        req = req.bearer_auth(api_key.trim());
    }

    let resp = tokio::select! {
        _ = cancel_notify.notified() => {
            return Err(AppError::Biz("已停止生成".to_string()));
        }
        res = req.send() => {
            res.map_err(|e| AppError::Biz(format!("请求模型接口失败: {e}")))?
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(AppError::Biz(format!("模型接口返回 {status}: {err_body}")));
    }

    let mut stream = resp.bytes_stream();
    let mut sse_buffer: Vec<u8> = Vec::new();
    let mut full_text = String::new();
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    // 按 tool_call index 累积流式分片（id / name / arguments）。
    let mut pending_calls: HashMap<usize, (String, String, String)> = HashMap::new();

    loop {
        let next_chunk = tokio::select! {
            _ = cancel_notify.notified() => {
                return Err(AppError::Biz("已停止生成".to_string()));
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk_res) = next_chunk else {
            break;
        };
        let bytes = chunk_res.map_err(|e| AppError::Biz(format!("读取流式响应失败: {e}")))?;
        sse_buffer.extend_from_slice(&bytes);

        while let Some(newline_pos) = sse_buffer.iter().position(|&b| b == b'\n') {
            let line_bytes: Vec<u8> = sse_buffer.drain(..=newline_pos).collect();
            let line = String::from_utf8_lossy(&line_bytes).trim().to_string();

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line.trim_start_matches("data:").trim();
            if data == "[DONE]" {
                continue;
            }
            let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                continue;
            };

            if let Some(usage) = parsed.get("usage") {
                input_tokens = usage.get("prompt_tokens").and_then(|v| v.as_u64()).unwrap_or(input_tokens);
                output_tokens = usage.get("completion_tokens").and_then(|v| v.as_u64()).unwrap_or(output_tokens);
            }

            let Some(choice) = parsed.get("choices").and_then(|c| c.as_array()).and_then(|a| a.first()) else {
                continue;
            };
            let Some(delta) = choice.get("delta") else {
                continue;
            };

            if let Some(reasoning) = delta
                .get("reasoning_content")
                .or_else(|| delta.get("reasoning"))
                .and_then(|v| v.as_str())
            {
                if !reasoning.is_empty() {
                    on_reasoning_delta(reasoning.to_string());
                }
            }

            if let Some(content) = delta.get("content").and_then(|v| v.as_str()) {
                if !content.is_empty() {
                    full_text.push_str(content);
                    on_text_delta(content.to_string());
                }
            }

            if let Some(tc_arr) = delta.get("tool_calls").and_then(|v| v.as_array()) {
                for tc in tc_arr {
                    let idx = tc.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    let entry = pending_calls.entry(idx).or_insert_with(|| {
                        (format!("call-{idx}"), String::new(), String::new())
                    });
                    if let Some(id) = tc.get("id").and_then(|v| v.as_str()) {
                        if !id.is_empty() {
                            entry.0 = id.to_string();
                        }
                    }
                    if let Some(func) = tc.get("function") {
                        if let Some(name) = func.get("name").and_then(|v| v.as_str()) {
                            entry.1.push_str(name);
                        }
                        if let Some(args) = func.get("arguments").and_then(|v| v.as_str()) {
                            entry.2.push_str(args);
                        }
                    }
                }
            }
        }
    }

    let mut ordered_indices: Vec<usize> = pending_calls.keys().copied().collect();
    ordered_indices.sort_unstable();
    let tool_calls = ordered_indices
        .into_iter()
        .filter_map(|idx| pending_calls.remove(&idx))
        .filter(|(_, name, _)| !name.trim().is_empty())
        .map(|(id, name, args_raw)| {
            let arguments = serde_json::from_str::<Value>(&args_raw).unwrap_or_else(|_| json!({}));
            ToolCall {
                id,
                name,
                arguments,
            }
        })
        .collect();

    Ok(ModelTurnOutput {
        text: full_text,
        tool_calls,
        input_tokens,
        output_tokens,
    })
}

/// Anthropic Messages API 流式请求（兼容 Claude 官方与 Anthropic 代理网关）。
async fn stream_anthropic_turn<FText, FReason>(
    config: &AiConfigRecord,
    api_key: &str,
    system_prompt: &str,
    messages: &[AgentChatMessage],
    tools: &[ToolDefinition],
    cancel_notify: &std::sync::Arc<Notify>,
    mut on_text_delta: FText,
    mut on_reasoning_delta: FReason,
) -> Result<ModelTurnOutput, AppError>
where
    FText: FnMut(String) + Send,
    FReason: FnMut(String) + Send,
{
    let client = build_http_client(config.timeout_ms)?;
    let base = normalize_base_url(&config.base_url);
    let url = if base.ends_with("/v1") {
        format!("{base}/messages")
    } else {
        format!("{base}/v1/messages")
    };

    let mut wire_messages = Vec::with_capacity(messages.len());
    for msg in messages {
        if msg.role == "assistant" && !msg.tool_calls.is_empty() {
            let mut blocks = Vec::new();
            if !msg.content.is_empty() {
                blocks.push(json!({ "type": "text", "text": msg.content }));
            }
            for tc in &msg.tool_calls {
                blocks.push(json!({
                    "type": "tool_use",
                    "id": tc.id,
                    "name": tc.name,
                    "input": tc.arguments
                }));
            }
            wire_messages.push(json!({ "role": "assistant", "content": blocks }));
        } else if msg.role == "tool" {
            wire_messages.push(json!({
                "role": "user",
                "content": [{
                    "type": "tool_result",
                    "tool_use_id": msg.tool_call_id.clone().unwrap_or_default(),
                    "content": msg.content
                }]
            }));
        } else if msg.role == "user" && !msg.images.is_empty() {
            // 构造 Anthropic Messages 多模态 content 块（image base64 + text）。
            let mut blocks = Vec::new();
            for img in &msg.images {
                if let Some((media_type, data)) = parse_image_data_url(&img.data_url) {
                    blocks.push(json!({
                        "type": "image",
                        "source": {
                            "type": "base64",
                            "media_type": media_type,
                            "data": data
                        }
                    }));
                }
            }
            blocks.push(json!({
                "type": "text",
                "text": msg.content
            }));
            wire_messages.push(json!({ "role": msg.role, "content": blocks }));
        } else {
            wire_messages.push(json!({ "role": msg.role, "content": msg.content }));
        }
    }

    let mut body = json!({
        "model": config.model,
        "system": system_prompt,
        "messages": wire_messages,
        "max_tokens": 4096,
        "stream": true
    });
    if !tools.is_empty() {
        let tool_defs: Vec<Value> = tools
            .iter()
            .map(|t| {
                json!({
                    "name": t.name,
                    "description": t.description,
                    "input_schema": t.parameters
                })
            })
            .collect();
        body["tools"] = Value::Array(tool_defs);
    }

    let resp = tokio::select! {
        _ = cancel_notify.notified() => {
            return Err(AppError::Biz("已停止生成".to_string()));
        }
        res = client
            .post(&url)
            .header("x-api-key", api_key.trim())
            .header("anthropic-version", "2023-06-01")
            .json(&body)
            .send() => {
            res.map_err(|e| AppError::Biz(format!("请求 Anthropic 接口失败: {e}")))?
        }
    };

    let status = resp.status();
    if !status.is_success() {
        let err_body = resp.text().await.unwrap_or_default();
        return Err(AppError::Biz(format!("Anthropic 接口返回 {status}: {err_body}")));
    }

    let mut stream = resp.bytes_stream();
    let mut sse_buffer = String::new();
    let mut full_text = String::new();
    let mut input_tokens = 0u64;
    let mut output_tokens = 0u64;
    let mut pending_calls: HashMap<usize, (String, String, String)> = HashMap::new();

    loop {
        let next_chunk = tokio::select! {
            _ = cancel_notify.notified() => {
                return Err(AppError::Biz("已停止生成".to_string()));
            }
            chunk = stream.next() => chunk,
        };

        let Some(chunk_res) = next_chunk else {
            break;
        };
        let bytes = chunk_res.map_err(|e| AppError::Biz(format!("读取 Anthropic 流失败: {e}")))?;
        sse_buffer.push_str(&String::from_utf8_lossy(&bytes));

        while let Some(newline_pos) = sse_buffer.find('\n') {
            let line = sse_buffer[..newline_pos].trim().to_string();
            sse_buffer.drain(..=newline_pos);

            if line.is_empty() || !line.starts_with("data:") {
                continue;
            }
            let data = line.trim_start_matches("data:").trim();
            let Ok(parsed) = serde_json::from_str::<Value>(data) else {
                continue;
            };
            let event_type = parsed.get("type").and_then(|v| v.as_str()).unwrap_or_default();
            match event_type {
                "message_start" => {
                    if let Some(usage) = parsed.get("message").and_then(|m| m.get("usage")) {
                        input_tokens = usage.get("input_tokens").and_then(|v| v.as_u64()).unwrap_or(input_tokens);
                    }
                }
                "message_delta" => {
                    if let Some(usage) = parsed.get("usage") {
                        output_tokens = usage.get("output_tokens").and_then(|v| v.as_u64()).unwrap_or(output_tokens);
                    }
                }
                "content_block_start" => {
                    let idx = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    if let Some(block) = parsed.get("content_block") {
                        if block.get("type").and_then(|v| v.as_str()) == Some("tool_use") {
                            let id = block.get("id").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            let name = block.get("name").and_then(|v| v.as_str()).unwrap_or("").to_string();
                            pending_calls.insert(idx, (id, name, String::new()));
                        }
                    }
                }
                "content_block_delta" => {
                    let idx = parsed.get("index").and_then(|v| v.as_u64()).unwrap_or(0) as usize;
                    if let Some(delta) = parsed.get("delta") {
                        let delta_type = delta.get("type").and_then(|v| v.as_str()).unwrap_or_default();
                        if delta_type == "text_delta" {
                            if let Some(text) = delta.get("text").and_then(|v| v.as_str()) {
                                full_text.push_str(text);
                                on_text_delta(text.to_string());
                            }
                        } else if delta_type == "thinking_delta" {
                            if let Some(thinking) = delta.get("thinking").and_then(|v| v.as_str()) {
                                on_reasoning_delta(thinking.to_string());
                            }
                        } else if delta_type == "input_json_delta" {
                            if let Some(partial) = delta.get("partial_json").and_then(|v| v.as_str()) {
                                if let Some(entry) = pending_calls.get_mut(&idx) {
                                    entry.2.push_str(partial);
                                }
                            }
                        }
                    }
                }
                _ => {}
            }
        }
    }

    let mut ordered_indices: Vec<usize> = pending_calls.keys().copied().collect();
    ordered_indices.sort_unstable();
    let tool_calls = ordered_indices
        .into_iter()
        .filter_map(|idx| pending_calls.remove(&idx))
        .filter(|(_, name, _)| !name.trim().is_empty())
        .map(|(id, name, args_raw)| {
            let arguments = serde_json::from_str::<Value>(&args_raw).unwrap_or_else(|_| json!({}));
            ToolCall {
                id,
                name,
                arguments,
            }
        })
        .collect();

    Ok(ModelTurnOutput {
        text: full_text,
        tool_calls,
        input_tokens,
        output_tokens,
    })
}
