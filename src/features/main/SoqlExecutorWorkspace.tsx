import { useEffect, useMemo, useRef, useState } from "react";
import { MessageSquare, Play, Plus, Table2, WandSparkles, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { DataGrid } from "../../components/DataGrid";
import { NoticeAlert } from "../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../components/SoqlMonacoEditor";
import { api } from "../../api";
import { Notice, QueryResult, SalesforceObject, SoqlConversationResponse, TabLog } from "../../types";

type AiConversationItem = {
  // 消息唯一标识，用于流式更新定位。
  id: string;
  // 消息发送方：user=用户输入，assistant=AI 回复。
  role: "user" | "assistant";
  // 消息正文。
  content: string;
  // AI 回复状态：clarify=继续澄清，ready=可应用 SOQL。
  status?: "clarify" | "ready";
  // AI 引导问题列表（仅 clarify 时展示）。
  questions?: string[];
  // AI 产出的 SOQL（仅 ready 时展示）。
  soql?: string;
};

type AiStreamChunkPayload = {
  // 流式请求 ID。
  requestId: string;
  // 增量文本片段。
  chunk: string;
};

type SoqlExecutorTab = {
  id: string;
  name: string;
  soqlDraft: string;
  // 当前编辑器选中文本：用于“仅执行选中内容”。
  selectedSoqlText: string;
  result: QueryResult;
  loading: boolean;
  notice: Notice | null;
  logs: TabLog[];
  selectedRecordIds: string[];
  // 是否显示底部结果/日志区域：默认新建 Tab 隐藏，查询成功后展示。
  showBottomPanel: boolean;
  // AI 多轮会话 ID：为空时由后端创建。
  aiConversationId: string;
  // AI 对话输入草稿。
  aiPromptDraft: string;
  // AI 会话消息列表（用户与助手交替展示）。
  aiMessages: AiConversationItem[];
  // AI 请求加载状态。
  aiLoading: boolean;
  // AI 模式开关：开启后用聊天界面替代 SOQL 编辑器。
  aiMode: boolean;
  // 当前流式请求 ID：用于把 chunk 路由到当前 Tab 对话。
  aiStreamRequestId: string;
};

type SoqlExecutorWorkspaceProps = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 加载遮罩文案。
  loadingText: string;
  // 当前数据源对象列表：用于对象名补全。
  objects: SalesforceObject[];
};

type BottomView = "result" | "logs";

