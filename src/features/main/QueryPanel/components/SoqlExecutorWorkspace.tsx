import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, Table2, X } from "lucide-react";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import { DataGrid } from "../../../../components/DataGrid";
import { NoticeAlert } from "../../../../components/NoticeAlert";
import { CodeMirrorQueryEditor } from "../../../../components/codemirror/CodeMirrorQueryEditor";
import { formatBasicSql, splitSqlStatementsWithRanges } from "../../../../components/codemirror/sqlCompletion";
import { api } from "../../../../api";
import { getDataSourceDriver } from "../../../../drivers/registry";
import { useObjectsQuery } from "../../../../queries/salesforce";
import { useSoqlExecutorStore, type SoqlExecutorTab } from "../../../../store/useSoqlExecutorStore";
import type { Notice, ObjectDescribe, QueryResult, SalesforceObject, SalesforceSource } from "../../../../types";
import { resolveMysqlConsoleVisibleColumns } from "../logic/mysqlConsoleColumnOrder.ts";
import { getSourceColor } from "../logic/sourceColor.ts";
import {
  buildSoqlLog,
  expandRecordForGridRows,
  extractFromObjectNames,
  extractPrimaryObjectName,
  extractVisibleColumns,
  formatLogTime,
  isSchemaChangingDdl,
  normalizeQueryResult,
  resolveFieldMetadataForExecutor
} from "../logic/consoleQueryUtils.ts";
import { ConsoleToolbar } from "./ConsoleToolbar";

type SoqlExecutorWorkspaceProps = {
  // 全部可用数据源列表：供控制台右侧数据源选择器绑定与切换。
  sources?: SalesforceSource[];
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型。
  selectedSourceType?: string;
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 一致显示。
  salesforceTimezone?: string | null;
  // 加载遮罩文案。
  loadingText: string;
  // 当前数据源对象列表：用于对象名补全。
  objects: SalesforceObject[];
  // 工作区全局提示。
  workspaceNotice: Notice | null;
  // 关闭工作区全局提示回调。
  onCloseWorkspaceNotice: () => void;
  // 是否隐藏内置 Tab 栏：用于统一工作区模式下由外层渲染混合 Tab。
  hideTabBar?: boolean;
  // 强制绑定到指定 console Tab：用于“每个工作区 Tab 独立实例常驻挂载”场景。
  forcedTabId?: string;
  // DDL 语句执行成功回调：通知外层触发数据源元数据刷新。
  onDdlExecuted?: (sourceId: string) => void;
};

type BottomView = "result" | "logs";

// 空实现保留导出以兼容旧引用，后续可移除。
export function SoqlExecutorGlobalEffects() {
  return null;
}

