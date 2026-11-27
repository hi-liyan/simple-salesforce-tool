use futures_util::future::join_all;
use tauri::{AppHandle, Emitter};

use crate::ai::events::{
    AgentChatMessage, AgentEvent, AiAgentEventPayload, AiAgentStreamRequest, AiAssistantMode,
    ToolCall, ToolDefinition, ToolResult,
};
use crate::ai::provider::{
    register_stream, stream_model_turn, unregister_stream,
};
use crate::ai::tools::{
    build_tools_for_mode, check_tool_write_gate, execute_agent_tool, AgentToolContext,
    WriteGateCheck,
};
use crate::app_state::AppState;
use crate::error::AppError;
use crate::services::source_service::SourceService;
use crate::storage::ai_repo::{get_ai_config_with_secret, AiConfigRecord};

/// 默认最大 Agent 循环轮数。
const DEFAULT_MAX_TURNS: usize = 20;
/// 上下文自动压缩字符预算（约等价 24k tokens）。
const CONTEXT_COMPACT_CHAR_BUDGET: usize = 90_000;

/// 发射一条 Agent 事件到前端 `ai-agent-event` 通道。
fn emit_agent_event(app: &AppHandle, session_id: &str, event: AgentEvent) {
    let _ = app.emit(
        "ai-agent-event",
        AiAgentEventPayload {
            session_id: session_id.to_string(),
            event,
        },
    );
}

/// 根据数据源驱动能力、运行模式与快捷技能构造系统提示词（零数据源硬编码）。
fn build_agent_system_prompt(
    source_name: &str,
    query_language: &str,
    environment: &str,
    read_only: bool,
    mode: AiAssistantMode,
    action: Option<&str>,
    custom_instructions: &str,
) -> String {
    let lang_upper = query_language.to_uppercase();
    let mode_desc = match mode {
        AiAssistantMode::Ask => {
            "当前处于 Ask（只读问答）模式：你可以调用元数据工具核实表/对象与字段结构，但禁止自行执行写操作，请输出清晰准确的中文解答与可直接使用的语句代码块。"
        }
        AiAssistantMode::Agent => {
            "当前处于 Agent（自主探索与执行）模式：你可以通过工具主动检索对象列表、查看字段/DDL、采样数据、执行查询与 EXPLAIN 分析，用真实结果回答用户；若涉及写操作或高危 DDL，调用 execute_query 后系统会自动向用户发起确认。"
        }
    };

    let skill_hint = match action.unwrap_or("general") {
        "generate" => "用户目标：根据需求与真实 Schema 生成精确可执行的查询或变更语句。",
        "explain" => "用户目标：结合上下文或表结构，逐段解释语句的语义、关联关系与预期结果。",
        "optimize" => "用户目标：分析索引命中、扫描范围与写法瓶颈，必要时在 Agent 模式下执行 EXPLAIN，给出可落地的优化方案。",
        "fix" => "用户目标：定位报错原因（语法、字段不存在、类型或权限问题），并给出修复后的完整语句。",
        "explore" => "用户目标：主动探索数据源结构、核心表关系与样本数据分布，输出结构化总结。",
        _ => "用户目标：高效解决用户的数据库查询、分析与开发问题。",
    };

    let env_guard = if read_only {
        "注意：当前数据源被标记为【只读】，严禁生成或尝试执行任何修改数据的语句。"
    } else if environment.eq_ignore_ascii_case("prod") {
        "注意：当前数据源为【生产环境】，请格外谨慎，优先使用只读查询验证条件。"
    } else {
        "当前数据源允许常规查询与受安全网关保护的变更操作。"
    };

    let mut prompt = format!(
        "你是 DataStudio 内置的专业数据库与数据工作台 AI 助手。\n\
         当前绑定数据源：{source_name}（查询语言：{lang_upper}，环境：{environment}）。\n\
         {env_guard}\n\
         {mode_desc}\n\
         {skill_hint}\n\n\
         工作规范：\n\
         1. 严禁编造不存在的表名、对象名或字段名；不确定时先调用 list_objects / describe_object 核实。\n\
         2. 最终输出请使用简洁中文，所有 SQL/SOQL 代码请放在 ```{query_language} 代码块中，便于用户一键替换或执行。\n\
         3. 如果存在多个合理理解且缺少关键条件，先给出最合理方案并简明指出可补充条件。"
    );

    if !custom_instructions.trim().is_empty() {
        prompt.push_str("\n\n用户全局自定义规范：\n");
        prompt.push_str(custom_instructions.trim());
    }
    prompt
}