// SOQL 执行器工作区：支持多 Tab、执行、结果展示与查询日志。
export function SoqlExecutorWorkspace({ selectedSourceId, loadingText, objects }: SoqlExecutorWorkspaceProps) {
  // SOQL 执行器的多标签状态。
  const [tabs, setTabs] = useState<SoqlExecutorTab[]>(() => [createSoqlExecutorTab(1)]);
  // 当前激活标签 ID。
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  // 底部展示模式：结果 / 日志。
  const [bottomView, setBottomView] = useState<BottomView>("result");
  // 底部结果日志区高度：支持鼠标拖拽调整。
  const [bottomPanelHeight, setBottomPanelHeight] = useState(260);
  // 是否正在拖拽底部区域高度。
  const [draggingBottomResize, setDraggingBottomResize] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(260);
  // 编辑器与底部面板的分栏容器：用于按容器高度约束拖拽范围。
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  // 当前激活编辑器的最新选中文本（同步引用）：避免点击执行时读取到异步状态旧值。
  const selectedSoqlTextRef = useRef("");
  // 对象字段缓存：按需 describe 后用于上下文补全，避免重复请求。
  const [objectFieldsMap, setObjectFieldsMap] = useState<Record<string, string[]>>({});
  // 当前数据源可查询对象名集合：用于 FROM 子句对象补全。
  const objectNames = useMemo(() => objects.filter((item) => item.queryable).map((item) => item.name), [objects]);
  // 缓存中的字段总集合：作为 FROM 未确定时的回退补全候选。
  const fallbackFieldNames = useMemo(
    () => Array.from(new Set(Object.values(objectFieldsMap).flatMap((fields) => fields))),
    [objectFieldsMap]
  );

  // 当前激活标签数据。
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId]
  );
  // 平台检测：用于区分 Mac 的 Command 键与 Windows 的 Alt 键发送快捷键。
  const isMacPlatform = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  }, []);

  useEffect(() => {
    if (!activeTab?.notice) return;
    const timer = window.setTimeout(() => {
      setTabs((current) =>
        current.map((tab) => (tab.id === activeTab.id ? { ...tab, notice: null } : tab))
      );
    }, 3200);
    return () => {
      window.clearTimeout(timer); // 切换 Tab 或 notice 变化时清理旧定时器。
    };
  }, [activeTab?.id, activeTab?.notice]);

  useEffect(() => {
    // 监听后端流式事件：按 requestId 路由到对应 Tab 的 AI 回复气泡。
    let alive = true;
    let unlisten: (() => void) | null = null;
    void listen<AiStreamChunkPayload>("llm:soql-stream-chunk", (event) => {
      if (!alive) return;
      const requestId = event.payload?.requestId || "";
      const chunk = event.payload?.chunk || "";
      if (!requestId || !chunk) return;
      setTabs((current) =>
        current.map((tab) => {
          if (tab.aiStreamRequestId !== requestId) return tab;
          const nextMessages = tab.aiMessages.map((item) => {
            if (item.id !== requestId || item.role !== "assistant") return item;
            return { ...item, content: nextStreamingPlaceholder(item.content) };
          });
          return { ...tab, aiMessages: nextMessages };
        })
      );
    }).then((dispose) => {
      unlisten = dispose;
    });

    return () => {
      alive = false;
      unlisten?.();
    };
  }, []);

  useEffect(() => {
    // 切换 Tab 或状态更新时同步 ref，保证执行入口读取到当前激活 Tab 的选区文本。
    selectedSoqlTextRef.current = activeTab?.selectedSoqlText || "";
  }, [activeTab?.id, activeTab?.selectedSoqlText]);

  useEffect(() => {
    setObjectFieldsMap({}); // 切换数据源后清空旧缓存，避免跨源字段污染。
  }, [selectedSourceId]);

  useEffect(() => {
    if (!draggingBottomResize) return;
    const onMouseMove = (event: MouseEvent) => {
      const delta = dragStartYRef.current - event.clientY;
      const next = dragStartHeightRef.current + delta;
      const containerHeight = splitContainerRef.current?.clientHeight || 0;
      const minTopHeight = 180; // 顶部编辑器最小高度，避免拖拽后无法编辑。
      const minBottomHeight = 160; // 底部面板最小高度，保证结果/日志可读。
      const maxBottomHeight = Math.max(minBottomHeight, containerHeight - minTopHeight);
      setBottomPanelHeight(Math.max(minBottomHeight, Math.min(maxBottomHeight, next))); // 约束在分栏容器内，仅移动顶部边界。
    };
    const onMouseUp = () => {
      setDraggingBottomResize(false);
    };
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingBottomResize]);

  useEffect(() => {
    if (!selectedSourceId || !activeTab) return;
    const fromObjectNames = extractFromObjectNames(activeTab.soqlDraft);
    if (fromObjectNames.length === 0) return;
    const queryableObjectNameSet = new Set(objectNames.map((name) => name.toLowerCase()));
    const loadedObjectNameSet = new Set(Object.keys(objectFieldsMap).map((name) => name.toLowerCase()));
    const unloadedObjectNames = fromObjectNames.filter((objectName) => {
      if (!queryableObjectNameSet.has(objectName.toLowerCase())) return false; // 仅加载当前数据源可查询对象。
      return !loadedObjectNameSet.has(objectName.toLowerCase());
    });
    if (unloadedObjectNames.length === 0) return;

    let cancelled = false;
    void Promise.all(
      unloadedObjectNames.map(async (objectName) => {
        try {
          const describe = await api.describeObject(selectedSourceId, objectName);
          return {
            objectName,
            fields: describe.fields.map((field) => field.name)
          };
        } catch {
          return null; // describe 失败时忽略，不阻塞其它对象字段加载。
        }
      })
    ).then((describes) => {
      if (cancelled) return;
      const loadedEntries = describes.filter((item): item is { objectName: string; fields: string[] } => Boolean(item));
      if (loadedEntries.length === 0) return;
      setObjectFieldsMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.fields; // 写入缓存，供编辑器上下文补全读取。
        });
        return next;
      });
    });

    return () => {
      cancelled = true; // 避免异步返回后写入已失效状态。
    };
  }, [selectedSourceId, activeTab, objectNames, objectFieldsMap]);

  // 结果表专用数据：关系字段扁平化 + 子查询展开为多行。
  const gridResult = useMemo<QueryResult>(() => {
    if (!activeTab) return { totalSize: 0, records: [] };
    return {
      totalSize: activeTab.result.totalSize,
      records: activeTab.result.records.flatMap((record) => expandRecordForGridRows(record))
    };
  }, [activeTab]);

  // 当前标签可见列：从扁平化后的结果记录动态抽取字段。
  const visibleColumns = useMemo(() => {
    if (!activeTab) return [];
    return extractVisibleColumns(gridResult.records);
  }, [activeTab, gridResult.records]);

  // 当前标签字段元数据映射：执行器模式统一只读，避免误编辑。
  const fieldMetadataMap = useMemo(() => {
    return visibleColumns.reduce((acc, fieldName) => {
      acc[fieldName] = {
        // 禁止更新：DataGrid 将据此禁用编辑。
        updateable: false,
        // 禁止创建：DataGrid 将据此禁用新建场景编辑。
        createable: false
      };
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [visibleColumns]);

  // 新建一个 SOQL 标签。
  function createTab() {
    const nextIndex = tabs.length + 1;
    const nextTab = createSoqlExecutorTab(nextIndex);
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
  }

  // 关闭指定标签，并收敛激活项到可用标签。
  function closeTab(tabId: string) {
    setTabs((current) => {
      const nextTabs = current.filter((item) => item.id !== tabId);
      if (nextTabs.length === 0) {
        const fallback = createSoqlExecutorTab(1);
        setActiveTabId(fallback.id);
        return [fallback];
      }

      if (activeTabId === tabId) {
        setActiveTabId(nextTabs[0].id);
      }
      return nextTabs;
    });
  }

  // 更新当前激活标签（复用函数式更新，避免并发状态覆盖）。
  function patchActiveTab(updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) {
    if (!activeTab) return;
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)));
  }

  // 执行当前标签中的 SOQL 并写入结果与日志。
  async function executeActiveTabSoql() {
    if (!activeTab) return;
    if (!selectedSourceId) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请先在左侧选择数据源。" }
      }));
      return;
    }

    // 有选区时仅执行选中内容；无选区时回退执行全文。
    const latestSelectedSoqlText = selectedSoqlTextRef.current.trim();
    const executeSoql = latestSelectedSoqlText || activeTab.selectedSoqlText.trim() || activeTab.soqlDraft.trim();
    if (!executeSoql) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "SOQL 不能为空。" }
      }));
      return;
    }

    patchActiveTab((tab) => ({ ...tab, loading: true, notice: null }));

    try {
      // 调用后端统一查询命令，支持常规查询与复杂子查询。
      const result = await api.queryRecords(selectedSourceId, executeSoql);
      const normalizedResult = normalizeQueryResult(result);

      patchActiveTab((tab) => ({
        ...tab,
        result: normalizedResult,
        loading: false,
        selectedRecordIds: [],
        showBottomPanel: true,
        notice: { type: "success", message: `执行成功，返回 ${normalizedResult.totalSize} 条。` },
        logs: [
          buildSoqlLog(true, executeSoql, `执行成功，返回 ${normalizedResult.totalSize} 条。`),
          ...tab.logs
        ].slice(0, 200)
      }));
      // 执行成功后自动切换到结果视图。
      setBottomView("result");
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `执行失败：${String(error)}` },
        logs: [
          buildSoqlLog(false, executeSoql, "执行 SOQL 失败。", String(error)),
          ...tab.logs
        ].slice(0, 200)
      }));
      // 执行失败后切换到日志视图，便于快速定位问题。
      setBottomView("logs");
    }
  }

  // 向 AI 发送一轮消息：支持澄清追问和最终 SOQL 生成。
  async function sendAiPrompt() {
    if (!activeTab) return;
    if (!selectedSourceId) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请先在左侧选择数据源。" }
      }));
      return;
    }

    const prompt = activeTab.aiPromptDraft.trim();
    if (!prompt) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请输入自然语言需求后再发送。" }
      }));
      return;
    }

    const contextObjectHint = extractFromObjectNames(activeTab.soqlDraft)[0] || "";
    const streamRequestId = `ai-stream-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchActiveTab((tab) => ({
      ...tab,
      aiLoading: true,
      aiStreamRequestId: streamRequestId,
      aiPromptDraft: "",
      aiMessages: [
        ...tab.aiMessages,
        { id: `user-${streamRequestId}`, role: "user", content: prompt },
        { id: streamRequestId, role: "assistant", content: "AI 正在生成" }
      ]
    }));

    try {
      const response = await api.generateSoqlFromConversation({
        sourceId: selectedSourceId,
        conversationId: activeTab.aiConversationId || undefined,
        userMessage: prompt,
        contextObjectHint: contextObjectHint || undefined,
        streamRequestId
      });
      patchActiveTab((tab) => applyAiResponseToTab(tab, response, streamRequestId));
    } catch (error) {
      patchActiveTab((tab) => {
        if (tab.aiStreamRequestId !== streamRequestId) return tab;
        return {
          ...tab,
          aiLoading: false,
          aiStreamRequestId: "",
          notice: { type: "error", message: `AI 生成失败：${String(error)}` },
          aiMessages: tab.aiMessages.map((item) =>
            item.id === streamRequestId
              ? {
                  ...item,
                  content: `生成失败：${String(error)}`,
                  status: "clarify" as const,
                  questions: ["请确认 LLM 设置（baseUrl、model、apiKey）是否已正确保存。"]
                }
              : item
          )
        };
      });
    }
  }

  // 停止当前流式输出：通知后端取消并收敛前端加载状态。
  async function stopAiStreaming() {
    if (!activeTab?.aiStreamRequestId) return;
    const requestId = activeTab.aiStreamRequestId;
    try {
      await api.stopLlmStreamGeneration(requestId);
    } catch {
      // 停止动作失败不阻塞前端状态收敛。
    }
    patchActiveTab((tab) => ({
      ...tab,
      aiLoading: false,
      aiStreamRequestId: "",
      aiMessages: tab.aiMessages.map((item) =>
        item.id === requestId && item.role === "assistant"
          ? { ...item, content: "已停止生成。", status: "clarify" as const, questions: [] }
          : item
      ),
      notice: { type: "success", message: "已停止 AI 生成。" }
    }));
  }

  // 将 AI 返回的 SOQL 直接应用到编辑器草稿。
  function applyAiSoql(soql: string) {
    patchActiveTab((tab) => ({
      ...tab,
      soqlDraft: soql,
      notice: { type: "success", message: "已将 AI 生成的 SOQL 回填到编辑器。" }
    }));
  }

  // 创建新 Tab 并将 AI 生成的 SOQL 应用到新 Tab。
  function createTabAndApplyAiSoql(soql: string) {
    const nextIndex = tabs.length + 1;
    const nextTab = {
      ...createSoqlExecutorTab(nextIndex),
      soqlDraft: soql,
      aiMode: false // 创建后回到传统编辑模式，便于直接执行与调整。
    };
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
  }

  if (!activeTab) {
    return (
      // 防御分支：理论上不会触发，兜底给出可操作入口。
      <div className="flex h-full items-center justify-center">
        <button className="btn btn-primary btn-sm" onClick={createTab}>
          <Plus size={14} />
          新建 SOQL Tab
        </button>
      </div>
    );
  }

  return (
    // 执行器主容器：顶部标签 + 工具栏 + 编辑器 + 底部结果区。
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Tab 栏：支持切换、关闭与右侧新增。 */}
      <div className="flex items-center border-b border-base-300">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div key={tab.id} className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}>
                <button
                  className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.name}
                </button>
                <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => closeTab(tab.id)} aria-label={`关闭 ${tab.name}`}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <button className="btn btn-ghost btn-sm mx-1" onClick={createTab} aria-label="新建 SOQL Tab">
          <Plus size={14} />
        </button>
      </div>

      {/* 当前标签提示。 */}
      {activeTab.notice && (
        <NoticeAlert
          tone={activeTab.notice.type === "error" ? "error" : "success"}
          message={activeTab.notice.message}
          onClose={() => {
            patchActiveTab((tab) => ({ ...tab, notice: null }));
          }}
          className="absolute right-3 top-12 z-30 max-w-[420px] shadow"
        />
      )}

      {/* 顶部工具栏：左侧执行按钮，右侧 AI 模式开关。 */}
      <div className="border-b border-base-300 px-3 py-2">
        {/* 工具行容器。 */}
        <div className="flex items-center gap-2">
          {/* 左侧执行按钮：仅传统模式可用。 */}
          <button
            className="btn btn-primary btn-sm"
            disabled={activeTab.loading || activeTab.aiMode}
            onMouseDown={(event) => {
              event.preventDefault(); // 阻止按钮按下时抢占焦点，避免 Monaco 选区在点击瞬间丢失。
            }}
            onClick={() => void executeActiveTabSoql()}
          >
            <Play size={14} />
            执行
          </button>
          {/* 中间说明文本。 */}
          <span className="text-[12px] text-neutral/70">
            {activeTab.aiMode ? "AI 模式：通过对话生成 SOQL，可一键新建 Tab 应用。" : "支持复杂 SOQL（含子查询），结果展示在底部。"}
          </span>
          {/* 占位弹性空间，将 AI 模式按钮推到右侧。 */}
          <div className="flex-1" />
          {/* AI 模式切换按钮：切换后隐藏/展示 SOQL 编辑器。 */}
          <button
            className={`btn btn-sm ${activeTab.aiMode ? "btn-primary" : "btn-outline"}`}
            onClick={() => {
              patchActiveTab((tab) => ({ ...tab, aiMode: !tab.aiMode }));
            }}
          >
            <MessageSquare size={14} />
            AI模式
          </button>
        </div>
      </div>

      {/* 主内容区：传统模式显示编辑器，AI 模式显示聊天界面。 */}
      <div ref={splitContainerRef} className="min-h-0 flex flex-1 flex-col overflow-hidden">
        {activeTab.aiMode ? (
          // AI 模式主体：仿聊天布局（消息区 + 输入区）。
          <div className="min-h-0 flex flex-1 flex-col p-3">
            {/* 消息滚动区：使用左右气泡模拟聊天体验。 */}
            <div className="min-h-0 flex-1 overflow-auto rounded border border-base-300 bg-base-100 p-3">
              {activeTab.aiMessages.length === 0 ? (
                <div className="flex h-full items-center justify-center text-[12px] text-neutral/60">
                  请输入你的问题，AI 会先对话，明确后再生成 SOQL。
                </div>
              ) : (
                activeTab.aiMessages.map((item, index) => {
                  const userSide = item.role === "user";
                  return (
                    <div key={item.id} className={`mb-3 flex ${userSide ? "justify-end" : "justify-start"}`}>
                      <div className={`max-w-[78%] rounded-2xl px-3 py-2 text-[12px] ${userSide ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"}`}>
                        <p>{item.content || (item.role === "assistant" ? "..." : "")}</p>
                        {item.status === "clarify" && (item.questions?.length || 0) > 0 && (
                          <div className="mt-2 text-[12px]">
                            {item.questions?.map((question, questionIndex) => (
                              <p key={`${index}-q-${questionIndex}`}>{questionIndex + 1}. {question}</p>
                            ))}
                          </div>
                        )}
                        {item.status === "ready" && item.soql && (
                          <div className="mt-2">
                            <pre className="overflow-auto rounded bg-base-300/40 px-2 py-1 text-[11px]">{item.soql}</pre>
                            <div className="mt-2 flex gap-2">
                              <button className="btn btn-xs btn-outline" onClick={() => applyAiSoql(item.soql || "")}>
                                <WandSparkles size={12} />
                                应用当前Tab
                              </button>
                              <button className="btn btn-xs btn-primary" onClick={() => createTabAndApplyAiSoql(item.soql || "")}>
                                <Plus size={12} />
                                新建Tab并应用
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
            </div>
            {/* 输入区：位于底部，支持连续多轮对话。 */}
            <div className="mt-2 flex items-center gap-2">
              <input
                className="input input-bordered input-sm w-full"
                value={activeTab.aiPromptDraft}
                placeholder="输入问题或明确说“请生成 SOQL”"
                onChange={(event) => {
                  patchActiveTab((tab) => ({ ...tab, aiPromptDraft: event.target.value })); // 同步 AI 对话输入草稿。
                }}
                onKeyDown={(event) => {
                  // 发送快捷键：macOS 使用 Command+Enter，Windows 使用 Alt+Enter。
                  if (event.key !== "Enter") return;
                  const canSend = isMacPlatform ? event.metaKey : event.altKey;
                  if (!canSend) return;
                  event.preventDefault(); // 阻止回车触发表单默认提交或换行行为。
                  if (activeTab.aiLoading) return; // 正在请求时忽略回车，避免重复并发发送。
                  void sendAiPrompt();
                }}
                disabled={activeTab.aiLoading}
              />
              <button className="btn btn-primary btn-sm" disabled={activeTab.aiLoading} onClick={() => void sendAiPrompt()}>
                <WandSparkles size={14} />
                {activeTab.aiLoading ? "发送中" : "发送"}
              </button>
              {activeTab.aiLoading && (
                <button className="btn btn-outline btn-sm" onClick={() => void stopAiStreaming()}>
                  停止
                </button>
              )}
            </div>
          </div>
        ) : (
          <>
            {/* SOQL 编辑器区域：始终占剩余空间，底部面板显示时会随拖拽动态伸缩。 */}
            <div className={activeTab.showBottomPanel ? "min-h-0 flex-1 border-b border-base-300 p-3" : "min-h-0 flex-1 p-3"}>
              {/* SOQL 编辑器：统一复用 Monaco 组件，保持与主工作区一致的编辑体验。 */}
              <SoqlMonacoEditor
                value={activeTab.soqlDraft}
                onChange={(value) => {
                  patchActiveTab((tab) => ({ ...tab, soqlDraft: value })); // 同步当前标签草稿。
                }}
                onSelectionTextChange={(selectionText) => {
                  selectedSoqlTextRef.current = selectionText; // 同步更新 ref，确保“点执行”的同一时刻可读取到最新选区。
                  patchActiveTab((tab) => ({ ...tab, selectedSoqlText: selectionText })); // 同步当前标签选区文本。
                }}
                fieldNames={fallbackFieldNames}
                objectNames={objectNames}
                objectFieldsMap={objectFieldsMap}
                height="100%"
                className="h-full"
              />
            </div>

            {/* 底部结果日志区：默认新建 Tab 不显示，查询成功后显示并支持拖拽高度。 */}
            {activeTab.showBottomPanel && (
              <div className="relative mb-3 flex min-h-0 shrink-0 flex-col border-t border-base-300" style={{ height: bottomPanelHeight }}>
              <div
                className="absolute left-0 right-0 top-0 z-[1] h-[6px] cursor-row-resize"
                onMouseDown={(event) => {
                  event.preventDefault(); // 阻止拖拽起点触发文本选中。
                  dragStartYRef.current = event.clientY; // 记录本次拖拽起点 Y。
                  dragStartHeightRef.current = bottomPanelHeight; // 记录本次拖拽起始高度。
                  setDraggingBottomResize(true); // 进入拖拽状态。
                }}
              />

              {/* 底部结果区头部：切换结果 / 日志。 */}
              <div className="flex items-center gap-1 border-b border-base-300 px-3 py-1.5">
                <button
                  className={`btn btn-xs ${bottomView === "result" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBottomView("result")}
                >
                  <Table2 size={12} />
                  结果
                </button>
                <button
                  className={`btn btn-xs ${bottomView === "logs" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => setBottomView("logs")}
                >
                  日志
                </button>
                <div className="flex-1" />
                <button
                  className="btn btn-circle btn-ghost btn-xs"
                  aria-label="关闭结果日志区域"
                  onClick={() => {
                    patchActiveTab((tab) => ({ ...tab, showBottomPanel: false })); // 关闭当前 Tab 底部结果日志区域。
                  }}
                >
                  <X size={12} />
                </button>
              </div>

              {/* 底部结果内容区。 */}
              <div className="min-h-0 flex-1">
                {bottomView === "result" ? (
                  <DataGrid
                    result={gridResult}
                    visibleColumns={visibleColumns}
                    fieldMetadataMap={fieldMetadataMap}
                    dirtyCellKeys={[]}
                    selectedRecordIds={activeTab.selectedRecordIds}
                    pendingDeleteRecordIds={[]}
                    showHeaderMetadata={false}
                    enableReadonlyCellHint={false}
                    showSelectionColumn={false}
                    onToggleRecord={(recordId, checked) => {
                      patchActiveTab((tab) => ({
                        ...tab,
                        selectedRecordIds: checked
                          ? Array.from(new Set([...tab.selectedRecordIds, recordId]))
                          : tab.selectedRecordIds.filter((id) => id !== recordId)
                      }));
                    }}
                    onToggleAll={(checked, recordIds) => {
                      patchActiveTab((tab) => ({
                        ...tab,
                        selectedRecordIds: checked ? recordIds : []
                      }));
                    }}
                    onEditCell={() => {
                      // 执行器结果表为只读，保持空实现。
                    }}
                    onShowMessage={(message) => {
                      patchActiveTab((tab) => ({
                        ...tab,
                        notice: { type: "error", message }
                      }));
                    }}
                  />
                ) : (
                  <div className="h-full overflow-auto p-3">
                    {activeTab.logs.length === 0 ? (
                      <span className="text-[12px] text-neutral/70">暂无日志。</span>
                    ) : (
                      activeTab.logs.map((log) => (
                        <div key={log.id} className="mb-2 border border-base-300 bg-base-100 p-2">
                          <p className={`mb-1 block text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                            {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                          </p>
                          <p className="block text-[12px]">请求: {log.request}</p>
                          <p className="block text-[12px]">响应: {log.summary}</p>
                          {log.errorMessage && <p className="block text-[12px] text-error">错误: {log.errorMessage}</p>}
                        </div>
                      ))
                    )}
                  </div>
                )}
              </div>
              </div>
            )}
          </>
        )}
      </div>

      {/* 加载遮罩：执行 SOQL 时展示。 */}
      {activeTab.loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/70">
          <span className="loading loading-spinner" style={{ width: 42, height: 42 }} />
          <span className="text-[12px] text-neutral/70">{loadingText}</span>
        </div>
      )}
    </div>
  );
}

// 创建新的 SOQL 执行器标签默认值。
function createSoqlExecutorTab(index: number): SoqlExecutorTab {
  return {
    id: `soql-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `SOQL ${index}`,
    soqlDraft: "",
    selectedSoqlText: "",
    result: { totalSize: 0, records: [] },
    loading: false,
    notice: null,
    logs: [],
    selectedRecordIds: [],
    showBottomPanel: false,
    aiConversationId: "",
    aiPromptDraft: "",
    aiMessages: [],
    aiLoading: false,
    aiMode: false,
    aiStreamRequestId: ""
  };
}

// 构建 SOQL 执行日志条目。
function buildSoqlLog(success: boolean, request: string, summary: string, errorMessage?: string): TabLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action: "SOQL",
    success,
    request,
    summary,
    errorMessage
  };
}

// 将后端 AI 响应映射到当前 Tab：统一写入会话、状态与提示。
function applyAiResponseToTab(
  tab: SoqlExecutorTab,
  response: SoqlConversationResponse,
  streamRequestId: string
): SoqlExecutorTab {
  const message: AiConversationItem =
    response.status === "ready"
      ? {
          id: streamRequestId,
          role: "assistant",
          content: response.answer || response.reason || tab.aiMessages.find((item) => item.id === streamRequestId)?.content || "已生成 SOQL，可选择应用到编辑器。",
          status: "ready",
          soql: response.soql || "",
          questions: []
        }
      : {
          id: streamRequestId,
          role: "assistant",
          content: response.answer || response.reason || tab.aiMessages.find((item) => item.id === streamRequestId)?.content || "当前需求存在模糊点，请补充以下信息。",
          status: "clarify",
          questions: response.questions
        };

  const existed = tab.aiMessages.some((item) => item.id === streamRequestId);
  const nextMessages = existed
    ? tab.aiMessages.map((item) => (item.id === streamRequestId ? { ...item, ...message } : item))
    : [...tab.aiMessages, message];

  return {
    ...tab,
    aiLoading: false,
    aiStreamRequestId: "",
    aiConversationId: response.conversationId || tab.aiConversationId,
    aiMessages: nextMessages,
    notice:
      response.status === "ready"
        ? { type: "success", message: "AI 已生成 SOQL，请确认后应用。" }
        : { type: "success", message: "AI 需要继续澄清，请补充回答。" }
  };
}

// 从 SOQL 中提取所有 FROM 后对象名（包含子查询），用于按需加载字段元数据。
function extractFromObjectNames(soql: string): string[] {
  const objectNames: string[] = [];
  const regex = /\bfrom\s+([A-Za-z_][\w]*)/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(soql)) !== null) {
    objectNames.push(match[1]); // 逐个记录 FROM 目标对象，供后续去重。
  }
  return Array.from(new Set(objectNames));
}

// 抽取可见列：合并所有记录的顶层键，并过滤 Salesforce attributes。
function extractVisibleColumns(records: Record<string, unknown>[]): string[] {
  const columnSet = new Set<string>();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => {
      if (key === "attributes") return;
      columnSet.add(key);
    });
  });
  const allColumns = Array.from(columnSet);
  // 关系字段前缀集合：例如 `Contact.Id` 会生成前缀 `Contact`。
  const relationPrefixSet = new Set(
    allColumns
      .filter((key) => key.includes("."))
      .map((key) => key.split(".")[0])
  );
  return allColumns.filter((key) => {
    // 过滤子查询/关系展开过程中的中间列，避免污染表头。
    if (key.endsWith(".records") || key.endsWith(".totalSize") || key.endsWith(".done")) {
      return false;
    }
    // 若已存在 `Contact.Id` 这类列，则隐藏同名前缀占位列 `Contact`。
    if (!key.includes(".") && relationPrefixSet.has(key)) {
      return false;
    }
    return true;
  });
}

// 主记录展开：主记录 1 行 + 每条子查询记录 1 行。
function expandRecordForGridRows(record: Record<string, unknown>): Record<string, unknown>[] {
  const baseRow: Record<string, unknown> = {};
  const childQueries: Array<{ relationKey: string; records: Record<string, unknown>[] }> = [];

  Object.entries(record).forEach(([key, value]) => {
    if (key === "attributes") return;

    if (isSalesforceChildQueryNode(value)) {
      const childRows = Array.isArray((value as { records?: unknown[] }).records)
        ? ((value as { records: Record<string, unknown>[] }).records || [])
        : [];
      childQueries.push({ relationKey: key, records: childRows });
      return;
    }

    // 展开普通字段和父关系字段（如 xxx__r.Name）。
    flattenNodeToColumns(value, key, baseRow);
  });

  const rows: Record<string, unknown>[] = [];

  childQueries.forEach(({ relationKey, records }) => {
    records.forEach((childRecord, index) => {
      // 近似“合并单元格”效果：仅首行保留主记录字段，其余子行清空主字段。
      const childRow = index === 0 ? { ...baseRow } : ({} as Record<string, unknown>);
      // 子查询字段展开为 `Contacts.Name` 这类点路径列。
      flattenNodeToColumns(childRecord, relationKey, childRow);
      rows.push(childRow);
    });
  });

  // 若存在子查询记录，则仅展示子记录行；若无子记录，则回退展示主记录一行。
  if (rows.length === 0) {
    rows.push(baseRow);
  }

  return rows;
}

// 递归展开节点：例如 `YobuzoTicket__TA_applicant__r.Name` -> 值。
function flattenNodeToColumns(node: unknown, prefix: string, output: Record<string, unknown>) {
  if (node === null || node === undefined) {
    if (prefix) output[prefix] = node;
    return;
  }

  if (typeof node !== "object") {
    if (prefix) output[prefix] = node;
    return;
  }

  if (Array.isArray(node)) {
    if (!prefix) return;
    // 非子查询数组不展开多列，保留 JSON 文本便于查看。
    output[prefix] = JSON.stringify(node);
    return;
  }

  const entries = Object.entries(node as Record<string, unknown>).filter(([key]) => key !== "attributes");
  entries.forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    flattenNodeToColumns(value, nextPrefix, output);
  });
}

// 判断节点是否为 Salesforce 一对多子查询结构（包含 records 数组）。
function isSalesforceChildQueryNode(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return Array.isArray(node.records) && typeof node.totalSize === "number";
}

// 归一化查询结果，避免后端异常格式影响 UI。
function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}

// 日志时间格式化。
function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}

// 生成流式占位文案：避免把原始 JSON 片段直接渲染到聊天气泡。
function nextStreamingPlaceholder(current: string): string {
  const base = "AI 正在生成";
  const suffix = current.startsWith(base) ? current.slice(base.length) : "";
  const dotCount = Math.min(3, (suffix.match(/\./g) || []).length + 1);
  return `${base}${".".repeat(dotCount)}`;
}
