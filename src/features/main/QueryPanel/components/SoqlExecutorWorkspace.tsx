import { useEffect, useMemo, useRef, useState } from "react";
import { Plus, RotateCcw, Save, Sparkles, Table2, Trash2, X } from "lucide-react";
import { useAiStore } from "../../../../store/useAiStore";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import { DataGrid } from "../../../../components/DataGrid";
import { NoticeAlert } from "../../../../components/NoticeAlert";
import { CodeMirrorQueryEditor, type StatementExecutionStatus } from "../../../../components/codemirror/CodeMirrorQueryEditor";
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
import { ConsoleToolbar, type ConsoleTransactionMode } from "./ConsoleToolbar";
import { ConsoleDiffBoard } from "./ConsoleDiffBoard";
import { ConsoleMutationPreviewModal } from "./ConsoleMutationPreviewModal";
import {
  normalizeSqlFingerprint,
  type ConsoleDiffBaseline,
  type ConsoleResultBlock
} from "../logic/consoleDiffEngine.ts";
import {
  applyConsoleCellEdit,
  buildConsoleBaselineMap,
  buildConsoleMutationPayload,
  resolveConsoleResultEditability,
  toggleConsoleDeleteRows,
  type ConsoleBlockEditDraft
} from "../logic/consoleResultEdit.ts";
import type { MutationPreviewSqlItem, RecordUpdatePayload } from "../../../../types";

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
  loadingText: _loadingText,
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
  // 选中文本同步到 Store 的节流定时器：避免拖拽选区时每像素触发 React 重渲染。
  const selectionSyncTimerRef = useRef<number | null>(null);
  // 当前进行中查询 ID（用于慢查询中断）。
  const activeQueryIdRef = useRef<string | null>(null);
  // 批量顺序执行中断标记：用户点击停止执行时终止后续语句队列。
  const batchCancelledRef = useRef(false);
  // 编辑器内每条语句的执行状态映射（用于行首 Gutter 展示 loading / 对勾 / 红叉）。
  const [statementStatuses, setStatementStatuses] = useState<Record<number, StatementExecutionStatus>>({});
  // 多语句执行结果集列表。
  const [multiResultSets, setMultiResultSets] = useState<ConsoleResultBlock[]>([]);
  // 当前激活的多结果集下标。
  const [activeResultSetIndex, setActiveResultSetIndex] = useState(0);
  // 查询 Diff 控制台基线快照（仅存内存，不持久化）。
  const [diffBaseline, setDiffBaseline] = useState<ConsoleDiffBaseline | null>(null);
  // 按语句下标隔离的控制台结果编辑草稿。
  const [draftsByStatement, setDraftsByStatement] = useState<Record<number, ConsoleBlockEditDraft>>({});
  // 按语句下标隔离的选中行 ID 列表。
  const [selectedRowIdsByStatement, setSelectedRowIdsByStatement] = useState<Record<number, string[]>>({});
  // 控制台两阶段提交 SQL 预览弹窗状态。
  const [mutationPreview, setMutationPreview] = useState<{
    open: boolean;
    statementIndex: number;
    sourceTable: string;
    loading: boolean;
    error: string;
    planId?: string;
    planHash?: string;
    items: MutationPreviewSqlItem[];
    payload: {
      creates: Record<string, unknown>[];
      updates: RecordUpdatePayload[];
      deletes: string[];
    };
  }>({
    open: false,
    statementIndex: 0,
    sourceTable: "",
    loading: false,
    error: "",
    items: [],
    payload: { creates: [], updates: [], deletes: [] }
  });
  // 对象字段缓存：按需 describe 后用于上下文补全。
  const [objectFieldsMap, setObjectFieldsMap] = useState<Record<string, string[]>>({});
  // 对象 describe 缓存：用于结果表字段 label/type 映射。
  const [objectDescribeMap, setObjectDescribeMap] = useState<Record<string, ObjectDescribe>>({});
  // 当前控制台会话事务状态（仅支持交互式事务的驱动生效）。
  const [txStatus, setTxStatus] = useState<{
    mode: ConsoleTransactionMode;
    inTransaction: boolean;
    uncommittedSqls: string[];
  }>({ mode: "auto", inTransaction: false, uncommittedSqls: [] });
  // 事务提交/回滚/模式切换进行中。
  const [txBusy, setTxBusy] = useState(false);

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

  // 切换控制台 Tab 或数据源时同步拉取会话事务状态。
  async function refreshTransactionStatus(targetSourceId = effectiveSourceId, targetTabId = activeTab?.id || "") {
    if (!driver.capabilities.supportsInteractiveTransaction || !targetSourceId || !targetTabId) {
      setTxStatus({ mode: "auto", inTransaction: false, uncommittedSqls: [] });
      return;
    }
    try {
      const status = await api.getConsoleTransactionStatus(targetSourceId, targetTabId);
      setTxStatus({
        mode: status.mode,
        inTransaction: status.inTransaction,
        uncommittedSqls: status.uncommittedSqls || []
      });
    } catch {
      // 忽略状态读取异常，保持当前 UI 可用。
    }
  }

  useEffect(() => {
    void refreshTransactionStatus(effectiveSourceId, activeTab?.id || "");
  }, [activeTab?.id, driver.capabilities.supportsInteractiveTransaction, effectiveSourceId]);

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
        activeTab.logs.find((item) => (item.action === "SOQL" || item.action === "SQL") && item.success)?.request || activeTab.soqlDraft;
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
        gridResult.records,
        gridResult.columnTypes
      );
      acc[fieldName] = resolvedMetadata || {};
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [activeTab?.soqlDraft, visibleColumns, objectDescribeMap, gridResult.records, gridResult.columnTypes]);

  function patchActiveTab(updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) {
    if (!activeTab) return;
    storePatchTab(activeTab.id, updater);
  }

  // 切换当前控制台 Tab 绑定的数据源。
  function handleChangeTabSource(nextSourceId: string) {
    if (!activeTab || !nextSourceId || nextSourceId === effectiveSourceId) return;
    if (txStatus.inTransaction) {
      const confirmed = window.confirm("当前控制台存在未提交事务，切换数据源将自动回滚未提交变更。是否继续？");
      if (!confirmed) return;
      void api.closeConsoleSession(activeTab.id).catch(() => {});
    }
    const nextSource = sources.find((item) => item.id === nextSourceId);
    if (!nextSource) return;
    setStatementStatuses({});
    patchActiveTab((tab) => ({
      ...tab,
      sourceId: nextSource.id,
      sourceType: String(nextSource.sourceType || "salesforce"),
      sourceName: nextSource.name,
      sourceColor: getSourceColor(nextSource)
    }));
  }

  // 切换当前控制台会话的事务模式。
  async function handleChangeTransactionMode(nextMode: ConsoleTransactionMode) {
    if (!activeTab || !effectiveSourceId) return;
    setTxBusy(true);
    try {
      const status = await api.setConsoleTransactionMode(effectiveSourceId, activeTab.id, nextMode);
      setTxStatus({
        mode: status.mode,
        inTransaction: status.inTransaction,
        uncommittedSqls: status.uncommittedSqls || []
      });
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: String(error) }
      }));
    } finally {
      setTxBusy(false);
    }
  }

  // 提交当前控制台会话挂起事务。
  async function handleCommitTransaction() {
    if (!activeTab || !effectiveSourceId) return;
    setTxBusy(true);
    try {
      const status = await api.commitConsoleTransaction(effectiveSourceId, activeTab.id);
      setTxStatus({
        mode: status.mode,
        inTransaction: status.inTransaction,
        uncommittedSqls: status.uncommittedSqls || []
      });
      patchActiveTab((tab) => ({
        ...tab,
        showBottomPanel: true,
        notice: { type: "success", message: "事务已提交 (COMMIT)。" },
        logs: [buildSoqlLog(true, "COMMIT;", "手动事务已提交。", undefined, queryLanguageLabel), ...tab.logs].slice(0, 200)
      }));
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        showBottomPanel: true,
        notice: { type: "error", message: `提交事务失败：${String(error)}` },
        logs: [buildSoqlLog(false, "COMMIT;", "提交事务失败。", String(error), queryLanguageLabel), ...tab.logs].slice(0, 200)
      }));
    } finally {
      setTxBusy(false);
    }
  }

  // 回滚当前控制台会话挂起事务。
  async function handleRollbackTransaction() {
    if (!activeTab || !effectiveSourceId) return;
    setTxBusy(true);
    try {
      const status = await api.rollbackConsoleTransaction(effectiveSourceId, activeTab.id);
      setTxStatus({
        mode: status.mode,
        inTransaction: status.inTransaction,
        uncommittedSqls: status.uncommittedSqls || []
      });
      patchActiveTab((tab) => ({
        ...tab,
        showBottomPanel: true,
        notice: { type: "success", message: "事务已回滚 (ROLLBACK)。" },
        logs: [buildSoqlLog(true, "ROLLBACK;", "手动事务已回滚。", undefined, queryLanguageLabel), ...tab.logs].slice(0, 200)
      }));
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        showBottomPanel: true,
        notice: { type: "error", message: `回滚事务失败：${String(error)}` },
        logs: [buildSoqlLog(false, "ROLLBACK;", "回滚事务失败。", String(error), queryLanguageLabel), ...tab.logs].slice(0, 200)
      }));
    } finally {
      setTxBusy(false);
    }
  }

  // 中断当前正在执行的慢查询，并终止后续批量语句队列。
  async function stopActiveQuery() {
    batchCancelledRef.current = true;
    const queryId = activeQueryIdRef.current;
    if (!queryId) return;
    try {
      await api.cancelQuery(queryId);
      setStatementStatuses((prev) => {
        const next = { ...prev };
        for (const [key, value] of Object.entries(next)) {
          if (value === "running") {
            next[Number(key)] = "error";
          }
        }
        return next;
      });
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
      void refreshTransactionStatus();
    }
  }

  // 执行单条 SQL/SOQL 语句（支持 Gutter 单条点击、EXPLAIN 与安全网关确认）。
  async function executeSingleStatement(rawSql: string, options?: { explain?: boolean }, statementIndex?: number) {
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
    if (statementIndex !== undefined) {
      setStatementStatuses({ [statementIndex]: "running" });
    } else {
      setStatementStatuses({});
    }
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
        queryId,
        activeTab.id
      );
      if (guarded.status === "confirmation_required") {
        const reason = String(guarded.guardDecision?.reason || "检测到高危 SQL 操作，是否继续执行？");
        const confirmed = window.confirm(`${reason}\n\n待执行语句：\n${executeSoql}`);
        if (!confirmed) {
          if (statementIndex !== undefined) {
            setStatementStatuses({ [statementIndex]: "idle" });
          }
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
          queryId,
          activeTab.id
        );
      }

      const normalizedResult = normalizeQueryResult(guarded.result || { totalSize: 0, records: [] });
      const actualExecutedSql = guarded.executedSql || executeSoql;
      const stmtIdx = statementIndex ?? 0;
      const nextBlock: ConsoleResultBlock = {
        statementIndex: stmtIdx,
        sql: actualExecutedSql,
        sqlFingerprint: normalizeSqlFingerprint(actualExecutedSql),
        result: normalizedResult,
        durationMs: guarded.durationMs
      };
      setMultiResultSets([nextBlock]);
      setActiveResultSetIndex(0);
      resetBlockEditDraft(stmtIdx, actualExecutedSql, normalizedResult);

      if (statementIndex !== undefined) {
        setStatementStatuses({ [statementIndex]: "success" });
      }
      patchActiveTab((tab) => ({
        ...tab,
        result: normalizedResult,
        loading: false,
        selectedRecordIds: [],
        showBottomPanel: true,
        notice: null,
        logs: [
          buildSoqlLog(true, actualExecutedSql, `执行成功（${guarded.durationMs}ms），返回 ${normalizedResult.totalSize} 条。`, undefined, queryLanguageLabel),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("result");

      // 若执行的是会改变表结构的 DDL 语句，自动触发数据源元数据刷新。
      if (!options?.explain && isSchemaChangingDdl(executeSoql)) {
        onDdlExecuted?.(effectiveSourceId);
      }
    } catch (error) {
      if (statementIndex !== undefined) {
        setStatementStatuses({ [statementIndex]: "error" });
      }
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        showBottomPanel: true,
        notice: null,
        logs: [
          buildSoqlLog(false, executeSoql, `执行 ${queryLanguageLabel} 失败。`, String(error), queryLanguageLabel),
          ...tab.logs
        ].slice(0, 200)
      }));
      setBottomView("logs");
    } finally {
      activeQueryIdRef.current = null;
      void refreshTransactionStatus();
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
      await executeSingleStatement(statements[0].sql, options, statements[0].index);
      return;
    }
    await executeBatchStatements(activeTab.soqlDraft);
  }

  // 逐条顺序执行全部语句：实时更新每条语句行首状态，遇错即停并保留已执行结果。
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
      await executeSingleStatement(statements[0].sql, undefined, statements[0].index);
      return;
    }

    batchCancelledRef.current = false;
    setStatementStatuses({});
    setMultiResultSets([]);
    setDraftsByStatement({});
    setSelectedRowIdsByStatement({});
    setActiveResultSetIndex(0);
    patchActiveTab((tab) => ({ ...tab, loading: true, notice: null, showBottomPanel: true }));

    const collectedItems: ConsoleResultBlock[] = [];
    let hasSchemaDdl = false;

    try {
      for (const stmt of statements) {
        if (batchCancelledRef.current) break;

        const queryId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        activeQueryIdRef.current = queryId;
        // 行内注释：标记当前正在执行的语句，行首 Gutter 显示 loading。
        setStatementStatuses((prev) => ({ ...prev, [stmt.index]: "running" }));

        try {
          const primaryObjectName = extractPrimaryObjectName(stmt.sql);
          let guarded = await api.executeGuardedQuery(
            effectiveSourceId,
            stmt.sql,
            primaryObjectName || undefined,
            false,
            queryId,
            activeTab.id
          );

          if (guarded.status === "confirmation_required") {
            const reason = String(guarded.guardDecision?.reason || "检测到高危 SQL 操作，是否继续执行？");
            const confirmed = window.confirm(`${reason}\n\n待执行语句：\n${stmt.sql}`);
            if (!confirmed) {
              setStatementStatuses((prev) => ({ ...prev, [stmt.index]: "idle" }));
              patchActiveTab((tab) => ({
                ...tab,
                notice: { type: "error", message: `已取消执行第 ${stmt.index + 1} 条高危语句，后续语句已中止。` }
              }));
              break;
            }
            guarded = await api.executeGuardedQuery(
              effectiveSourceId,
              stmt.sql,
              primaryObjectName || undefined,
              true,
              queryId,
              activeTab.id
            );
          }

          const normalizedResult = normalizeQueryResult(guarded.result || { totalSize: 0, records: [] });
          const actualExecutedSql = guarded.executedSql || stmt.sql;
          collectedItems.push({
            statementIndex: stmt.index,
            sql: actualExecutedSql,
            sqlFingerprint: normalizeSqlFingerprint(actualExecutedSql),
            result: normalizedResult,
            durationMs: guarded.durationMs
          });
          resetBlockEditDraft(stmt.index, actualExecutedSql, normalizedResult);

          // 行内注释：当前语句执行成功，标记绿色对勾并增量更新结果集。
          setStatementStatuses((prev) => ({ ...prev, [stmt.index]: "success" }));
          setMultiResultSets([...collectedItems]);
          setActiveResultSetIndex(collectedItems.length - 1);
          setBottomView("result");

          patchActiveTab((tab) => ({
            ...tab,
            result: normalizedResult,
            selectedRecordIds: [],
            showBottomPanel: true,
            logs: [
              buildSoqlLog(
                true,
                actualExecutedSql,
                `第 ${stmt.index + 1} 条执行成功（${guarded.durationMs}ms），返回 ${normalizedResult.totalSize} 条。`,
                undefined,
                queryLanguageLabel
              ),
              ...tab.logs
            ].slice(0, 200)
          }));

          if (isSchemaChangingDdl(stmt.sql)) {
            hasSchemaDdl = true;
          }
        } catch (error) {
          const errMsg = String(error);
          collectedItems.push({
            statementIndex: stmt.index,
            sql: stmt.sql,
            sqlFingerprint: normalizeSqlFingerprint(stmt.sql),
            error: errMsg,
            durationMs: 0
          });

          // 行内注释：当前语句执行失败，标记红叉并立即终止后续语句执行。
          setStatementStatuses((prev) => ({ ...prev, [stmt.index]: "error" }));
          setMultiResultSets([...collectedItems]);
          setBottomView("logs");

          patchActiveTab((tab) => ({
            ...tab,
            showBottomPanel: true,
            logs: [
              buildSoqlLog(
                false,
                stmt.sql,
                `第 ${stmt.index + 1} 条执行失败，已停止后续语句。`,
                errMsg,
                queryLanguageLabel
              ),
              ...tab.logs
            ].slice(0, 200)
          }));
          break;
        }
      }

      if (hasSchemaDdl) {
        onDdlExecuted?.(effectiveSourceId);
      }
    } finally {
      activeQueryIdRef.current = null;
      patchActiveTab((tab) => ({ ...tab, loading: false }));
      void refreshTransactionStatus();
    }
  }

  // 重置指定结果块的编辑草稿与选中状态。
  function resetBlockEditDraft(statementIndex: number, sql: string, result: QueryResult) {
    const editability = resolveConsoleResultEditability(sql, result, objectDescribeMap, driver.gridAdapter);
    const baselineRecords = buildConsoleBaselineMap(
      result.records,
      editability.primaryKeyField,
      driver.gridAdapter
    );
    setDraftsByStatement((prev) => ({
      ...prev,
      [statementIndex]: {
        baselineRecords,
        dirtyCellKeys: [],
        pendingDeleteRecordIds: [],
        records: result.records
      }
    }));
    setSelectedRowIdsByStatement((prev) => ({ ...prev, [statementIndex]: [] }));
  }

  // 处理控制台结果表格单元格编辑：写入对应结果块草稿。
  function handleBlockCellEdit(statementIndex: number, rowIndex: number, columnName: string, value: unknown) {
    const block = multiResultSets.find((item) => item.statementIndex === statementIndex);
    const targetResult = block?.result || activeTab?.result;
    if (!targetResult) return;
    const sql = block?.sql || activeTab?.soqlDraft || "";
    const editability = resolveConsoleResultEditability(sql, targetResult, objectDescribeMap, driver.gridAdapter);
    if (!editability.editable) return;

    setDraftsByStatement((prev) => {
      const currentDraft: ConsoleBlockEditDraft = prev[statementIndex] || {
        baselineRecords: buildConsoleBaselineMap(
          targetResult.records,
          editability.primaryKeyField,
          driver.gridAdapter
        ),
        dirtyCellKeys: [],
        pendingDeleteRecordIds: [],
        records: targetResult.records
      };
      return {
        ...prev,
        [statementIndex]: applyConsoleCellEdit(
          currentDraft,
          rowIndex,
          columnName,
          value,
          editability.primaryKeyField,
          driver.gridAdapter
        )
      };
    });
  }

  // 切换指定结果块的行选中状态。
  function handleBlockToggleRows(statementIndex: number, checked: boolean, recordIds: string[]) {
    setSelectedRowIdsByStatement((prev) => ({
      ...prev,
      [statementIndex]: checked ? recordIds : []
    }));
    if (activeTab?.consoleMode !== "diff") {
      patchActiveTab((tab) => ({
        ...tab,
        selectedRecordIds: checked ? recordIds : []
      }));
    }
  }

  // 标记或取消标记选中行为待删除。
  function handleBlockToggleDelete(statementIndex: number) {
    const selectedIds = selectedRowIdsByStatement[statementIndex] || [];
    if (selectedIds.length === 0) return;
    setDraftsByStatement((prev) => {
      const currentDraft = prev[statementIndex];
      if (!currentDraft) return prev;
      return {
        ...prev,
        [statementIndex]: toggleConsoleDeleteRows(currentDraft, selectedIds)
      };
    });
  }

  // 放弃指定结果块的未保存修改。
  function handleDiscardBlockChanges(statementIndex: number) {
    const block = multiResultSets.find((item) => item.statementIndex === statementIndex);
    const targetResult = block?.result || activeTab?.result;
    if (!targetResult) return;
    resetBlockEditDraft(statementIndex, block?.sql || activeTab?.soqlDraft || "", targetResult);
  }

  // 保存指定结果块的控制台修改：支持两阶段预览提交与直提交。
  async function handleSaveBlockChanges(statementIndex: number) {
    if (!activeTab || !effectiveSourceId) return;
    const block = multiResultSets.find((item) => item.statementIndex === statementIndex);
    const targetResult = block?.result || activeTab.result;
    const sql = block?.sql || activeTab.soqlDraft;
    const editability = resolveConsoleResultEditability(sql, targetResult, objectDescribeMap, driver.gridAdapter);
    if (!editability.editable || !editability.sourceTable) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: editability.readonlyReason || "当前结果集不可编辑。" }
      }));
      return;
    }

    const draft = draftsByStatement[statementIndex];
    if (!draft) return;
    const payload = buildConsoleMutationPayload(draft, editability.primaryKeyField, driver.gridAdapter);
    if (payload.creates.length === 0 && payload.updates.length === 0 && payload.deletes.length === 0) {
      return;
    }

    if (driver.capabilities.supportsMutationPreview) {
      setMutationPreview({
        open: true,
        statementIndex,
        sourceTable: editability.sourceTable,
        loading: true,
        error: "",
        items: [],
        payload
      });
      try {
        const prepared = await api.prepareMutationPlan({
          sourceId: effectiveSourceId,
          objectName: editability.sourceTable,
          creates: payload.creates,
          updates: payload.updates,
          deletes: payload.deletes
        });
        setMutationPreview((prev) => ({
          ...prev,
          loading: false,
          planId: prepared.planId,
          planHash: prepared.planHash,
          items: prepared.previewItems
        }));
      } catch (error) {
        setMutationPreview((prev) => ({
          ...prev,
          loading: false,
          error: `生成预览 SQL 失败：${String(error)}`
        }));
      }
      return;
    }

    // 行内注释：不支持两阶段预览的驱动（如 Salesforce），直接调用统一保存接口。
    try {
      await api.saveRecordsWithDeletes({
        sourceId: effectiveSourceId,
        objectName: editability.sourceTable,
        creates: payload.creates,
        updates: payload.updates,
        deletes: payload.deletes
      });
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "success", message: "控制台修改已保存，正在刷新结果..." }
      }));
      await executeCurrentOrSelected();
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: `保存失败：${String(error)}` }
      }));
    }
  }

  // 确认执行两阶段预览计划并刷新结果集。
  async function handleConfirmMutationPreview() {
    if (!activeTab || !mutationPreview.planId || !mutationPreview.planHash) return;
    setMutationPreview((prev) => ({ ...prev, loading: true, error: "" }));
    try {
      const result = await api.commitMutationPlan(mutationPreview.planId, mutationPreview.planHash);
      const failedItems = result.items.filter((item) => !item.success);
      if (failedItems.length > 0) {
        const firstErr = failedItems[0]?.error || "部分记录提交失败";
        setMutationPreview((prev) => ({ ...prev, loading: false, error: firstErr }));
        return;
      }
      const totalCommitted = result.createCount + result.updateCount + result.deleteCount;
      setMutationPreview({
        open: false,
        statementIndex: 0,
        sourceTable: "",
        loading: false,
        error: "",
        items: [],
        payload: { creates: [], updates: [], deletes: [] }
      });
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "success", message: `成功提交 ${totalCommitted} 条控制台变更，正在刷新...` }
      }));
      await executeCurrentOrSelected();
    } catch (error) {
      setMutationPreview((prev) => ({
        ...prev,
        loading: false,
        error: `提交变更失败：${String(error)}`
      }));
    }
  }

  // 将当前多结果集固定为 Diff 对比基线快照。
  function handlePinDiffBaseline() {
    if (multiResultSets.length === 0) return;
    setDiffBaseline({
      capturedAt: new Date().toISOString(),
      blocks: multiResultSets
        .filter((item) => !item.error && item.result)
        .map((item) => ({
          statementIndex: item.statementIndex,
          sqlFingerprint: item.sqlFingerprint,
          sourceTable: item.result?.resultMeta?.sourceTable,
          primaryKeyFields: item.result?.resultMeta?.primaryKeyFields || [],
          records: (item.result?.records || []).map((rec) => ({ ...rec }))
        }))
    });
    patchActiveTab((tab) => ({
      ...tab,
      notice: { type: "success", message: "已将当前多表结果锁定为对比基线。" }
    }));
  }

  // 清除 Diff 对比基线快照。
  function handleClearDiffBaseline() {
    setDiffBaseline(null);
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
      {/* 独立模式下显示控制台内置 Tab 栏。 */}
      {!hideTabBar && (
        <div className="flex items-center border-b border-base-300/70 bg-base-100 px-1.5 py-1">
          <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.id === activeTabId;
              const tabIndex = tabs.findIndex((item) => item.id === tab.id);
              return (
                <div
                  key={tab.id}
                  className={`group flex h-[28px] shrink-0 items-center gap-1 rounded-md border px-2 transition-colors ${
                    active
                      ? "border-primary/40 bg-primary/10 font-medium text-primary"
                      : "border-transparent bg-transparent text-neutral/75 hover:bg-base-200/80 hover:text-neutral"
                  }`}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setActiveTabId(tab.id);
                    setTabContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
                  }}
                >
                  <button
                    className={`min-w-0 max-w-[240px] truncate py-0.5 text-[12px] ${active ? "text-primary" : "text-inherit"}`}
                    onClick={() => setActiveTabId(tab.id)}
                  >
                    {tab.name}
                  </button>
                  <button
                    className={`flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral/55 transition-opacity hover:bg-base-300/60 hover:text-neutral ${
                      active ? "opacity-100" : "opacity-0 group-hover:opacity-100"
                    }`}
                    onClick={() => storeCloseTab(tab.id)}
                    aria-label={`关闭 ${tab.name}`}
                  >
                    <X size={12} />
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

      {/* 顶部紧凑操作 Bar（DBX 风格：小 Icon 按钮组 + 右侧数据源选择器）。 */}
      <ConsoleToolbar
        loading={activeTab.loading}
        hasContent={Boolean(activeTab.soqlDraft.trim())}
        supportsMultiStatement={driver.capabilities.supportsMultiStatement}
        supportsExplain={driver.capabilities.supportsExplain}
        supportsInteractiveTransaction={driver.capabilities.supportsInteractiveTransaction}
        transactionMode={txStatus.mode}
        inTransaction={txStatus.inTransaction}
        uncommittedSqls={txStatus.uncommittedSqls}
        transactionBusy={txBusy}
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
            setStatementStatuses({});
            patchActiveTab((tab) => ({ ...tab, soqlDraft: formatted }));
          }
        }}
        onToggleWordWrap={() => setWordWrapEnabled((prev) => !prev)}
        onClear={() => {
          setStatementStatuses({});
          patchActiveTab((tab) => ({ ...tab, soqlDraft: "", selectedSoqlText: "" }));
        }}
        onChangeSource={handleChangeTabSource}
        onChangeTransactionMode={(mode) => void handleChangeTransactionMode(mode)}
        onCommitTransaction={() => void handleCommitTransaction()}
        onRollbackTransaction={() => void handleRollbackTransaction()}
      />

      {/* 主内容区：SQL/SOQL 编辑器（含左侧 Gutter 按条执行按钮）+ 底部结果/日志区。 */}
      <div ref={splitContainerRef} className="min-h-0 flex flex-1 flex-col overflow-hidden">
        <div className={activeTab.showBottomPanel ? "min-h-0 flex-1 border-b border-base-300" : "min-h-0 flex-1"}>
          <CodeMirrorQueryEditor
            language={queryLanguage}
            value={activeTab.soqlDraft}
            onChange={(value) => {
              setStatementStatuses({});
              patchActiveTab((tab) => ({ ...tab, soqlDraft: value }));
            }}
            onSelectionTextChange={(selectionText) => {
              selectedSoqlTextRef.current = selectionText;
              if (selectionSyncTimerRef.current !== null) {
                window.clearTimeout(selectionSyncTimerRef.current);
              }
              selectionSyncTimerRef.current = window.setTimeout(() => {
                selectionSyncTimerRef.current = null;
                patchActiveTab((tab) =>
                  tab.selectedSoqlText === selectionText ? tab : { ...tab, selectedSoqlText: selectionText }
                );
              }, 80);
            }}
            onExecuteStatement={(sql, statement) => {
              void executeSingleStatement(sql, undefined, statement.index);
            }}
            onExecuteCurrent={() => {
              void executeCurrentOrSelected();
            }}
            onExecuteAll={() => {
              void executeBatchStatements(activeTab.soqlDraft);
            }}
            statementStatuses={statementStatuses}
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
              {activeTab.consoleMode !== "diff" && multiResultSets.length > 1 && (
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
              {(() => {
                if (activeTab.consoleMode === "diff" || bottomView !== "result") return null;
                const activeBlock = multiResultSets[activeResultSetIndex];
                const stmtIdx = activeBlock?.statementIndex ?? 0;
                const targetResult = activeBlock?.result || activeTab.result;
                const sql = activeBlock?.sql || activeTab.soqlDraft;
                const editability = resolveConsoleResultEditability(
                  sql,
                  targetResult,
                  objectDescribeMap,
                  driver.gridAdapter
                );
                const draft = draftsByStatement[stmtIdx];
                const dirtyCount =
                  (draft?.dirtyCellKeys.length || 0) + (draft?.pendingDeleteRecordIds.length || 0);
                const selectedIds = selectedRowIdsByStatement[stmtIdx] || activeTab.selectedRecordIds;

                return (
                  <div className="ml-2 flex items-center gap-1.5">
                    {editability.editable ? (
                      <>
                        <span className="rounded bg-sky-500/12 px-1.5 py-0.5 text-[10.5px] text-sky-700">
                          可编辑
                        </span>
                        {selectedIds.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-rose-600"
                            onClick={() => handleBlockToggleDelete(stmtIdx)}
                            title="标记或取消标记选中行为待删除"
                          >
                            <Trash2 size={11} />
                            <span>删行 ({selectedIds.length})</span>
                          </button>
                        )}
                        {dirtyCount > 0 && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => handleDiscardBlockChanges(stmtIdx)}
                            >
                              <RotateCcw size={11} />
                              <span>放弃</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              onClick={() => void handleSaveBlockChanges(stmtIdx)}
                            >
                              <Save size={11} />
                              <span>保存 ({dirtyCount})</span>
                            </button>
                          </>
                        )}
                      </>
                    ) : targetResult.records.length > 0 ? (
                      <span
                        className="rounded bg-base-200 px-1.5 py-0.5 text-[10.5px] text-neutral/60"
                        title={editability.readonlyReason}
                      >
                        只读
                      </span>
                    ) : null}
                  </div>
                );
              })()}
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
                activeTab.consoleMode === "diff" ? (
                  <ConsoleDiffBoard
                    tabId={activeTab.id}
                    sourceId={effectiveSourceId}
                    gridAdapter={driver.gridAdapter}
                    displayTimezone={salesforceTimezone}
                    preserveColumnOrder={preserveRawColumns}
                    blocks={multiResultSets}
                    baseline={diffBaseline}
                    draftsByStatement={draftsByStatement}
                    selectedRowIdsByStatement={selectedRowIdsByStatement}
                    objectDescribeMap={objectDescribeMap}
                    loading={activeTab.loading}
                    onPinBaseline={handlePinDiffBaseline}
                    onClearBaseline={handleClearDiffBaseline}
                    onRerunAll={() => void executeCurrentOrSelected()}
                    onEditCell={handleBlockCellEdit}
                    onToggleRows={handleBlockToggleRows}
                    onToggleDeleteSelected={handleBlockToggleDelete}
                    onSaveBlockChanges={(stmtIdx) => void handleSaveBlockChanges(stmtIdx)}
                    onDiscardBlockChanges={handleDiscardBlockChanges}
                    onShowMessage={(message) => {
                      patchActiveTab((tab) => ({
                        ...tab,
                        notice: { type: "error", message }
                      }));
                    }}
                  />
                ) : (() => {
                  const activeBlock = multiResultSets[activeResultSetIndex];
                  const stmtIdx = activeBlock?.statementIndex ?? 0;
                  const draft = draftsByStatement[stmtIdx];
                  const effectiveGridResult = draft
                    ? { ...gridResult, records: draft.records }
                    : gridResult;
                  const editability = resolveConsoleResultEditability(
                    activeBlock?.sql || activeTab.soqlDraft,
                    activeBlock?.result || activeTab.result,
                    objectDescribeMap,
                    driver.gridAdapter
                  );
                  return (
                    <DataGrid
                      result={effectiveGridResult}
                      visibleColumns={visibleColumns}
                      fieldMetadataMap={fieldMetadataMap}
                      readOnlyMode={!editability.editable}
                      readOnlyReasonText={editability.readonlyReason}
                      dirtyCellKeys={draft?.dirtyCellKeys || []}
                      selectedRecordIds={selectedRowIdsByStatement[stmtIdx] || activeTab.selectedRecordIds}
                      displayTimezone={salesforceTimezone}
                      sourceId={effectiveSourceId}
                      objectName={editability.sourceTable || extractPrimaryObjectName(activeBlock?.sql || activeTab.soqlDraft)}
                      gridAdapter={driver.gridAdapter}
                      preserveColumnOrder={preserveRawColumns}
                      pendingDeleteRecordIds={draft?.pendingDeleteRecordIds || []}
                      enableReadonlyCellHint={false}
                      allowReadonlyOverlay={true}
                      scrollStateKey={`console:${activeTab.id}`}
                      onToggleAll={(checked, recordIds) => handleBlockToggleRows(stmtIdx, checked, recordIds)}
                      onEditCell={(rowIndex, columnName, value) =>
                        handleBlockCellEdit(stmtIdx, rowIndex, columnName, value)
                      }
                      onShowMessage={(message) => {
                        patchActiveTab((tab) => ({
                          ...tab,
                          notice: { type: "error", message }
                        }));
                      }}
                    />
                  );
                })()
              ) : (
                <div className="h-full overflow-auto p-3">
                  {activeTab.logs.length === 0 ? (
                    <span className="text-[12px] text-neutral/70">暂无日志。</span>
                  ) : (
                    activeTab.logs.map((log) => (
                      <div key={log.id} className="mb-2 rounded border border-base-300 bg-base-100 p-2">
                        <div className="mb-1 flex items-center justify-between gap-2">
                          <p className={`text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                            {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                          </p>
                          {!log.success && log.errorMessage && (
                            <button
                              type="button"
                              onClick={() =>
                                useAiStore.getState().triggerLaunchIntent({
                                  prompt: `请分析并修复这条执行报错的语句：\n\`\`\`sql\n${log.request}\n\`\`\``,
                                  action: "fix",
                                  mode: "agent",
                                  errorMessage: log.errorMessage,
                                  autoSend: true
                                })
                              }
                              className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary hover:bg-primary/20"
                            >
                              <Sparkles size={11} />
                              <span>AI 修复</span>
                            </button>
                          )}
                        </div>
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

      {/* 控制台两阶段提交 SQL 预览弹窗。 */}
      <ConsoleMutationPreviewModal
        open={mutationPreview.open}
        targetTitle={mutationPreview.sourceTable}
        loading={mutationPreview.loading}
        error={mutationPreview.error}
        items={mutationPreview.items}
        summary={{
          creates: mutationPreview.payload.creates.length,
          updates: mutationPreview.payload.updates.length,
          deletes: mutationPreview.payload.deletes.length
        }}
        onClose={() =>
          setMutationPreview((prev) => ({
            ...prev,
            open: false,
            loading: false,
            error: ""
          }))
        }
        onConfirm={() => void handleConfirmMutationPreview()}
      />
    </div>
  );
}