/// 组装本轮用户输入上下文（工作区状态、选区、编辑器草稿、`@` 引用对象、图片提示与报错信息）。
fn build_user_prompt_with_context(req: &AiAgentStreamRequest) -> String {
    let mut sections = Vec::new();

    if !req.workspace_context_summary.trim().is_empty() {
        sections.push(format!(
            "[当前工作区状态]:\n{}",
            req.workspace_context_summary.trim()
        ));
    }
    if !req.mentioned_objects.is_empty() {
        sections.push(format!(
            "[用户引用的对象/表]: {}",
            req.mentioned_objects.join(", ")
        ));
    }
    if !req.selected_editor_sql.trim().is_empty() {
        sections.push(format!(
            "[编辑器当前选中片段]:\n```sql\n{}\n```",
            req.selected_editor_sql.trim()
        ));
    } else if !req.current_editor_sql.trim().is_empty() {
        let clipped: String = req.current_editor_sql.trim().chars().take(4000).collect();
        sections.push(format!("[当前编辑器内容]:\n```sql\n{clipped}\n```"));
    }
    if !req.images.is_empty() {
        let names: Vec<&str> = req.images.iter().map(|img| img.name.as_str()).collect();
        sections.push(format!("[随消息附带的图片]: {}", names.join(", ")));
    }
    if !req.error_message.trim().is_empty() {
        sections.push(format!("[最近一次执行报错]:\n{}", req.error_message.trim()));
    }

    sections.push(format!("[用户问题]:\n{}", req.prompt.trim()));
    sections.join("\n\n")
}

/// 估算消息列表字符总长度，超阈值时压缩早期轮次并保持 tool_use / tool_result 配对完整性。
fn maybe_compact_messages(messages: &mut Vec<AgentChatMessage>) -> Option<(usize, usize)> {
    let total_chars: usize = messages.iter().map(|m| m.content.len() + 64).sum();
    if total_chars <= CONTEXT_COMPACT_CHAR_BUDGET || messages.len() <= 6 {
        return None;
    }

    // 保留最近 4 条关键消息，寻找安全切分点（避免切断 assistant tool_calls 与后续 tool 消息）。
    let target_keep = 4usize;
    let mut cut = messages.len().saturating_sub(target_keep);
    while cut > 1 && messages.get(cut).map(|m| m.role == "tool").unwrap_or(false) {
        cut -= 1;
    }
    if cut <= 1 {
        return None;
    }

    let removed: Vec<AgentChatMessage> = messages.drain(0..cut).collect();
    let removed_count = removed.len();
    let summary_lines: Vec<String> = removed
        .iter()
        .filter(|m| m.role == "user" || (m.role == "assistant" && !m.content.trim().is_empty()))
        .take(8)
        .map(|m| {
            let preview: String = m.content.trim().chars().take(160).collect();
            format!("- [{}] {}", m.role, preview.replace('\n', " "))
        })
        .collect();

    messages.insert(
        0,
        AgentChatMessage {
            role: "user".to_string(),
            content: format!("[早期对话上下文摘要]\n{}", summary_lines.join("\n")),
            tool_calls: Vec::new(),
            tool_call_id: None,
            tool_name: None,
            images: Vec::new(),
        },
    );

    Some((removed_count, messages.len()))
}

/// 解析本次请求应使用的 AI 配置与密钥（兼容新多配置表与历史默认回退）。
fn resolve_active_config(
    state: &AppState,
    config_id: Option<&str>,
) -> Result<(AiConfigRecord, String), AppError> {
    if let Some((cfg, key)) = get_ai_config_with_secret(&state.storage, config_id)? {
        return Ok((cfg, key));
    }
    Err(AppError::Biz(
        "尚未配置 AI 模型，请先在「设置 -> AI 模型配置」中添加并启用至少一个模型配置。".to_string(),
    ))
}

