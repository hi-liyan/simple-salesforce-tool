import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2, MessageSquare, Play, Plus, Table2, WandSparkles, X } from "lucide-react";
import { listen } from "@tauri-apps/api/event";
import { DataGrid } from "../../components/DataGrid";
import { NoticeAlert } from "../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../components/SoqlMonacoEditor";
import { api } from "../../api";
import { useSoqlExecutorStore, createSoqlExecutorTab, type SoqlExecutorTab, type AiConversationItem } from "../../store/useSoqlExecutorStore";
import { AiChatTurnV2Response, Notice, ObjectDescribe, QueryResult, SalesforceObject, TabLog } from "../../types";

type AiStreamChunkPayload = {
  // 流式请求 ID。
  requestId: string;
  // 增量文本片段。
  chunk: string;
};

type SoqlExecutorWorkspaceProps = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 一致显示。
  salesforceTimezone?: string | null;
  // 加载遮罩文案。
  loadingText: string;
  // 当前数据源对象列表：用于对象名补全。
  objects: SalesforceObject[];
  // 工作区全局提示：用于显示跨 Tab 的页面级通知（如数据源切换结果）。
  workspaceNotice: Notice | null;
  // 关闭工作区全局提示回调。
  onCloseWorkspaceNotice: () => void;
};

type BottomView = "result" | "logs";

// AI 等待文案池：用于长耗时阶段轮换展示，降低“卡住感”。
const AI_STREAMING_COPY_POOL = [
  "AI 正在玩命思考中",
  "正在翻工具箱找最稳的写法",
  "正在和 Salesforce 元数据对暗号",
  "正在把需求翻译成可执行 SOQL",
  "正在检查字段和关系是否可用",
  "马上就好，正在做最后一轮推理"
];

