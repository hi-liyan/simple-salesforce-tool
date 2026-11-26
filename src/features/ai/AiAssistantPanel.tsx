import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { History, Maximize2, Minimize2, Plus, Settings, Sparkles, X } from "lucide-react";
import { aiApi } from "../../api/ai";
import { useAiStore } from "../../store/useAiStore";
import type { AgentEvent, AiChatMessage, AiToolStep, AiWorkspaceContextBridge } from "../../types/ai";
import { AiConversationDrawer } from "./AiConversationDrawer";
import { AiMessageList } from "./AiMessageList";
import { AiPromptInput } from "./AiPromptInput";

type AiAssistantPanelProps = {
  // 当前工作区上下文桥接（数据源、编辑器内容、写回与执行回调）。
  workspaceBridge: AiWorkspaceContextBridge;
  // 打开设置页中的 AI 配置分区。
  onOpenAiSettings: () => void;
  // 关闭 AI 停靠栏。
  onClose: () => void;
};

// 提取消息中 `@对象名` 引用列表。
function extractMentionedObjects(text: string): string[] {
  const matches = text.match(/@([A-Za-z0-9_]+)/g) || [];
  return Array.from(new Set(matches.map((m) => m.slice(1))));
}

// 右侧 AI 助手主工作台（参考 dbx 实现：支持 Ask/Agent 双模式、流式推理、工具追踪、写确认与编辑器联动）。
export function AiAssistantPanel({
  workspaceBridge,
  onOpenAiSettings,
  onClose
}: AiAssistantPanelProps) {
  const {
    dockMaximized,
    mode,
    action,
    selectedConfigId,
    configs,
    conversations,
    promptTemplates,
    activeConversationId,
    messages,
    streaming,
    activeStreamSessionId,
    statusText,
    pendingLaunchIntent,
    setDockMaximized,
    setMode,
    setAction,
    setSelectedConfigId,
    setStatusText,
    setStreamingState,
    bumpGenerationEpoch,
    loadConfigs,
    loadConversations,
    loadPromptTemplates,
    startNewConversation,
    openConversation,
    deleteConversationById,
    setMessages,
    persistCurrentConversation,
    clearLaunchIntent
  } = useAiStore();

  const [inputDraft, setInputDraft] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inlineWarning, setInlineWarning] = useState("");

  // 帧合批缓冲：避免高频 text_delta / reasoning_delta 每字节触发 React 重渲染。
  const pendingTextDeltaRef = useRef("");
  const pendingReasoningDeltaRef = useRef("");
  const deltaFlushFrameRef = useRef<number | null>(null);
  const activeAssistantMsgIdRef = useRef("");
  const activeEpochRef = useRef(0);
  const bridgeRef = useRef(workspaceBridge);
  bridgeRef.current = workspaceBridge;

  useEffect(() => {
    void loadConfigs();
    void loadConversations();
    void loadPromptTemplates();
  }, [loadConfigs, loadConversations, loadPromptTemplates]);

  const flushBufferedDeltas = useCallback(() => {
    deltaFlushFrameRef.current = null;
    const textChunk = pendingTextDeltaRef.current;
    const reasonChunk = pendingReasoningDeltaRef.current;
    pendingTextDeltaRef.current = "";
    pendingReasoningDeltaRef.current = "";
    const targetId = activeAssistantMsgIdRef.current;
    if (!targetId || (!textChunk && !reasonChunk)) return;

    setMessages((prev) =>
      prev.map((msg) =>
        msg.id === targetId
          ? {
              ...msg,
              content: textChunk ? msg.content + textChunk : msg.content,
              reasoning: reasonChunk ? (msg.reasoning || "") + reasonChunk : msg.reasoning
            }
          : msg
      )
    );
  }, [setMessages]);

  const scheduleDeltaFlush = useCallback(() => {
    if (deltaFlushFrameRef.current !== null) return;
    deltaFlushFrameRef.current = window.requestAnimationFrame(flushBufferedDeltas);
  }, [flushBufferedDeltas]);

  // 发起一轮流式 Agent 对话（支持普通发送与确认写操作重放）。
  const dispatchAgentTurn = useCallback(
    async (options: {
      promptText: string;
      errorMessage?: string;
      selectedSql?: string;
      confirmedWriteSql?: string;
      confirmedSourceId?: string;
    }) => {
      const bridge = bridgeRef.current;
      if (!bridge.sourceId) {
        setInlineWarning("请先在左侧数据源树选择一个数据源，或新建数据源后再发送。");
        return false;
      }
      setInlineWarning("");

      const epoch = bumpGenerationEpoch();
      activeEpochRef.current = epoch;
      const sessionId = `ai-sess-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      const assistantMsgId = `msg-ast-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`;
      activeAssistantMsgIdRef.current = assistantMsgId;
      pendingTextDeltaRef.current = "";
      pendingReasoningDeltaRef.current = "";

      const historySnapshot = useAiStore
        .getState()
        .messages.filter((m) => m.content.trim().length > 0)
        .slice(-16)
        .map((m) => ({ role: m.role, content: m.content }));

      const userMessage: AiChatMessage = {
        id: `msg-usr-${Date.now()}`,
        role: "user",
        content: options.promptText,
        createdAt: new Date().toISOString()
      };
      const placeholderAssistant: AiChatMessage = {
        id: assistantMsgId,
        role: "assistant",
        content: "",
        toolSteps: [],
        createdAt: new Date().toISOString()
      };

      setMessages((prev) => [...prev, userMessage, placeholderAssistant]);
      setStreamingState(true, sessionId);
      setStatusText("正在连接模型...");

      let unlisten: (() => void) | null = null;
      try {
        unlisten = await listen<AgentEvent>("ai-agent-event", (event) => {
          const payload = event.payload;
          if (!payload || payload.sessionId !== sessionId) return;
          if (useAiStore.getState().generationEpoch !== epoch) return;

          switch (payload.type) {
            case "turn_start":
              setStatusText(`第 ${payload.turn} 轮推理中...`);
              break;
            case "text_delta":
              pendingTextDeltaRef.current += payload.delta;
              scheduleDeltaFlush();
              break;
            case "reasoning_delta":
              pendingReasoningDeltaRef.current += payload.delta;
              scheduleDeltaFlush();
              break;
            case "tool_call_start": {
              const step: AiToolStep = {
                id: payload.tool_call_id,
                name: payload.tool_name,
                argsText: JSON.stringify(payload.args ?? {}),
                resultText: "",
                status: "running"
              };
              setStatusText(`正在调用工具 ${payload.tool_name}...`);
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId ? { ...m, toolSteps: [...(m.toolSteps || []), step] } : m
                )
              );
              break;
            }
            case "tool_call_end":
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        toolSteps: (m.toolSteps || []).map((s) =>
                          s.id === payload.tool_call_id
                            ? {
                                ...s,
                                resultText: payload.result,
                                status: payload.is_error ? "error" : "done"
                              }
                            : s
                        )
                      }
                    : m
                )
              );
              break;
            case "context_compacted":
              setStatusText(`已自动压缩早期 ${payload.removed_count} 条上下文`);
              break;
            case "write_sql_confirmation_required":
              flushBufferedDeltas();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        writeConfirmation: {
                          sql: payload.sql,
                          reason: payload.reason,
                          sourceId: bridge.sourceId,
                          status: "pending"
                        }
                      }
                    : m
                )
              );
              break;
            case "production_write_blocked":
              flushBufferedDeltas();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        blockedNotice: {
                          sql: payload.sql,
                          reason: payload.reason
                        }
                      }
                    : m
                )
              );
              break;
            case "error":
              flushBufferedDeltas();
              setMessages((prev) =>
                prev.map((m) =>
                  m.id === assistantMsgId
                    ? {
                        ...m,
                        content: m.content
                          ? `${m.content}\n\n[异常] ${payload.message}`
                          : `[异常] ${payload.message}`
                      }
                    : m
                )
              );
              break;
            case "agent_end":
              flushBufferedDeltas();
              break;
          }
        });

        const currentState = useAiStore.getState();
        await aiApi.startAgentStream({
          sessionId,
          sourceId: bridge.sourceId,
          configId: currentState.selectedConfigId || null,
          mode: currentState.mode,
          action: currentState.action,
          prompt: options.promptText,
          history: historySnapshot,
          currentEditorSql: bridge.currentEditorSql,
          selectedEditorSql: options.selectedSql ?? bridge.selectedEditorSql,
          mentionedObjects: extractMentionedObjects(options.promptText),
          errorMessage: options.errorMessage || "",
          customInstructions: "",
          confirmedWriteSql: options.confirmedWriteSql ?? null,
          confirmedSourceId: options.confirmedSourceId ?? null
        });
      } catch (err) {
        if (useAiStore.getState().generationEpoch === epoch) {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantMsgId && !m.content
                ? { ...m, content: `请求失败：${String(err)}` }
                : m
            )
          );
        }
      } finally {
        unlisten?.();
        flushBufferedDeltas();
        if (useAiStore.getState().generationEpoch === epoch) {
          setStreamingState(false);
          setStatusText("");
          void persistCurrentConversation(bridge.sourceId, bridge.sourceName);
        }
      }
    },
    [
      bumpGenerationEpoch,
      flushBufferedDeltas,
      persistCurrentConversation,
      scheduleDeltaFlush,
      setMessages,
      setStatusText,
      setStreamingState
    ]
  );

  // 响应外部工作区快捷意图（如“AI 修复报错”或“发送选中 SQL 到 AI”）。
  useEffect(() => {
    if (!pendingLaunchIntent) return;
    const intent = pendingLaunchIntent;
    clearLaunchIntent();
    if (intent.mode) setMode(intent.mode);
    setAction(intent.action);
    if (intent.autoSend) {
      void dispatchAgentTurn({
        promptText: intent.prompt,
        errorMessage: intent.errorMessage,
        selectedSql: intent.selectedSql
      });
    } else {
      setInputDraft(intent.prompt);
    }
  }, [clearLaunchIntent, dispatchAgentTurn, pendingLaunchIntent, setAction, setMode]);

  function handleSend() {
    const trimmed = inputDraft.trim();
    if (!trimmed || streaming) return;
    if (!bridgeRef.current.sourceId) {
      setInlineWarning("请先在左侧数据源树选择一个数据源，或新建数据源后再发送。");
      return;
    }
    setInlineWarning("");
    setInputDraft("");
    void dispatchAgentTurn({ promptText: trimmed });
  }

  function handleStop() {
    if (!activeStreamSessionId) return;
    bumpGenerationEpoch();
    void aiApi.cancelStream(activeStreamSessionId);
    setStreamingState(false);
    setStatusText("已停止");
  }

  return (
    <aside className="relative flex h-full w-full flex-col overflow-hidden rounded-xl border border-base-300/80 bg-base-100 shadow-2xs">
      {/* 顶部控制栏：数据源标识、模型选择、历史记录、新建、最大化与关闭。 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300/70 px-2.5 text-[12px]">
        <div className="flex min-w-0 items-center gap-1.5">
          <Sparkles size={14} className="shrink-0 text-primary" />
          <span className="truncate font-semibold">AI 助手</span>
          {workspaceBridge.sourceName && (
            <span className="max-w-[96px] truncate rounded bg-base-200 px-1.5 py-0.5 text-[10px] text-neutral/75">
              {workspaceBridge.sourceName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
          {configs.length > 0 && (
            <select
              value={selectedConfigId}
              onChange={(e) => setSelectedConfigId(e.target.value)}
              title="切换 AI 模型配置"
              className="mr-1 h-6 max-w-[110px] truncate rounded-md border border-base-300 bg-base-100 px-1.5 text-[10px] outline-none"
            >
              {configs.map((cfg) => (
                <option key={cfg.id} value={cfg.id}>
                  {cfg.name}
                </option>
              ))}
            </select>
          )}
          <button
            type="button"
            title="新建对话"
            onClick={startNewConversation}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
          >
            <Plus size={13} />
          </button>
          <button
            type="button"
            title="历史对话"
            onClick={() => {
              void loadConversations();
              setHistoryOpen(true);
            }}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
          >
            <History size={13} />
          </button>
          <button
            type="button"
            title="AI 模型设置"
            onClick={onOpenAiSettings}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
          >
            <Settings size={13} />
          </button>
          <button
            type="button"
            title={dockMaximized ? "还原宽度" : "最大化面板"}
            onClick={() => setDockMaximized(!dockMaximized)}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
          >
            {dockMaximized ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
          </button>
          <button
            type="button"
            title="关闭 AI 助手"
            onClick={onClose}
            className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      {/* 未配置模型引导条。 */}
      {configs.length === 0 && (
        <div className="flex items-center justify-between border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px]">
          <span className="text-warning-content">尚未配置 AI 模型密钥</span>
          <button
            type="button"
            onClick={onOpenAiSettings}
            className="font-semibold text-primary hover:underline"
          >
            去配置
          </button>
        </div>
      )}

      {/* 发送前校验提示条（如未绑定数据源时不清空输入并显式提示）。 */}
      {inlineWarning && (
        <div className="flex items-center justify-between border-b border-warning/30 bg-warning/10 px-3 py-1.5 text-[11px] text-warning-content">
          <span>{inlineWarning}</span>
          <button
            type="button"
            onClick={() => setInlineWarning("")}
            className="ml-2 shrink-0 text-neutral/60 hover:text-neutral"
          >
            关闭
          </button>
        </div>
      )}

      {/* 消息列表区。 */}
      <AiMessageList
        messages={messages}
        statusText={statusText}
        streaming={streaming}
        onReplaceSql={workspaceBridge.onReplaceEditorSql}
        onOpenNewConsole={workspaceBridge.onOpenNewConsoleWithSql}
        onExecuteSql={workspaceBridge.onExecuteSqlDirect}
        onConfirmWriteSql={(messageId, sql, sourceId) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId && m.writeConfirmation
                ? { ...m, writeConfirmation: { ...m.writeConfirmation, status: "confirmed" } }
                : m
            )
          );
          void dispatchAgentTurn({
            promptText: `我已确认执行该语句：\n\`\`\`sql\n${sql}\n\`\`\`\n请立即执行并反馈结果。`,
            confirmedWriteSql: sql,
            confirmedSourceId: sourceId
          });
        }}
        onCancelWriteSql={(messageId) => {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === messageId && m.writeConfirmation
                ? { ...m, writeConfirmation: { ...m.writeConfirmation, status: "cancelled" } }
                : m
            )
          );
        }}
      />

      {/* 底部输入区。 */}
      <AiPromptInput
        value={inputDraft}
        onChange={setInputDraft}
        mode={mode}
        onModeChange={setMode}
        action={action}
        onActionChange={setAction}
        availableObjects={workspaceBridge.availableObjects}
        promptTemplates={promptTemplates}
        streaming={streaming}
        onSend={handleSend}
        onStop={handleStop}
      />

      {/* 历史会话抽屉。 */}
      {historyOpen && (
        <AiConversationDrawer
          conversations={conversations}
          activeConversationId={activeConversationId}
          onSelect={openConversation}
          onDelete={(id) => void deleteConversationById(id)}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </aside>
  );
}