// 查询控制台工作区：紧凑操作 Bar + 右侧数据源绑定 + Gutter 按条执行 + 底部多结果集展示。
export function SoqlExecutorWorkspace({
  sources = [],
  selectedSourceId,
  selectedSourceType,
  salesforceTimezone,
  loadingText,
  objects,
  workspaceNotice,
  onCloseWorkspaceNotice,
  hideTabBar = false,
  forcedTabId,
  onDdlExecuted
}: SoqlExecutorWorkspaceProps) {
  const tabs = useSoqlExecutorStore((state) => state.tabs);
  const setTabs = useSoqlExecutorStore((state) => state.setTabs);
  const activeTabId = useSoqlExecutorStore((state) => state.activeTabId);
  const setActiveTabId = useSoqlExecutorStore((state) => state.setActiveTabId);
  const storeCreateTab = useSoqlExecutorStore((state) => state.createTab);
  const storeCloseTab = useSoqlExecutorStore((state) => state.closeTab);
  const storeCloseTabsByIds = useSoqlExecutorStore((state) => state.closeTabsByIds);
  const storePatchTab = useSoqlExecutorStore((state) => state.patchTab);

  // 当前实例的目标 Tab：forcedTabId 存在时以其为准。
  const effectiveActiveTabId = forcedTabId || activeTabId;
  // 底部展示模式：结果 / 日志。
  const [bottomView, setBottomView] = useState<BottomView>("result");
  // 底部结果日志区高度：支持鼠标拖拽调整。
  const [bottomPanelHeight, setBottomPanelHeight] = useState(260);
  // 是否正在拖拽底部区域高度。
  const [draggingBottomResize, setDraggingBottomResize] = useState(false);
  // 自动换行开关状态。
  const [wordWrapEnabled, setWordWrapEnabled] = useState(true);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(260);
  // Tab 右键菜单状态。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  // 编辑器与底部面板的分栏容器。
  const splitContainerRef = useRef<HTMLDivElement | null>(null);
  // 当前激活编辑器的最新选中文本（同步引用）。
  const selectedSoqlTextRef = useRef("");
  // 当前进行中查询 ID（用于慢查询中断）。
  const activeQueryIdRef = useRef<string | null>(null);
  // 多语句执行结果集列表。
  const [multiResultSets, setMultiResultSets] = useState<
    Array<{ statementIndex: number; sql: string; result?: QueryResult; error?: string; durationMs: number }>
  >([]);
  // 当前激活的多结果集下标。
  const [activeResultSetIndex, setActiveResultSetIndex] = useState(0);
  // 对象字段缓存：按需 describe 后用于上下文补全。
  const [objectFieldsMap, setObjectFieldsMap] = useState<Record<string, string[]>>({});
  // 对象 describe 缓存：用于结果表字段 label/type 映射。
  const [objectDescribeMap, setObjectDescribeMap] = useState<Record<string, ObjectDescribe>>({});

  // 当前激活标签数据。
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === effectiveActiveTabId) || null,
    [tabs, effectiveActiveTabId]
  );

  // 当前控制台实际绑定的数据源 ID 与类型。
  const effectiveSourceId = activeTab?.sourceId || selectedSourceId;
  const effectiveSource = useMemo(
    () => sources.find((item) => item.id === effectiveSourceId) || null,
    [sources, effectiveSourceId]
  );
  const effectiveSourceType = activeTab?.sourceType || effectiveSource?.sourceType || selectedSourceType || "salesforce";
  // 通过统一驱动注册表获取能力，禁止硬编码数据源分支。
  const driver = useMemo(() => getDataSourceDriver(effectiveSourceType), [effectiveSourceType]);
  const queryLanguage = driver.capabilities.queryLanguage;
  const queryLanguageLabel = queryLanguage === "soql" ? "SOQL" : "SQL";
  const preserveRawColumns = driver.capabilities.supportsDdl;

  // 当前控制台数据源对象列表。
  const { data: effectiveSourceObjects = [] } = useObjectsQuery(effectiveSourceId);
  const objectNames = useMemo(
    () => (effectiveSourceId ? effectiveSourceObjects : objects).filter((item) => item.queryable).map((item) => item.name),
    [effectiveSourceId, effectiveSourceObjects, objects]
  );
  const fallbackFieldNames = useMemo(
    () => Array.from(new Set(Object.values(objectFieldsMap).flatMap((fields) => fields))),
    [objectFieldsMap]
  );

  // 自动关闭当前标签提示。
  useEffect(() => {
    if (!activeTab?.notice) return;
    const timer = window.setTimeout(() => {
      setTabs((current) =>
        current.map((tab) => (tab.id === activeTab.id ? { ...tab, notice: null } : tab))
      );
    }, 3200);
    return () => window.clearTimeout(timer);
  }, [activeTab?.id, activeTab?.notice, setTabs]);

  // 关闭 Tab 右键菜单监听。
  useEffect(() => {
    if (!tabContextMenu) return;
    const closeMenu = () => setTabContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
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

  // 同步当前激活 Tab 的选区文本引用。
  useEffect(() => {
    selectedSoqlTextRef.current = activeTab?.selectedSoqlText || "";
  }, [activeTab?.id, activeTab?.selectedSoqlText]);

  // 切换数据源后清空旧元数据缓存，避免跨源污染。
  useEffect(() => {
    setObjectFieldsMap({});
    setObjectDescribeMap({});
  }, [effectiveSourceId]);

  // 底部面板高度拖拽逻辑。
  useEffect(() => {
    if (!draggingBottomResize) return;
    const onMouseMove = (event: MouseEvent) => {
      const delta = dragStartYRef.current - event.clientY;
      const next = dragStartHeightRef.current + delta;
      const containerHeight = splitContainerRef.current?.clientHeight || 0;
      const minTopHeight = 160;
      const minBottomHeight = 160;
      const maxBottomHeight = Math.max(minBottomHeight, containerHeight - minTopHeight);
      setBottomPanelHeight(Math.max(minBottomHeight, Math.min(maxBottomHeight, next)));
    };
    const onMouseUp = () => setDraggingBottomResize(false);
    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingBottomResize]);

  // 根据编辑器内 FROM 目标对象按需懒加载字段元数据，供补全与结果表使用。
  useEffect(() => {
    if (!effectiveSourceId || !activeTab) return;
    const fromObjectNames = extractFromObjectNames(activeTab.soqlDraft);
    if (fromObjectNames.length === 0) return;

    const queryableObjectNameSet = new Set(objectNames.map((name) => name.toLowerCase()));
    const loadedObjectNameSet = new Set(Object.keys(objectDescribeMap).map((name) => name.toLowerCase()));
    const unloadedObjectNames = fromObjectNames.filter((objectName) => {
      if (!queryableObjectNameSet.has(objectName.toLowerCase())) return false;
      return !loadedObjectNameSet.has(objectName.toLowerCase());
    });
    if (unloadedObjectNames.length === 0) return;

    let cancelled = false;
    void Promise.all(
      unloadedObjectNames.map(async (objectName) => {
        try {
          const describe = await api.describeObject(effectiveSourceId, objectName);
          return { objectName, describe };
        } catch {
          return null;
        }
      })
    ).then((describes) => {
      if (cancelled) return;
      const loadedEntries = describes.filter(
        (item): item is { objectName: string; describe: ObjectDescribe } => Boolean(item)
      );
      if (loadedEntries.length === 0) return;
      setObjectFieldsMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.describe.fields.map((field) => field.name);
        });
        return next;
      });
      setObjectDescribeMap((current) => {
        const next = { ...current };
        loadedEntries.forEach((item) => {
          next[item.objectName] = item.describe;
        });
        return next;
      });
    });

    return () => {
      cancelled = true;
    };
  }, [effectiveSourceId, activeTab, objectNames, objectDescribeMap]);

  // 结果表数据：按驱动特性决定是否展开嵌套子查询行。
  const gridResult = useMemo<QueryResult>(() => {
    if (!activeTab) return { totalSize: 0, records: [] };
    if (preserveRawColumns) {
      return normalizeQueryResult(activeTab.result);
    }
    return {
      totalSize: activeTab.result.totalSize,
      records: activeTab.result.records.flatMap((record) => expandRecordForGridRows(record))
    };
  }, [activeTab, preserveRawColumns]);

  // 当前标签可见列。
  const visibleColumns = useMemo(() => {
    if (!activeTab) return [];
    if (preserveRawColumns) {
      const latestSuccessfulQueryText =
        activeTab.logs.find((item) => item.action === "SOQL" && item.success)?.request || activeTab.soqlDraft;
      const primaryObjectName = extractPrimaryObjectName(latestSuccessfulQueryText);
      return resolveMysqlConsoleVisibleColumns({
        queryText: latestSuccessfulQueryText,
        describe: primaryObjectName ? objectDescribeMap[primaryObjectName] : null,
        records: gridResult.records
      });
    }
    return extractVisibleColumns(gridResult.records, false);
  }, [activeTab, gridResult.records, preserveRawColumns, objectDescribeMap]);

  // 当前标签字段元数据映射。
  const fieldMetadataMap = useMemo(() => {
    const primaryObjectName = extractPrimaryObjectName(activeTab?.soqlDraft || "");
    return visibleColumns.reduce((acc, fieldName) => {
      const resolvedMetadata = resolveFieldMetadataForExecutor(
        fieldName,
        primaryObjectName,
        objectDescribeMap,
        gridResult.records
      );
      acc[fieldName] = resolvedMetadata || {};
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [activeTab?.soqlDraft, visibleColumns, objectDescribeMap, gridResult.records]);

  function patchActiveTab(updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) {
    if (!activeTab) return;
    storePatchTab(activeTab.id, updater);
  }

  // 切换当前控制台 Tab 绑定的数据源。
  function handleChangeTabSource(nextSourceId: string) {
    if (!activeTab || !nextSourceId) return;
    const nextSource = sources.find((item) => item.id === nextSourceId);
    if (!nextSource) return;
    patchActiveTab((tab) => ({
      ...tab,
      sourceId: nextSource.id,
      sourceType: String(nextSource.sourceType || "salesforce"),
      sourceName: nextSource.name,
      sourceColor: getSourceColor(nextSource),
      notice: { type: "success", message: `已绑定数据源：${nextSource.name}` }
    }));
  }

  // 中断当前正在执行的慢查询。
  async function stopActiveQuery() {
    const queryId = activeQueryIdRef.current;
    if (!queryId) return;
    try {
      await api.cancelQuery(queryId);
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: "已请求中断当前查询。" }
      }));
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: `中断查询失败：${String(error)}` }
      }));
    } finally {
      activeQueryIdRef.current = null;
    }
  }

  // 执行单条 SQL/SOQL 语句（支持 Gutter 单条点击、EXPLAIN 与安全网关确认）。
  async function executeSingleStatement(rawSql: string, options?: { explain?: boolean }) {
    if (!activeTab) return;
    if (!effectiveSourceId) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请在右上角选择并绑定数据源后再执行。" }
      }));
      return;
    }

    const trimmedSql = rawSql.trim();
    if (!trimmedSql) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: `${queryLanguageLabel} 不能为空。` }
      }));
      return;
    }

    const executeSoql = options?.explain ? `EXPLAIN ${trimmedSql.replace(/;+$/, "")}` : trimmedSql;
    const queryId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeQueryIdRef.current = queryId;
    patchActiveTab((tab) => ({ ...tab, loading: true, notice: null }));

    try {
      const primaryObjectName = extractPrimaryObjectName(executeSoql);
      setMultiResultSets([]);
      setActiveResultSetIndex(0);

      let guarded = await api.executeGuardedQuery(
        effectiveSourceId,
        executeSoql,
        primaryObjectName || undefined,
        false,
        queryId
      );
      if (guarded.status === "confirmation_required") {
        const reason = String(guarded.guardDecision?.reason || "检测到高危 SQL 操作，是否继续执行？");
        const confirmed = window.confirm(`${reason}\n\n待执行语句：\n${executeSoql}`);
        if (!confirmed) {
          patchActiveTab((tab) => ({
            ...tab,
            loading: false,
            notice: { type: "error", message: "已取消执行高危语句。" }
          }));
          return;
        }
        guarded = await api.executeGuardedQuery(
          effectiveSourceId,
          executeSoql,
          primaryObjectName || undefined,
          true,
          queryId
        );
      }

      const normalizedResult = normalizeQueryResult(guarded.result || { totalSize: 0, records: [] });
      const actualExecutedSql = guarded.executedSql || executeSoql;

      patchActiveTab((tab) => ({
        ...tab,
        result: normalizedResult,
        loading: false,
        selectedRecordIds: [],
        showBottomPanel: true,
        notice: { type: "success", message: `执行成功（${guarded.durationMs}ms），返回 ${normalizedResult.totalSize} 条。` },
        logs: [
          buildSoqlLog(true, actualExecutedSql, `执行成功（${guarded.durationMs}ms），返回 ${normalizedResult.totalSize} 条。`),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("result");

      // 若执行的是会改变表结构的 DDL 语句，自动触发数据源元数据刷新。
      if (!options?.explain && isSchemaChangingDdl(executeSoql)) {
        onDdlExecuted?.(effectiveSourceId);
      }
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `执行失败：${String(error)}` },
        logs: [
          buildSoqlLog(false, executeSoql, `执行 ${queryLanguageLabel} 失败。`, String(error)),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("logs");
    } finally {
      activeQueryIdRef.current = null;
    }
  }

  // 执行当前/选中语句（有选区执行选区；无选区且存在多条语句时默认执行第一条或全量，支持多语句）。
  async function executeCurrentOrSelected(options?: { explain?: boolean }) {
    if (!activeTab) return;
    const selectedText = selectedSoqlTextRef.current.trim() || activeTab.selectedSoqlText.trim();
    if (selectedText) {
      const statements = splitSqlStatementsWithRanges(selectedText);
      if (statements.length > 1 && driver.capabilities.supportsMultiStatement && !options?.explain) {
        await executeBatchStatements(selectedText);
        return;
      }
      await executeSingleStatement(selectedText, options);
      return;
    }

    const statements = splitSqlStatementsWithRanges(activeTab.soqlDraft);
    if (statements.length === 0) {
      await executeSingleStatement("", options);
      return;
    }
    if (statements.length === 1 || options?.explain || !driver.capabilities.supportsMultiStatement) {
      await executeSingleStatement(statements[0].sql, options);
      return;
    }
    await executeBatchStatements(activeTab.soqlDraft);
  }

  // 批量执行全部语句并渲染多结果集 Tab。
  async function executeBatchStatements(sqlBatch: string) {
    if (!activeTab) return;
    if (!effectiveSourceId) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请在右上角选择并绑定数据源后再执行。" }
      }));
      return;
    }

    const statements = splitSqlStatementsWithRanges(sqlBatch);
    if (statements.length === 0) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: `${queryLanguageLabel} 不能为空。` }
      }));
      return;
    }
    if (statements.length === 1 || !driver.capabilities.supportsMultiStatement) {
      await executeSingleStatement(statements[0].sql);
      return;
    }

    const queryId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    activeQueryIdRef.current = queryId;
    patchActiveTab((tab) => ({ ...tab, loading: true, notice: null }));

    try {
      const rawItems = await api.executeMultiStatementQuery(effectiveSourceId, sqlBatch, false);
      const items = rawItems.map((entry) => ({
        statementIndex: entry.index,
        sql: entry.sql,
        result: entry.response?.result || undefined,
        error: entry.error || undefined,
        durationMs: entry.response?.durationMs ?? 0
      }));
      setMultiResultSets(items);
      setActiveResultSetIndex(0);
      const firstValid = items.find((item) => item.result)?.result || { totalSize: 0, records: [] };
      const normalizedResult = normalizeQueryResult(firstValid);
      const totalDuration = items.reduce((acc, item) => acc + item.durationMs, 0);
      const errorCount = items.filter((item) => Boolean(item.error)).length;

      patchActiveTab((tab) => ({
        ...tab,
        result: normalizedResult,
        loading: false,
        selectedRecordIds: [],
        showBottomPanel: true,
        notice: {
          type: errorCount > 0 ? "error" : "success",
          message: `多语句执行完成（共 ${items.length} 条，失败 ${errorCount} 条，耗时 ${totalDuration}ms）。`
        },
        logs: [
          buildSoqlLog(errorCount === 0, sqlBatch, `多语句执行 ${items.length} 条，耗时 ${totalDuration}ms。`),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("result");

      if (items.some((item) => !item.error && isSchemaChangingDdl(item.sql))) {
        onDdlExecuted?.(effectiveSourceId);
      }
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `批量执行失败：${String(error)}` },
        logs: [
          buildSoqlLog(false, sqlBatch, `批量执行 ${queryLanguageLabel} 失败。`, String(error)),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("logs");
    } finally {
      activeQueryIdRef.current = null;
    }
  }

  // 右键关闭 Tabs 辅助方法。
  function closeLeftTabs(tabId: string) {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index <= 0) return;
    storeCloseTabsByIds(tabs.slice(0, index).map((tab) => tab.id));
  }

  function closeRightTabs(tabId: string) {
    const index = tabs.findIndex((tab) => tab.id === tabId);
    if (index < 0 || index >= tabs.length - 1) return;
    storeCloseTabsByIds(tabs.slice(index + 1).map((tab) => tab.id));
  }

  function closeOtherTabs(tabId: string) {
    storeCloseTabsByIds(tabs.filter((tab) => tab.id !== tabId).map((tab) => tab.id));
  }

  function closeAllTabs() {
    storeCloseTabsByIds(tabs.map((tab) => tab.id));
  }

  if (!activeTab) {
    return (
      <div className="flex h-full items-center justify-center text-[12px] text-neutral/70">
        暂无 {queryLanguageLabel} 标签，请先打开或新建一个查询控制台。
      </div>
    );
  }

  return (
    <div className="relative flex h-full w-full flex-col overflow-hidden bg-base-100">
      {/* 工作区全局提示：用于显示数据源切换/刷新通知。 */}
      {workspaceNotice && (
        <NoticeAlert
          tone={workspaceNotice.type === "error" ? "error" : "success"}
          message={workspaceNotice.message}
          onClose={onCloseWorkspaceNotice}
          className="fixed bottom-4 right-4 z-50 max-w-[420px] shadow-lg"
        />
      )}

      {/* 独立模式下显示控制台内置 Tab 栏。 */}
      {!hideTabBar && (
        <div className="flex items-center border-b border-base-300 bg-base-200/70 pr-2">
          <div className="flex min-w-0 flex-1 items-center overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              const tabIndex = tabs.findIndex((item) => item.id === tab.id);
              return (
                <div
                  key={tab.id}
                  className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setActiveTabId(tab.id);
                    setTabContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
                  }}
                >
                  <button
                    className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {tab.name}
                  </button>
                  <button
                    className="btn btn-circle btn-ghost btn-xs mr-1"
                    onClick={() => storeCloseTab(tab.id)}
                    aria-label={`关闭 ${tab.name}`}
                  >
                    <X size={13} />
                  </button>
                  {tabContextMenu?.tabId === tab.id && (
                    <ContextMenu
                      x={tabContextMenu.x}
                      y={tabContextMenu.y}
                      minWidthClassName="min-w-[132px]"
                      entries={[
                        {
                          id: "close-current",
                          label: "关闭当前",
                          onClick: () => {
                            storeCloseTab(tab.id);
                            setTabContextMenu(null);
                          }
                        },
                        {
                          id: "close-left",
                          label: "关闭左侧",
                          disabled: tabIndex <= 0,
                          onClick: () => {
                            closeLeftTabs(tab.id);
                            setTabContextMenu(null);
                          }
                        },
                        {
                          id: "close-right",
                          label: "关闭右侧",
                          disabled: tabIndex < 0 || tabIndex >= tabs.length - 1,
                          onClick: () => {
                            closeRightTabs(tab.id);
                            setTabContextMenu(null);
                          }
                        },
                        {
                          id: "close-other",
                          label: "关闭其他",
                          disabled: tabs.length <= 1,
                          onClick: () => {
                            closeOtherTabs(tab.id);
                            setTabContextMenu(null);
                          }
                        },
                        {
                          id: "close-all",
                          label: "全部关闭",
                          disabled: tabs.length === 0,
                          onClick: () => {
                            closeAllTabs();
                            setTabContextMenu(null);
                          }
                        }
                      ] satisfies ContextMenuEntry[]}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <button
            className="btn btn-ghost btn-sm mx-1"
            onClick={() =>
              storeCreateTab(
                effectiveSource
                  ? {
                      sourceId: effectiveSource.id,
                      sourceType: String(effectiveSource.sourceType || "salesforce"),
                      sourceName: effectiveSource.name,
                      sourceColor: getSourceColor(effectiveSource)
                    }
                  : {}
              )
            }
            aria-label={`新建 ${queryLanguageLabel} Tab`}
          >
            <Plus size={14} />
          </button>
        </div>
      )}

      {/* 当前标签提示。 */}
      {activeTab.notice && (
        <NoticeAlert
          tone={activeTab.notice.type === "error" ? "error" : "success"}
          message={activeTab.notice.message}
          onClose={() => patchActiveTab((tab) => ({ ...tab, notice: null }))}
          className="absolute right-3 top-11 z-30 max-w-[420px] shadow"
        />
      )}

      {/* 顶部紧凑操作 Bar（DBX 风格：小 Icon 按钮组 + 右侧数据源选择器）。 */}
      <ConsoleToolbar
        loading={activeTab.loading}
        hasContent={Boolean(activeTab.soqlDraft.trim())}
        supportsMultiStatement={driver.capabilities.supportsMultiStatement}
        supportsExplain={driver.capabilities.supportsExplain}
        queryLanguageLabel={queryLanguageLabel}
        wordWrapEnabled={wordWrapEnabled}
        sources={sources}
        selectedSourceId={effectiveSourceId}
        onExecuteCurrent={() => void executeCurrentOrSelected()}
        onExecuteAll={() => void executeBatchStatements(activeTab.soqlDraft)}
        onStopQuery={() => void stopActiveQuery()}
        onExplain={() => void executeCurrentOrSelected({ explain: true })}
        onFormat={() => {
          const formatted = formatBasicSql(activeTab.soqlDraft);
          if (formatted) {
            patchActiveTab((tab) => ({ ...tab, soqlDraft: formatted }));
          }
        }}
        onToggleWordWrap={() => setWordWrapEnabled((prev) => !prev)}
        onClear={() => {
          patchActiveTab((tab) => ({ ...tab, soqlDraft: "", selectedSoqlText: "" }));
        }}
        onChangeSource={handleChangeTabSource}
      />

      {/* 主内容区：SQL/SOQL 编辑器（含左侧 Gutter 按条执行按钮）+ 底部结果/日志区。 */}
      <div ref={splitContainerRef} className="min-h-0 flex flex-1 flex-col overflow-hidden">
        <div className={activeTab.showBottomPanel ? "min-h-0 flex-1 border-b border-base-300" : "min-h-0 flex-1"}>
          <CodeMirrorQueryEditor
            language={queryLanguage}
            value={activeTab.soqlDraft}
            onChange={(value) => {
              patchActiveTab((tab) => ({ ...tab, soqlDraft: value }));
            }}
            onSelectionTextChange={(selectionText) => {
              selectedSoqlTextRef.current = selectionText;
              patchActiveTab((tab) => ({ ...tab, selectedSoqlText: selectionText }));
            }}
            onExecuteStatement={(sql) => {
              void executeSingleStatement(sql);
            }}
            onExecuteCurrent={() => {
              void executeCurrentOrSelected();
            }}
            onExecuteAll={() => {
              void executeBatchStatements(activeTab.soqlDraft);
            }}
            fieldNames={fallbackFieldNames}
            objectNames={objectNames}
            objectFieldsMap={objectFieldsMap}
            wordWrapMode={wordWrapEnabled ? "on" : "off"}
            placeholder={`输入 ${queryLanguageLabel}，点击行首 ▶ 可按条执行，或按 Ctrl/Cmd + Enter 执行`}
            height="100%"
            className="h-full rounded-none border-0"
          />
        </div>

        {/* 底部结果日志区：支持拖拽高度、多结果集切换与日志查看。 */}
        {activeTab.showBottomPanel && (
          <div className="relative flex min-h-0 shrink-0 flex-col border-t border-base-300" style={{ height: bottomPanelHeight }}>
            <div
              className="absolute left-0 right-0 top-0 z-[1] h-[6px] cursor-row-resize"
              onMouseDown={(event) => {
                event.preventDefault();
                dragStartYRef.current = event.clientY;
                dragStartHeightRef.current = bottomPanelHeight;
                setDraggingBottomResize(true);
              }}
            />

            {/* 底部结果区头部。 */}
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
              {multiResultSets.length > 1 && (
                <div className="ml-2 flex items-center gap-1 overflow-x-auto">
                  {multiResultSets.map((item, idx) => (
                    <button
                      key={item.statementIndex}
                      className={`btn btn-xs ${activeResultSetIndex === idx ? "btn-secondary" : "btn-ghost"}`}
                      onClick={() => {
                        setActiveResultSetIndex(idx);
                        setBottomView("result");
                        if (item.result) {
                          patchActiveTab((tab) => ({
                            ...tab,
                            result: normalizeQueryResult(item.result!)
                          }));
                        }
                      }}
                    >
                      结果 {item.statementIndex + 1}
                      {item.error ? " (失败)" : ""}
                    </button>
                  ))}
                </div>
              )}
              <div className="flex-1" />
              <button
                className="btn btn-circle btn-ghost btn-xs"
                aria-label="关闭结果日志区域"
                onClick={() => patchActiveTab((tab) => ({ ...tab, showBottomPanel: false }))}
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
                  readOnlyMode={true}
                  dirtyCellKeys={[]}
                  selectedRecordIds={activeTab.selectedRecordIds}
                  salesforceTimezone={salesforceTimezone}
                  selectedSourceType={effectiveSourceType}
                  preserveColumnOrder={preserveRawColumns}
                  pendingDeleteRecordIds={[]}
                  enableReadonlyCellHint={false}
                  allowReadonlyOverlay={true}
                  scrollStateKey={`console:${activeTab.id}`}
                  onToggleAll={(checked, recordIds) => {
                    patchActiveTab((tab) => ({
                      ...tab,
                      selectedRecordIds: checked ? recordIds : []
                    }));
                  }}
                  onEditCell={() => {
                    // 执行器结果表为只读。
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
                      <div key={log.id} className="mb-2 rounded border border-base-300 bg-base-100 p-2">
                        <p className={`mb-1 block text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                          {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                        </p>
                        <p className="block font-mono text-[12px]">请求: {log.request}</p>
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
      </div>

      {/* 加载遮罩：执行 SQL/SOQL 时展示。 */}
      {activeTab.loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/70">
          <span className="loading loading-spinner" style={{ width: 42, height: 42 }} />
          <span className="text-[12px] text-neutral/70">{loadingText}</span>
        </div>
      )}
    </div>
  );
}