// SOQL 执行器工作区：支持多 Tab、执行、结果展示与查询日志。
export function SoqlExecutorWorkspace({
  selectedSourceId,
  salesforceTimezone,
  loadingText,
  objects,
  workspaceNotice,
  onCloseWorkspaceNotice
}: SoqlExecutorWorkspaceProps) {
  // SOQL 执行器的多标签状态（通过 Zustand persist 自动持久化到 SQLite）。
  const tabs = useSoqlExecutorStore((state) => state.tabs);
  const setTabs = useSoqlExecutorStore((state) => state.setTabs);
  const activeTabId = useSoqlExecutorStore((state) => state.activeTabId);
  const setActiveTabId = useSoqlExecutorStore((state) => state.setActiveTabId);
  // 底部展示模式：结果 / 日志。
  const [bottomView, setBottomView] = useState<BottomView>("result");
  // 底部结果日志区高度：支持鼠标拖拽调整。
  const [bottomPanelHeight, setBottomPanelHeight] = useState(260);
  // 是否正在拖拽底部区域高度。
  const [draggingBottomResize, setDraggingBottomResize] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(260);
  // Tab 右键菜单状态：记录菜单位置与目标 Tab。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  // 编辑器与底部面板的分栏容器：用于按容器高度约束拖拽范围。
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  // 当前激活编辑器的最新选中文本（同步引用）：避免点击执行时读取到异步状态旧值。
  const selectedSoqlTextRef = useRef("");
  // 对象字段缓存：按需 describe 后用于上下文补全，避免重复请求。
  const [objectFieldsMap, setObjectFieldsMap] = useState<Record<string, string[]>>({});
  // 对象 describe 缓存：用于结果表字段 label/type 映射，保证显示与 Query 页面一致。
  const [objectDescribeMap, setObjectDescribeMap] = useState<Record<string, ObjectDescribe>>({});
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
  // 是否存在任意进行中的 AI 流式任务：用于控制等待文案轮换定时器。
  const hasLoadingAiTask = useMemo(
    () => tabs.some((tab) => tab.aiLoading && Boolean(tab.aiStreamRequestId)),
    [tabs]
  );
  // 平台检测：用于区分 Mac 的 Command 键与 Windows 的 Alt 键发送快捷键。
  const isMacPlatform = useMemo(() => {
    if (typeof navigator === "undefined") return false;
    return /Mac|iPhone|iPad|iPod/i.test(navigator.platform || navigator.userAgent);
  }, []);
  // 发送快捷键提示文案：按平台区分显示。
  const aiSendShortcutHint = isMacPlatform ? "发送快捷键：Command + Enter" : "发送快捷键：Alt + Enter";

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
    if (!tabContextMenu) return;

    const closeMenu = () => {
      setTabContextMenu(null); // 关闭菜单，避免残留浮层。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabContextMenu]);

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
          return advanceStreamingPlaceholderForTab(tab, requestId);
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
    if (!hasLoadingAiTask) return;
    // 定时轮换等待文案：即使后端暂时没有新 chunk，也能持续反馈“AI 正在工作”。
    const timer = window.setInterval(() => {
      setTabs((current) => {
        let changed = false;
        const next = current.map((tab) => {
          if (!tab.aiLoading || !tab.aiStreamRequestId) return tab;
          const nextTab = advanceStreamingPlaceholderForTab(tab, tab.aiStreamRequestId);
          if (nextTab !== tab) changed = true;
          return nextTab;
        });
        return changed ? next : current;
      });
    }, 950);
    return () => {
      window.clearInterval(timer);
    };
  }, [hasLoadingAiTask]);

  useEffect(() => {
    // 切换 Tab 或状态更新时同步 ref，保证执行入口读取到当前激活 Tab 的选区文本。
    selectedSoqlTextRef.current = activeTab?.selectedSoqlText || "";
  }, [activeTab?.id, activeTab?.selectedSoqlText]);

  useEffect(() => {
    setObjectFieldsMap({}); // 切换数据源后清空旧缓存，避免跨源字段污染。
    setObjectDescribeMap({}); // 同步清理 describe 缓存，避免跨源元数据污染。
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
    const loadedObjectNameSet = new Set(Object.keys(objectDescribeMap).map((name) => name.toLowerCase()));
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
            describe
          };
        } catch {
          return null; // describe 失败时忽略，不阻塞其它对象字段加载。
        }
      })
    ).then((describes) => {
      if (cancelled) return;
      const loadedEntries = describes.filter((item): item is { objectName: string; describe: ObjectDescribe } => Boolean(item));
      if (loadedEntries.length === 0) return;
      setObjectFieldsMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.describe.fields.map((field) => field.name); // 写入缓存，供编辑器上下文补全读取。
        });
        return next;
      });
      setObjectDescribeMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.describe; // 写入完整 describe，供结果表字段 label/type 映射。
        });
        return next;
      });
    });

    return () => {
      cancelled = true; // 避免异步返回后写入已失效状态。
    };
  }, [selectedSourceId, activeTab, objectNames, objectDescribeMap]);

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

  // 当前标签字段元数据映射：优先使用 describe 的 label/type，再降级到值推断；执行器模式统一只读。
  const fieldMetadataMap = useMemo(() => {
    const primaryObjectName = extractPrimaryObjectName(activeTab?.soqlDraft || "");
    return visibleColumns.reduce((acc, fieldName) => {
      const resolvedMetadata = resolveFieldMetadataForExecutor(
        fieldName,
        primaryObjectName,
        objectDescribeMap,
        gridResult.records
      );
      acc[fieldName] = {
        ...(resolvedMetadata || {}),
        // 禁止更新：DataGrid 将据此禁用编辑。
        updateable: false,
        // 禁止创建：DataGrid 将据此禁用新建场景编辑。
        createable: false
      };
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [activeTab?.soqlDraft, visibleColumns, objectDescribeMap, gridResult.records]);

  // Store actions：Tab 管理操作委托给 Zustand store。
  const storeCreateTab = useSoqlExecutorStore((state) => state.createTab);
  const storeCloseTab = useSoqlExecutorStore((state) => state.closeTab);
  const storeCloseTabsByIds = useSoqlExecutorStore((state) => state.closeTabsByIds);
  const storePatchTab = useSoqlExecutorStore((state) => state.patchTab);

  // 右键动作：关闭目标 Tab 左侧全部。
  function closeLeftTabs(tabId: string) {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index <= 0) return;
    storeCloseTabsByIds(tabs.slice(0, index).map((tab) => tab.id));
  }

  // 右键动作：关闭目标 Tab 右侧全部。
  function closeRightTabs(tabId: string) {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0 || index >= tabs.length - 1) return;
    storeCloseTabsByIds(tabs.slice(index + 1).map((tab) => tab.id));
  }

  // 右键动作：关闭除目标 Tab 外的其它 Tab。
  function closeOtherTabs(tabId: string) {
    storeCloseTabsByIds(tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  }

  // 右键动作：关闭全部 Tab。
  function closeAllTabs() {
    storeCloseTabsByIds(tabs.map((tab) => tab.id));
  }

  // 更新当前激活标签（复用函数式更新，避免并发状态覆盖）。
  function patchActiveTab(updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) {
    if (!activeTab) return;
    storePatchTab(activeTab.id, updater);
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
        { id: streamRequestId, role: "assistant", content: createInitialStreamingPlaceholder() }
      ]
    }));

    try {
      const response = await api.aiChatTurnV2({
        sourceId: selectedSourceId,
        conversationId: activeTab.aiConversationId || undefined,
        message: prompt,
        streamRequestId,
        uiContext: {
          currentTabSoql: activeTab.soqlDraft || undefined,
          contextObjectHint: contextObjectHint || undefined
        }
      });
      patchActiveTab((tab) => applyAiResponseToTab(tab, response, streamRequestId));
    } catch (error) {
      const errorText = String(error);
      patchActiveTab((tab) => {
        if (tab.aiStreamRequestId !== streamRequestId) return tab;
        return {
          ...tab,
          aiLoading: false,
          aiStreamRequestId: "",
          notice: { type: "error", message: `AI 生成失败：${errorText}` },
          aiMessages: tab.aiMessages.map((item) =>
            item.id === streamRequestId
              ? {
                  ...item,
                  content: `生成失败：${errorText}`,
                  status: "clarify" as const,
                  questions: buildAiErrorQuestions(errorText)
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
      await api.aiStopTurn(requestId);
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
        <button className="btn btn-primary btn-sm" onClick={storeCreateTab}>
          <Plus size={14} />
          新建 SOQL Tab
        </button>
      </div>
    );
  }

  return (
    // 执行器主容器：顶部标签 + 工具栏 + 编辑器 + 底部结果区。
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* 工作区全局提示：显示数据源切换等跨功能通知。 */}
      {workspaceNotice && (
        <NoticeAlert
          tone={workspaceNotice.type === "error" ? "error" : "success"}
          message={workspaceNotice.message}
          onClose={onCloseWorkspaceNotice}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      )}

      {/* Tab 栏：支持切换、关闭与右侧新增。 */}
      <div className="flex items-center border-b border-base-300">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const tabIndex = tabs.findIndex((item) => item.id === tab.id);
            const hasLeftTabs = tabIndex > 0;
            const hasRightTabs = tabIndex >= 0 && tabIndex < tabs.length - 1;
            const hasOtherTabs = tabs.length > 1;
            return (
              <div
                key={tab.id}
                className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
                onContextMenu={(event) => {
                  event.preventDefault(); // 阻止浏览器默认右键菜单。
                  setActiveTabId(tab.id); // 右键时先切换到目标 Tab，避免操作目标不一致。
                  setTabContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); // 打开自定义菜单。
                }}
              >
                <button
                  className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.name}
                </button>
                <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => storeCloseTab(tab.id)} aria-label={`关闭 ${tab.name}`}>
                  <X size={13} />
                </button>
                {/* Tab 右键菜单：提供常见批量关闭操作。 */}
                {tabContextMenu?.tabId === tab.id && (
                  <div
                    className="fixed z-[80] min-w-[132px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
                    style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                    onClick={(event) => event.stopPropagation()}
                  >
                    <button
                      className="btn btn-ghost btn-xs w-full justify-start"
                      onClick={() => {
                        storeCloseTab(tab.id); // 关闭当前 Tab。
                        setTabContextMenu(null); // 执行后关闭菜单。
                      }}
                    >
                      关闭当前
                    </button>
                    <button
                      className="btn btn-ghost btn-xs w-full justify-start"
                      disabled={!hasLeftTabs}
                      onClick={() => {
                        closeLeftTabs(tab.id); // 关闭目标 Tab 左侧所有 Tab。
                        setTabContextMenu(null); // 执行后关闭菜单。
                      }}
                    >
                      关闭左侧
                    </button>
                    <button
                      className="btn btn-ghost btn-xs w-full justify-start"
                      disabled={!hasRightTabs}
                      onClick={() => {
                        closeRightTabs(tab.id); // 关闭目标 Tab 右侧所有 Tab。
                        setTabContextMenu(null); // 执行后关闭菜单。
                      }}
                    >
                      关闭右侧
                    </button>
                    <button
                      className="btn btn-ghost btn-xs w-full justify-start"
                      disabled={!hasOtherTabs}
                      onClick={() => {
                        closeOtherTabs(tab.id); // 仅保留目标 Tab，关闭其它 Tab。
                        setTabContextMenu(null); // 执行后关闭菜单。
                      }}
                    >
                      关闭其他
                    </button>
                    <button
                      className="btn btn-ghost btn-xs w-full justify-start"
                      disabled={tabs.length === 0}
                      onClick={() => {
                        closeAllTabs(); // 关闭全部 Tab。
                        setTabContextMenu(null); // 执行后关闭菜单。
                      }}
                    >
                      全部关闭
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
        <button className="btn btn-ghost btn-sm mx-1" onClick={storeCreateTab} aria-label="新建 SOQL Tab">
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
                  // 等待态判定：仅对当前流式请求的 assistant 气泡展示动效与增强文案。
                  const assistantThinking = !userSide && activeTab.aiLoading && item.id === activeTab.aiStreamRequestId;
                  return (
                    <div key={item.id} className={`mb-3 flex ${userSide ? "justify-end" : "justify-start"}`}>
                      <div
                        className={`max-w-[78%] rounded-2xl px-3 py-2 text-[12px] ${userSide ? "bg-primary text-primary-content" : "bg-base-200 text-base-content"} ${assistantThinking ? "border border-primary/30 bg-primary/5 shadow-sm" : ""}`}
                      >
                        {/* 等待态正文：用旋转图标和脉冲文案强化“AI 正在工作”。 */}
                        <p className={assistantThinking ? "flex items-center gap-2 motion-safe:animate-pulse" : ""}>
                          {assistantThinking && (
                            // 等待态图标：旋转动效用于反馈系统存活。
                            <span className="inline-flex h-4 w-4 items-center justify-center rounded-full bg-primary/15 text-primary">
                              <Loader2 size={11} className="animate-spin" />
                            </span>
                          )}
                          <span>{item.content || (item.role === "assistant" ? "..." : "")}</span>
                        </p>
                        {assistantThinking && (
                          // 等待态辅助提示：告诉用户可主动停止本轮请求。
                          <p className="mt-1 text-[11px] text-neutral/70">AI 正在持续推理中，可点击右侧“停止”结束本轮。</p>
                        )}
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
            <div className="mt-2">
              {/* 输入与操作按钮行。 */}
              <div className="flex items-end gap-2">
                {/* 多行输入框：支持自然换行与多段描述输入。 */}
                <textarea
                  className="textarea textarea-bordered textarea-sm w-full min-h-[84px] max-h-40 resize-y leading-5"
                  value={activeTab.aiPromptDraft}
                  placeholder="输入问题或明确说“请生成 SOQL”"
                  rows={3}
                  wrap="soft"
                  onChange={(event) => {
                    patchActiveTab((tab) => ({ ...tab, aiPromptDraft: event.target.value })); // 同步 AI 对话输入草稿。
                  }}
                  onKeyDown={(event) => {
                    // 发送快捷键：macOS 使用 Command+Enter，Windows 使用 Alt+Enter。
                    if (event.key !== "Enter") return;
                    const canSend = isMacPlatform ? event.metaKey : event.altKey;
                    if (!canSend) return;
                    event.preventDefault(); // 触发发送快捷键时阻止 textarea 默认插入换行。
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
              {/* 快捷键提示：根据当前平台展示对应组合键。 */}
              <p className="mt-1 text-right text-[11px] text-neutral/60">{aiSendShortcutHint}</p>
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
                    salesforceTimezone={salesforceTimezone}
                    pendingDeleteRecordIds={[]}
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

// 根据错误内容生成更准确的引导问题，避免把网络问题误导成配置问题。
function buildAiErrorQuestions(errorText: string): string[] {
  const normalized = errorText.toLowerCase();
  if (
    normalized.includes("超时") ||
    normalized.includes("timeout") ||
    normalized.includes("timed out")
  ) {
    return [
      "本次更像是 LLM 请求超时，请先缩小查询范围（明确对象与字段）后重试。",
      "你也可以到设置页适当增大 timeoutMs，或检查代理/网关响应速度。"
    ];
  }
  if (
    normalized.includes("apikey 未配置") ||
    normalized.includes("llm apikey 未配置") ||
    normalized.includes("401") ||
    normalized.includes("认证失败")
  ) {
    return ["请确认 LLM 设置（baseUrl、model、apiKey）是否已正确保存。"];
  }
  if (
    normalized.includes("读取 openai 流式响应失败") ||
    normalized.includes("error decoding response body") ||
    normalized.includes("connection reset") ||
    normalized.includes("响应解码失败")
  ) {
    return [
      "当前更像是网络或网关响应体传输异常，请重试一次。",
      "若频繁出现，请检查代理/网关是否有响应压缩、截断或连接重置问题。"
    ];
  }
  if (
    normalized.includes("状态码 429") ||
    normalized.includes("too many requests")
  ) {
    return ["LLM 网关触发限流（429），请稍后重试或降低并发请求。"];
  }
  if (
    normalized.includes("状态码 5") ||
    normalized.includes("server error")
  ) {
    return ["LLM 网关返回服务端异常（5xx），建议稍后重试并检查网关健康状态。"];
  }
  if (
    normalized.includes("未返回有效 json") ||
    normalized.includes("返回 json 解析失败") ||
    normalized.includes("不是合法 json")
  ) {
    return [
      "模型本轮返回内容格式异常（非约定 JSON），请重试一次。",
      "若频繁出现，请更换更稳定的模型，或检查网关是否改写了响应内容。"
    ];
  }
  if (
    normalized.includes("重复请求相同工具参数") ||
    normalized.includes("避免卡死已终止")
  ) {
    return [
      "AI 本轮陷入重复工具调用，系统已自动中止以避免长时间卡住。",
      "请在需求中明确对象 API 名、字段 API 名或过滤条件后再重试。"
    ];
  }
  return ["请补充你的查询目标对象和字段，我会继续协助生成 SOQL。"];
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
  response: AiChatTurnV2Response,
  streamRequestId: string
): SoqlExecutorTab {
  const isReady = response.state === "ready" && Boolean(response.proposedSoql);
  const message: AiConversationItem =
    isReady
      ? {
          id: streamRequestId,
          role: "assistant",
          content: response.assistantMessage || tab.aiMessages.find((item) => item.id === streamRequestId)?.content || "已生成 SOQL，可选择应用到编辑器。",
          status: "ready",
          soql: response.proposedSoql || "",
          questions: []
        }
      : {
          id: streamRequestId,
          role: "assistant",
          content: response.assistantMessage || tab.aiMessages.find((item) => item.id === streamRequestId)?.content || "当前需求存在模糊点，请补充以下信息。",
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
      isReady
        ? { type: "success", message: "AI 已生成 SOQL，请确认后应用。" }
        : { type: "success", message: "AI 需要继续澄清，请补充回答。" }
  };
}

// 提取主查询对象：用于优先匹配字段 label/type。
function extractPrimaryObjectName(soql: string): string {
  const objectNames = extractFromObjectNames(soql);
  return objectNames[0] || "";
}

// 执行器字段 metadata 解析：优先 describe，其次按结果样本推断类型。
function resolveFieldMetadataForExecutor(
  fieldName: string,
  primaryObjectName: string,
  objectDescribeMap: Record<string, ObjectDescribe>,
  records: Record<string, unknown>[]
): Record<string, unknown> | null {
  const exactField = resolveObjectFieldMetadataByName(fieldName, primaryObjectName, objectDescribeMap);
  if (exactField) {
    return {
      label: exactField.label,
      type: exactField.dataType
    };
  }

  // 对点路径列（如 Owner.Name）回退取末段字段名做弱匹配。
  if (fieldName.includes(".")) {
    const suffixFieldName = fieldName.split(".").pop() || "";
    const suffixField = resolveObjectFieldMetadataByName(suffixFieldName, primaryObjectName, objectDescribeMap);
    if (suffixField) {
      return {
        label: suffixField.label,
        type: suffixField.dataType
      };
    }
  }

  // describe 未命中时回退为值推断，确保 datetime/date 在结果表仍可按规则展示。
  const inferredType = inferFieldTypeFromRecords(fieldName, records);
  if (!inferredType) return null;
  return { type: inferredType };
}

// 按字段名从 describe 缓存中解析字段定义（先主对象，再全量兜底）。
function resolveObjectFieldMetadataByName(
  fieldName: string,
  primaryObjectName: string,
  objectDescribeMap: Record<string, ObjectDescribe>
): ObjectDescribe["fields"][number] | null {
  const normalizedFieldName = fieldName.trim().toLowerCase();
  if (!normalizedFieldName) return null;

  const primaryDescribe = primaryObjectName ? objectDescribeMap[primaryObjectName] : undefined;
  if (primaryDescribe) {
    const matched = primaryDescribe.fields.find((field) => field.name.toLowerCase() === normalizedFieldName);
    if (matched) return matched;
  }

  // 主对象未命中时在已缓存对象中找唯一字段，避免错误映射同名字段。
  let uniqueMatched: ObjectDescribe["fields"][number] | null = null;
  let matchedCount = 0;
  Object.values(objectDescribeMap).forEach((describe) => {
    const matched = describe.fields.find((field) => field.name.toLowerCase() === normalizedFieldName);
    if (!matched) return;
    matchedCount += 1;
    uniqueMatched = matched;
  });
  if (matchedCount > 1) return null; // 多对象同名字段时放弃自动映射，避免误导。
  return uniqueMatched;
}

// 基于结果样本推断字段类型：用于 describe 缺失时的展示兜底。
function inferFieldTypeFromRecords(fieldName: string, records: Record<string, unknown>[]): string | null {
  const samples = records
    .map((record) => record[fieldName])
    .filter((value) => value !== null && value !== undefined)
    .slice(0, 20);
  if (samples.length === 0) return null;

  const allBoolean = samples.every((value) => typeof value === "boolean");
  if (allBoolean) return "boolean";

  const allNumber = samples.every((value) => typeof value === "number");
  if (allNumber) return "double";

  const allDate = samples.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()));
  if (allDate) return "date";

  const allDatetime = samples.every((value) => {
    if (typeof value !== "string") return false;
    const text = value.trim();
    if (!text) return false;
    // Salesforce 常见 datetime：2026-03-02T18:30:00.000+0000 / ISO 8601。
    return /^(\d{4}-\d{2}-\d{2})T/.test(text);
  });
  if (allDatetime) return "datetime";

  return null;
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

// 创建流式等待初始文案：统一从文案池第一项启动。
function createInitialStreamingPlaceholder(): string {
  return `${AI_STREAMING_COPY_POOL[0]}.`;
}

// 推进指定请求的等待文案：仅更新对应 assistant 气泡文本。
function advanceStreamingPlaceholderForTab(tab: SoqlExecutorTab, requestId: string): SoqlExecutorTab {
  let changed = false;
  const nextMessages = tab.aiMessages.map((item) => {
    if (item.id !== requestId || item.role !== "assistant") return item;
    changed = true;
    return { ...item, content: nextStreamingPlaceholder(item.content) };
  });
  return changed ? { ...tab, aiMessages: nextMessages } : tab;
}

// 生成流式占位文案：轮换有趣文案并追加点动画，避免“卡住感”。
function nextStreamingPlaceholder(current: string): string {
  const currentIndex = AI_STREAMING_COPY_POOL.findIndex((copy) => current.startsWith(copy));
  const dotMatch = current.match(/(\.+)$/);
  const currentDotCount = Math.min(3, dotMatch ? dotMatch[1].length : 0);
  const nextDotCount = currentDotCount >= 3 ? 1 : Math.max(1, currentDotCount + 1);
  const nextIndex =
    currentIndex < 0
      ? 0
      : currentDotCount >= 3
        ? (currentIndex + 1) % AI_STREAMING_COPY_POOL.length
        : currentIndex;
  return `${AI_STREAMING_COPY_POOL[nextIndex]}${".".repeat(nextDotCount)}`;
}