/// 运行多轮流式 Agent 循环，并持续向前端发射 `ai-agent-event`。
pub async fn run_agent_stream(
    app: AppHandle,
    state: &AppState,
    request: AiAgentStreamRequest,
) -> Result<(), String> {
    let session_id = request.session_id.trim().to_string();
    if session_id.is_empty() {
        return Err("sessionId 不能为空".to_string());
    }
    if request.prompt.trim().is_empty() {
        return Err("请输入问题或指令".to_string());
    }

    let cancel_notify = register_stream(&session_id);
    let outcome = run_agent_stream_inner(&app, state, &request, &cancel_notify).await;
    unregister_stream(&session_id);

    if let Err(err) = outcome {
        emit_agent_event(
            &app,
            &session_id,
            AgentEvent::Error {
                message: err.clone(),
            },
        );
        return Err(err);
    }
    Ok(())
}

async fn run_agent_stream_inner(
    app: &AppHandle,
    state: &AppState,
    request: &AiAgentStreamRequest,
    cancel_notify: &std::sync::Arc<tokio::sync::Notify>,
) -> Result<(), String> {
    let (config, api_key) =
        resolve_active_config(state, request.config_id.as_deref()).map_err(|e| e.to_string())?;
    let source = SourceService::new(&state.storage)
        .get_runtime_source(&request.source_id)
        .map_err(|e| e.to_string())?;
    let driver = state
        .driver_registry
        .get(&source.source_type)
        .map_err(|e| e.to_string())?;
    let capabilities = driver.capabilities();

    let environment = source
        .config_json
        .get("environment")
        .and_then(|v| v.as_str())
        .unwrap_or("default")
        .to_string();
    let read_only = source
        .config_json
        .get("readOnly")
        .and_then(|v| v.as_bool())
        .unwrap_or(false);

    let system_prompt = build_agent_system_prompt(
        &source.name,
        &capabilities.query_language,
        &environment,
        read_only,
        request.mode,
        request.action.as_deref(),
        &request.custom_instructions,
    );

    let tools: Vec<ToolDefinition> = build_tools_for_mode(request.mode, &capabilities);
    let tool_ctx = AgentToolContext {
        storage: &state.storage,
        driver_registry: &state.driver_registry,
        source_id: source.id.clone(),
        environment,
        read_only,
        capabilities,
        confirmed_write_sql: request.confirmed_write_sql.clone(),
        confirmed_source_id: request.confirmed_source_id.clone(),
    };

    let mut messages = request.history.clone();
    messages.push(AgentChatMessage {
        role: "user".to_string(),
        content: build_user_prompt_with_context(request),
        tool_calls: Vec::new(),
        tool_call_id: None,
        tool_name: None,
        images: request.images.clone(),
    });

    let max_turns = request.max_turns.unwrap_or(DEFAULT_MAX_TURNS).clamp(5, 40);
    let mut total_input_tokens = 0u64;
    let mut total_output_tokens = 0u64;

    for turn in 1..=max_turns {
        if let Some((removed_count, remaining_count)) = maybe_compact_messages(&mut messages) {
            emit_agent_event(
                app,
                &request.session_id,
                AgentEvent::ContextCompacted {
                    removed_count,
                    remaining_count,
                },
            );
        }

        emit_agent_event(app, &request.session_id, AgentEvent::TurnStart { turn });

        let turn_output = stream_model_turn(
            &config,
            &api_key,
            &system_prompt,
            &messages,
            &tools,
            cancel_notify,
            |delta| {
                emit_agent_event(app, &request.session_id, AgentEvent::TextDelta { delta });
            },
            |delta| {
                emit_agent_event(
                    app,
                    &request.session_id,
                    AgentEvent::ReasoningDelta { delta },
                );
            },
        )
        .await
        .map_err(|e| e.to_string())?;

        total_input_tokens = total_input_tokens.saturating_add(turn_output.input_tokens);
        total_output_tokens = total_output_tokens.saturating_add(turn_output.output_tokens);

        // 无工具调用表示模型已完成最终答复。
        if turn_output.tool_calls.is_empty() {
            emit_agent_event(app, &request.session_id, AgentEvent::TurnEnd { turn });
            break;
        }

        // 先检查是否包含被拦截或需要二次确认的写操作工具。
        for call in &turn_output.tool_calls {
            match check_tool_write_gate(&tool_ctx, call) {
                WriteGateCheck::Allowed => {}
                WriteGateCheck::Blocked { sql, reason } => {
                    emit_agent_event(
                        app,
                        &request.session_id,
                        AgentEvent::ProductionWriteBlocked { sql, reason },
                    );
                    emit_agent_event(app, &request.session_id, AgentEvent::TurnEnd { turn });
                    emit_agent_event(
                        app,
                        &request.session_id,
                        AgentEvent::AgentEnd {
                            input_tokens: total_input_tokens,
                            output_tokens: total_output_tokens,
                        },
                    );
                    return Ok(());
                }
                WriteGateCheck::NeedsConfirmation { sql, reason } => {
                    emit_agent_event(
                        app,
                        &request.session_id,
                        AgentEvent::WriteSqlConfirmationRequired { sql, reason },
                    );
                    emit_agent_event(app, &request.session_id, AgentEvent::TurnEnd { turn });
                    emit_agent_event(
                        app,
                        &request.session_id,
                        AgentEvent::AgentEnd {
                            input_tokens: total_input_tokens,
                            output_tokens: total_output_tokens,
                        },
                    );
                    return Ok(());
                }
            }
        }

        messages.push(AgentChatMessage {
            role: "assistant".to_string(),
            content: turn_output.text.clone(),
            tool_calls: turn_output.tool_calls.clone(),
            tool_call_id: None,
            tool_name: None,
            images: Vec::new(),
        });

        // 拆分为可并行只读工具与串行查询工具，兼顾速度与连接安全。
        let parallel_set: std::collections::HashSet<&str> = tools
            .iter()
            .filter(|t| t.parallel_ok)
            .map(|t| t.name.as_str())
            .collect();

        let mut parallel_calls: Vec<(usize, &ToolCall)> = Vec::new();
        let mut sequential_calls: Vec<(usize, &ToolCall)> = Vec::new();
        for (idx, call) in turn_output.tool_calls.iter().enumerate() {
            emit_agent_event(
                app,
                &request.session_id,
                AgentEvent::ToolCallStart {
                    tool_call_id: call.id.clone(),
                    tool_name: call.name.clone(),
                    args: call.arguments.clone(),
                },
            );
            if parallel_set.contains(call.name.as_str()) {
                parallel_calls.push((idx, call));
            } else {
                sequential_calls.push((idx, call));
            }
        }

        let mut ordered_results: Vec<Option<ToolResult>> = vec![None; turn_output.tool_calls.len()];

        if !parallel_calls.is_empty() {
            let futs = parallel_calls
                .iter()
                .map(|(_, call)| execute_agent_tool(&tool_ctx, call));
            let res_list = join_all(futs).await;
            for ((idx, _), result) in parallel_calls.into_iter().zip(res_list.into_iter()) {
                ordered_results[idx] = Some(result);
            }
        }

        for (idx, call) in sequential_calls {
            let result = execute_agent_tool(&tool_ctx, call).await;
            ordered_results[idx] = Some(result);
        }

        for result in ordered_results.into_iter().flatten() {
            emit_agent_event(
                app,
                &request.session_id,
                AgentEvent::ToolCallEnd {
                    tool_call_id: result.tool_call_id.clone(),
                    tool_name: result.tool_name.clone(),
                    result: result.content.clone(),
                    is_error: result.is_error,
                },
            );
            messages.push(AgentChatMessage {
                role: "tool".to_string(),
                content: result.content,
                tool_calls: Vec::new(),
                tool_call_id: Some(result.tool_call_id),
                tool_name: Some(result.tool_name),
                images: Vec::new(),
            });
        }

        emit_agent_event(app, &request.session_id, AgentEvent::TurnEnd { turn });
    }

    emit_agent_event(
        app,
        &request.session_id,
        AgentEvent::AgentEnd {
            input_tokens: total_input_tokens,
            output_tokens: total_output_tokens,
        },
    );
    Ok(())
}
