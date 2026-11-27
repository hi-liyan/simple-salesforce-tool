import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { History, Maximize2, Minimize2, Plus, Settings, Sparkles, X } from "lucide-react";
import { aiApi } from "../../api/ai";
import { getDataSourceDriver } from "../../drivers/registry";
import { useObjectsQuery } from "../../queries/salesforce";
import { useAiStore } from "../../store/useAiStore";
import type {
  AgentEvent,
  AiChatMessage,
  AiMessageImage,
  AiMessageMentionBadge,
  AiToolStep,
  AiWorkspaceContextBridge
} from "../../types/ai";
import { AiConversationDrawer } from "./AiConversationDrawer";
import { AiMessageList } from "./AiMessageList";
import { AiPromptInput } from "./AiPromptInput";
import type {
  AiEditorSelectionChip,
  AiPromptAttachment,
  AiPromptMentionChip,
  AiQueuedPrompt
} from "./aiPromptUtils";

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
    boundSourceId,
    sourceFollowsWorkspace,
    messages,
    streaming,
    activeStreamSessionId,
    statusText,
    pendingLaunchIntent,
    setDockMaximized,
    setMode,
    setAction,
    setSelectedConfigId,
    setBoundSourceId,
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
  const [selectedMentions, setSelectedMentions] = useState<AiPromptMentionChip[]>([]);
  const [selectedSelections, setSelectedSelections] = useState<AiEditorSelectionChip[]>([]);
  const [attachments, setAttachments] = useState<AiPromptAttachment[]>([]);
  const [selectedTemplateIds, setSelectedTemplateIds] = useState<string[]>([]);
  const [queuedPrompt, setQueuedPrompt] = useState<AiQueuedPrompt | null>(null);
  const [previewImage, setPreviewImage] = useState<{ name: string; dataUrl?: string } | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [inlineWarning, setInlineWarning] = useState("");

  // 解析 AI 助手当前生效的数据源（新建会话默认跟随工作区，手动切换或发送首条消息后锁定）。
  const lockedSource = useMemo(
    () => (boundSourceId ? workspaceBridge.sources.find((s) => s.id === boundSourceId) || null : null),
    [boundSourceId, workspaceBridge.sources]
  );
  const isUsingLockedSource = !sourceFollowsWorkspace && Boolean(lockedSource);
  const effectiveSourceId = isUsingLockedSource ? lockedSource!.id : workspaceBridge.sourceId;
  const effectiveSourceName = isUsingLockedSource ? lockedSource!.name : workspaceBridge.sourceName;
  const effectiveSourceType = isUsingLockedSource
    ? String(lockedSource!.sourceType || "salesforce")
    : workspaceBridge.sourceType;
  const effectiveQueryLanguage = useMemo(
    () => getDataSourceDriver(effectiveSourceType).capabilities.queryLanguage,
    [effectiveSourceType]
  );

  // 当 AI 锁定了与主工作区不同的数据源时，独立拉取该数据源的对象列表供 `@` 引用。
  const needSeparateObjects =
    Boolean(effectiveSourceId) && effectiveSourceId !== workspaceBridge.sourceId;
  const { data: separateObjects = [] } = useObjectsQuery(
    needSeparateObjects ? effectiveSourceId : ""
  );
  const effectiveAvailableObjects = useMemo(
    () =>
      needSeparateObjects
        ? separateObjects.map((obj) => obj.name)
        : workspaceBridge.availableObjects,
    [needSeparateObjects, separateObjects, workspaceBridge.availableObjects]
  );

  // 提取当前会话中的历史用户提问列表（供 `ArrowUp` 回溯）。
  const promptHistory = useMemo(
    () => messages.filter((m) => m.role === "user" && m.content.trim().length > 0).map((m) => m.content),
    [messages]
  );

  // 帧合批缓冲：避免高频 text_delta / reasoning_delta 每字节触发 React 重渲染。
  const pendingTextDeltaRef = useRef("");
  const pendingReasoningDeltaRef = useRef("");
  const deltaFlushFrameRef = useRef<number | null>(null);
  const activeAssistantMsgIdRef = useRef("");
  const activeEpochRef = useRef(0);
  const bridgeRef = useRef(workspaceBridge);
  bridgeRef.current = workspaceBridge;
  const effectiveSourceRef = useRef({
    id: effectiveSourceId,
    name: effectiveSourceName,
    followsWorkspace: sourceFollowsWorkspace
  });
  effectiveSourceRef.current = {
    id: effectiveSourceId,
    name: effectiveSourceName,
    followsWorkspace: sourceFollowsWorkspace
  };

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

  // 发起一轮流式 Agent 对话（支持普通发送、结构化上下文与确认写操作重放）。
  const dispatchAgentTurn = useCallback(
    async (options: {
      promptText: string;
      mentions?: AiPromptMentionChip[];
      selections?: AiEditorSelectionChip[];
      turnAttachments?: AiPromptAttachment[];
      errorMessage?: string;
      selectedSql?: string;
      confirmedWriteSql?: string;
      confirmedSourceId?: string;
    }) => {
      const bridge = bridgeRef.current;
      const sourceSnap = effectiveSourceRef.current;
      const targetSourceId = options.confirmedSourceId || sourceSnap.id;
      const targetSourceName =
        bridge.sources.find((s) => s.id === targetSourceId)?.name || sourceSnap.name;
      if (!targetSourceId) {
        setInlineWarning("请先在上方或左侧选择一个数据源，或新建数据源后再发送。");
        return false;
      }
      // 首次发送消息时自动锁定当前会话数据源，避免后续切换工作区 Tab 意外改变对话目标源。
      if (sourceSnap.followsWorkspace) {
        setBoundSourceId(targetSourceId, false);
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

      const chipMentions = options.mentions ?? [];
      const chipSelections = options.selections ?? [];
      const turnAttachments = options.turnAttachments ?? [];
      const imageAttachments = turnAttachments.filter(
        (a) => a.kind === "image" && Boolean(a.dataUrl)
      );

      // 组装用户气泡上展示的结构化引用标签（图片以独立缩略图展示，不重复生成纯文本标签）。
      const messageBadges: AiMessageMentionBadge[] = [
        ...chipMentions.map((m) => ({ kind: "object" as const, label: m.raw })),
        ...chipSelections.map((s) => ({ kind: "selection" as const, label: s.label })),
        ...turnAttachments
          .filter((a) => a.kind !== "image")
          .map((a) => ({
            kind: "file" as const,
            label: a.name
          }))
      ];
      const messageImages: AiMessageImage[] = imageAttachments.map((a) => ({
        id: a.id,
        name: a.name,
        dataUrl: a.dataUrl!
      }));

      // 组装附加文本上下文（附件与选区内容）。
      const textAttachmentSections = turnAttachments
        .filter((a) => a.kind === "text" && a.content)
        .map((a) => `[附件 ${a.name}]:\n\`\`\`\n${a.content}\n\`\`\``);
      const effectivePrompt = [options.promptText.trim(), ...textAttachmentSections]
        .filter(Boolean)
        .join("\n\n");

      const combinedSelectedSql = [
        options.selectedSql || "",
        ...chipSelections.map((s) => s.sql)
      ]
        .filter((s) => s.trim().length > 0)
        .join("\n\n");

      const mergedMentionedObjects = Array.from(
        new Set([
          ...chipMentions.map((m) => m.name),
          ...extractMentionedObjects(options.promptText)
        ])
      );

      const selectedTemplateInstructions = promptTemplates
        .filter((tpl) => selectedTemplateIds.includes(tpl.id))
        .map((tpl) => `【${tpl.name}】\n${tpl.content}`)
        .join("\n\n");

      const userMessage: AiChatMessage = {
        id: `msg-usr-${Date.now()}`,
        role: "user",
        content: options.promptText || "[上下文引用]",
        mentions: messageBadges.length > 0 ? messageBadges : undefined,
        images: messageImages.length > 0 ? messageImages : undefined,
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
              setStatusText("深度思考中...");
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
                          sourceId: targetSourceId,
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
        const isSameAsWorkspace = targetSourceId === bridge.sourceId;
        await aiApi.startAgentStream({
          sessionId,
          sourceId: targetSourceId,
          configId: currentState.selectedConfigId || null,
          mode: currentState.mode,
          action: currentState.action,
          prompt: effectivePrompt || "请结合上方挂载的上下文进行分析与解答。",
          history: historySnapshot,
          currentEditorSql: isSameAsWorkspace ? bridge.currentEditorSql : "",
          selectedEditorSql:
            combinedSelectedSql || (isSameAsWorkspace ? bridge.selectedEditorSql : ""),
          mentionedObjects: mergedMentionedObjects,
          workspaceContextSummary: isSameAsWorkspace ? bridge.workspaceContextSummary : "",
          images: messageImages.map((img) => ({ name: img.name, dataUrl: img.dataUrl })),
          errorMessage: options.errorMessage || "",
          customInstructions: selectedTemplateInstructions,
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
          void persistCurrentConversation(targetSourceId, targetSourceName);
        }
      }
    },
    [
      bumpGenerationEpoch,
      flushBufferedDeltas,
      persistCurrentConversation,
      promptTemplates,
      scheduleDeltaFlush,
      selectedTemplateIds,
      setBoundSourceId,
      setMessages,
      setStatusText,
      setStreamingState
    ]
  );

  // 当流式生成结束且存在排队输入时，自动消费下一条排队任务。
  useEffect(() => {
    if (streaming || !queuedPrompt) return;
    const next = queuedPrompt;
    setQueuedPrompt(null);
    void dispatchAgentTurn({
      promptText: next.text,
      mentions: next.mentions,
      selections: next.selections,
      turnAttachments: next.attachments
    });
  }, [dispatchAgentTurn, queuedPrompt, streaming]);

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
      // 参考 DBX #10058：编辑器选区挂载为独立 Chip，不污染用户输入正文。
      if (intent.selectedSql && intent.selectedSql.trim()) {
        const lineCount = intent.selectedSql.trim().split(/\r?\n/).length;
        setSelectedSelections((prev) => [
          ...prev,
          {
            id: `sel-${Date.now()}`,
            label: `编辑器选区 (${lineCount} 行)`,
            sql: intent.selectedSql!,
            truncated: false
          }
        ]);
      }
      if (intent.prompt) {
        setInputDraft(intent.prompt);
      }
    }
  }, [clearLaunchIntent, dispatchAgentTurn, pendingLaunchIntent, setAction, setMode]);

  // 清空当前输入区与结构化上下文。
  function clearComposerInputs() {
    setInputDraft("");
    setSelectedMentions([]);
    setSelectedSelections([]);
    setAttachments([]);
  }

  function handleSend() {
    const trimmed = inputDraft.trim();
    const hasContext =
      selectedMentions.length > 0 || selectedSelections.length > 0 || attachments.length > 0;
    if ((!trimmed && !hasContext) || streaming) return;
    if (!effectiveSourceRef.current.id) {
      setInlineWarning("请先在上方或左侧选择一个数据源，或新建数据源后再发送。");
      return;
    }
    const snapshot = {
      promptText: trimmed,
      mentions: [...selectedMentions],
      selections: [...selectedSelections],
      turnAttachments: [...attachments]
    };
    setInlineWarning("");
    clearComposerInputs();
    void dispatchAgentTurn(snapshot);
  }

  function handleQueueSend() {
    const trimmed = inputDraft.trim();
    const hasContext =
      selectedMentions.length > 0 || selectedSelections.length > 0 || attachments.length > 0;
    if (!trimmed && !hasContext) return;
    setQueuedPrompt({
      text: trimmed,
      mentions: [...selectedMentions],
      selections: [...selectedSelections],
      attachments: [...attachments]
    });
    clearComposerInputs();
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
          {effectiveSourceName && (
            <span className="max-w-[110px] truncate rounded bg-base-200 px-1.5 py-0.5 text-[10px] text-neutral/75">
              {effectiveSourceName}
            </span>
          )}
        </div>

        <div className="flex shrink-0 items-center gap-0.5">
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
        onPreviewImage={(img) => setPreviewImage(img)}
        onReplaceSql={(sql) => workspaceBridge.onReplaceEditorSql(sql, effectiveSourceId)}
        onOpenNewConsole={(sql) => workspaceBridge.onOpenNewConsoleWithSql(sql, effectiveSourceId)}
        onExecuteSql={(sql) => workspaceBridge.onExecuteSqlDirect(sql, effectiveSourceId)}
        onConfirmWriteSql={(messageId, sql, sourceId) => {
          if (effectiveSourceId && sourceId && effectiveSourceId !== sourceId) {
            setInlineWarning("当前数据源已切换，请先切回原数据源后再确认执行该写操作。");
            return;
          }
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

      {/* 底部输入区（对齐 DBX 复合 Composer 容器）。 */}
      <AiPromptInput
        value={inputDraft}
        onChange={setInputDraft}
        sources={workspaceBridge.sources}
        effectiveSourceId={effectiveSourceId}
        sourceName={effectiveSourceName}
        sourceType={effectiveSourceType}
        queryLanguage={effectiveQueryLanguage}
        sourceFollowsWorkspace={sourceFollowsWorkspace}
        workspaceSourceName={workspaceBridge.sourceName}
        onSelectSourceId={(nextSourceId) => {
          if (streaming) return;
          if (!nextSourceId) {
            setBoundSourceId("", true);
          } else {
            setBoundSourceId(nextSourceId, false);
          }
          setSelectedMentions([]);
          setInlineWarning("");
        }}
        hasSource={Boolean(effectiveSourceId)}
        mode={mode}
        onModeChange={setMode}
        action={action}
        onActionChange={setAction}
        configs={configs}
        selectedConfigId={selectedConfigId}
        onSelectConfigId={setSelectedConfigId}
        availableObjects={effectiveAvailableObjects}
        selectedMentions={selectedMentions}
        onChangeMentions={setSelectedMentions}
        selectedSelections={selectedSelections}
        onChangeSelections={setSelectedSelections}
        attachments={attachments}
        onChangeAttachments={setAttachments}
        onPreviewImage={setPreviewImage}
        promptTemplates={promptTemplates}
        selectedTemplateIds={selectedTemplateIds}
        onToggleTemplateId={(id) =>
          setSelectedTemplateIds((prev) =>
            prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
          )
        }
        onDeselectAllTemplates={() => setSelectedTemplateIds([])}
        promptHistory={promptHistory}
        queuedPrompt={queuedPrompt}
        onEditQueuedPrompt={() => {
          if (!queuedPrompt) return;
          setInputDraft(queuedPrompt.text);
          setSelectedMentions(queuedPrompt.mentions);
          setSelectedSelections(queuedPrompt.selections);
          setAttachments(queuedPrompt.attachments);
          setQueuedPrompt(null);
        }}
        onCancelQueuedPrompt={() => setQueuedPrompt(null)}
        onAttachmentWarning={(msg) => setInlineWarning(msg)}
        streaming={streaming}
        onSend={handleSend}
        onQueueSend={handleQueueSend}
        onStop={handleStop}
      />

      {/* 图片附件大图预览弹窗。 */}
      {previewImage && previewImage.dataUrl && (
        <div
          onClick={() => setPreviewImage(null)}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="max-h-[85vh] max-w-3xl overflow-hidden rounded-xl border border-base-300 bg-base-100 p-3 shadow-2xl"
          >
            <div className="mb-2 flex items-center justify-between gap-4">
              <span className="truncate text-[12px] font-medium">{previewImage.name}</span>
              <button
                type="button"
                onClick={() => setPreviewImage(null)}
                className="rounded p-1 text-neutral/60 hover:bg-base-200 hover:text-neutral"
              >
                <X size={14} />
              </button>
            </div>
            <img
              src={previewImage.dataUrl}
              alt={previewImage.name}
              className="max-h-[75vh] max-w-full rounded-lg object-contain"
            />
          </div>
        </div>
      )}

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
