import { useMemo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api";
import { useObjectsQuery, useSourcesQuery, useSyncSourcesMutation } from "../../../../queries/salesforce";
import { MainViewMode, useAppStore } from "../../../../store/useAppStore";
import { useSoqlExecutorStore } from "../../../../store/useSoqlExecutorStore";
import { useTerminalStore } from "../../../../store/useTerminalStore";
import { Notice, ObjectDescribe, ObjectDdl, SalesforceObject, TabLog, TabState } from "../../../../types";
import { useSourceActions } from "./useSourceActions";
import { useQueryExecution } from "./useQueryExecution";
import { useQueryPanelRuntime } from "./useQueryPanelRuntime";
import { useQueryPanelActions } from "./useQueryPanelActions";
import { useQueryPanelBindings } from "./useQueryPanelBindings";
import {
  buildConsoleWorkspaceTabId,
  buildDataWorkspaceTabId,
  parseWorkspaceTabId,
  useWorkspaceTabs
} from "./useWorkspaceTabs";
import {
  buildBaselineRecords,
  buildDefaultVisibility,
  buildQueryStatement,
  buildVisibilityFromSoql,
  extractWhereClause,
  getRecordKey,
  getSortableFieldNames,
  getVisibleColumns,
  hasPendingChanges,
  normalizeQueryResult,
  pickDefaultSortField
} from "../logic/queryUtils";
import { QueryPanelActions, QueryPanelViewState } from "../types";

type UseMainPageQueryPanelInput = {
  // 页面视图模式。
  viewMode: MainViewMode;
  // 设置页面视图模式。
  setViewMode: (viewMode: MainViewMode) => void;
  // 控制台侧栏宽度。
  soqlSidebarWidth: number;
  // 设置控制台侧栏宽度。
  setSoqlSidebarWidth: (width: number) => void;
  // 启动流程是否已完成。
  startupComplete: boolean;
  // 认证刷新态，用于 loading 文案。
  tokenRefreshing: boolean;
};

type UseMainPageQueryPanelResult = {
  // QueryPanel 视图状态。
  queryPanelViewState: QueryPanelViewState;
  // QueryPanel 交互动作。
  queryPanelActions: QueryPanelActions;
  // 刷新数据源。
  refreshSources: (syncCli: boolean, preferredOrgId?: string, preferredSourceId?: string) => Promise<void>;
  // 重新加载恢复的 Tab。
  reloadRestoredTabs: (sourceId: string) => Promise<void>;
  // 显示工作区提示。
  showWorkspaceNotice: (notice: Notice, durationMs?: number) => void;
};

// MainPage 的 QueryPanel 聚合控制器：集中收敛 QueryPanel 相关状态、副作用与行为。
export function useMainPageQueryPanel({
  viewMode,
  setViewMode,
  soqlSidebarWidth,
  setSoqlSidebarWidth,
  startupComplete,
  tokenRefreshing
}: UseMainPageQueryPanelInput): UseMainPageQueryPanelResult {
  // React Query：数据源与对象列表。
  const queryClient = useQueryClient();
  const { data: sources = [], isFetching: sourcesFetching } = useSourcesQuery();
  const syncSourcesMutation = useSyncSourcesMutation();

  // Store：Query Tab 相关状态与写入能力。
  const selectedSourceId = useAppStore((state) => state.selectedSourceId);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabObjectName = useAppStore((state) => state.activeTabObjectName);
  const loading = useAppStore((state) => state.loading);
  const setSelectedSourceId = useAppStore((state) => state.setSelectedSourceId);
  const setActiveTabObjectName = useAppStore((state) => state.setActiveTabObjectName);
  const setTabs = useAppStore((state) => state.setTabs);
  const setLoading = useAppStore((state) => state.setLoading);
  const patchTabInStore = useAppStore((state) => state.patchTab);

  // Store：SOQL 控制台状态与行为。
  const switchSoqlSource = useSoqlExecutorStore((state) => state.switchSource);
  const createSoqlConsoleTab = useSoqlExecutorStore((state) => state.createTab);
  const soqlTabs = useSoqlExecutorStore((state) => state.tabs);
  const activeSoqlTabId = useSoqlExecutorStore((state) => state.activeTabId);
  const setActiveSoqlTabId = useSoqlExecutorStore((state) => state.setActiveTabId);
  const closeSoqlTab = useSoqlExecutorStore((state) => state.closeTab);
  const closeSoqlTabsByIds = useSoqlExecutorStore((state) => state.closeTabsByIds);
  // Store：Terminal 工作区状态与行为。
  const switchTerminalSource = useTerminalStore((state) => state.switchSource);

  // Objects 查询：随数据源变化拉取对象元数据。
  const { data: objects = [], isFetching: objectsFetching, error: objectsError } = useObjectsQuery(selectedSourceId);

  // 当前选中数据源：用于按 sourceType 切换 SQL/SOQL 行为。
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );
  // 查询语言标签：MySQL 显示 SQL，其它默认 SOQL。
  const queryLanguageLabel = (selectedSource?.sourceType || "salesforce").toLowerCase() === "mysql" ? "SQL" : "SOQL";

  // 当前激活的 Query Tab。
  const activeTab = useMemo(
    () => tabs.find((item) => item.objectName === activeTabObjectName) || null,
    [tabs, activeTabObjectName]
  );

  // Tab 通知自动关闭计时器。
  const noticeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 工作区提示自动关闭计时器。
  const sourceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 数据源切换请求序号：用于忽略过期请求结果。
  const sourceSwitchSeqRef = useRef(0);
  // 用户上下文请求序号：用于忽略过期响应。
  const userContextSeqRef = useRef(0);

  // 工作区全局浮动提示（与 Tab 无关）。
  const [workspaceNotice, setWorkspaceNotice] = useState<Notice | null>(null);
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 一致展示。
  const [salesforceTimezone, setSalesforceTimezone] = useState<string | null>(null);
  // MySQL DDL 缓存：按对象维度保存建表/索引/约束信息。
  const [mysqlDdlMap, setMysqlDdlMap] = useState<Record<string, { loading: boolean; data: ObjectDdl | null; error: string }>>({});

  // 显示工作区提示：支持自动关闭。
  function showWorkspaceNotice(notice: Notice, durationMs = 2600) {
    setWorkspaceNotice(notice);
    if (sourceNoticeTimerRef.current) {
      clearTimeout(sourceNoticeTimerRef.current);
      sourceNoticeTimerRef.current = null;
    }
    if (durationMs > 0) {
      sourceNoticeTimerRef.current = setTimeout(() => {
        setWorkspaceNotice(null);
        sourceNoticeTimerRef.current = null;
      }, durationMs);
    }
  }

  // 关闭工作区提示并清理计时器。
  function clearWorkspaceNotice() {
    if (sourceNoticeTimerRef.current) {
      clearTimeout(sourceNoticeTimerRef.current);
      sourceNoticeTimerRef.current = null;
    }
    setWorkspaceNotice(null);
  }

  // 更新指定对象 Tab，并统一处理通知自动关闭。
  function patchTab(objectName: string, updater: (tab: TabState) => TabState) {
    let shouldAutoCloseNotice = false;

    patchTabInStore(objectName, (tab) => {
      const next = updater(tab);
      shouldAutoCloseNotice = Boolean(next.notice);

      if (!next.notice && noticeTimersRef.current[objectName]) {
        clearTimeout(noticeTimersRef.current[objectName]);
        delete noticeTimersRef.current[objectName];
      }

      return next;
    });

    if (shouldAutoCloseNotice) {
      if (noticeTimersRef.current[objectName]) {
        clearTimeout(noticeTimersRef.current[objectName]);
      }
      noticeTimersRef.current[objectName] = setTimeout(() => {
        patchTabInStore(objectName, (tab) => ({
          ...tab,
          notice: null
        }));
        delete noticeTimersRef.current[objectName];
      }, 3000);
    }
  }

  // 给当前激活 Tab 写入提示。
  function patchActiveTabNotice(nextNotice: Notice) {
    if (!activeTabObjectName) return;
    patchTab(activeTabObjectName, (item) => ({ ...item, notice: nextNotice }));
  }

  // 追加 Tab 操作日志。
  function appendTabLog(objectName: string, payload: Omit<TabLog, "id" | "timestamp">) {
    const log: TabLog = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      ...payload
    };
    patchTab(objectName, (item) => ({
      ...item,
      logs: [log, ...item.logs].slice(0, 200)
    }));
  }

  // 数据源行为：抽离刷新与切换流程，集中处理并发保护与失败回滚。
  const { refreshSources, handleSourceChange } = useSourceActions({
    sources,
    selectedSourceId,
    setLoading,
    setSelectedSourceId,
    queryClient,
    syncSources: () => syncSourcesMutation.mutateAsync(),
    sourceSwitchSeqRef,
    showWorkspaceNotice,
    clearWorkspaceNotice,
    patchActiveTabNotice
  });

  // 打开认证窗口。
  function openAuthWindow() {
    api
      .openAuthWindow()
      .catch((error) => patchActiveTabNotice({ type: "error", message: `打开登录窗口失败：${String(error)}` }));
  }

  // 点击 Object“不可查询”徽标时，在工作区顶部显示提示。
  function handleNotQueryableObjectClick(objectItem: SalesforceObject) {
    showWorkspaceNotice({
      type: "error",
      message: `${objectItem.name} 不可查询`
    });
  }

  // 从后端 SQLite 读取字段勾选配置，并与当前对象字段做默认值合并。
  async function loadColumnVisibilityFromDb(
    sourceId: string,
    objectName: string,
    describe: ObjectDescribe
  ): Promise<Record<string, boolean>> {
    const defaults = buildDefaultVisibility(describe);
    try {
      const stored = await api.getColumnVisibility(sourceId, objectName);
      return { ...defaults, ...stored };
    } catch {
      return defaults;
    }
  }

  // 将字段勾选状态持久化到 SQLite，失败时给当前 Tab 提示，但不阻塞 UI 交互。
  async function persistColumnVisibility(sourceId: string, objectName: string, visibility: Record<string, boolean>) {
    try {
      await api.saveColumnVisibility(sourceId, objectName, visibility);
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `保存字段勾选配置失败：${String(error)}` }
      }));
    }
  }

  // 查询执行行为：抽离对象查询和自定义 SQL/SOQL 执行流程。
  const { queryTabData, executeCustomSoql } = useQueryExecution({
    selectedSourceId,
    selectedSourceType: selectedSource?.sourceType || "salesforce",
    tabs,
    activeTab,
    queryLanguageLabel,
    patchTab,
    appendTabLog,
    persistColumnVisibility,
    buildQueryStatement,
    normalizeQueryResult,
    buildVisibilityFromSoql,
    extractWhereClause,
    buildBaselineRecords,
    getSortableFieldNames
  });

  // QueryPanel 运行时行为：对象打开、恢复查询、抽屉切换与 DDL 加载。
  const {
    openObjectTab,
    reloadRestoredTabs,
    loadMysqlDdl,
    toggleDrawerForActiveTab,
    deleteCheckedRecords,
    createRecordQuickly,
    applyPendingChanges,
    discardPendingChanges
  } = useQueryPanelRuntime({
    selectedSourceId,
    selectedSourceType: selectedSource?.sourceType || "salesforce",
    activeTab,
    tabs,
    setTabs,
    setActiveTabObjectName,
    patchTab,
    appendTabLog,
    queryTabData,
    loadColumnVisibilityFromDb,
    getSortableFieldNames,
    pickDefaultSortField,
    buildQueryStatement,
    normalizeQueryResult,
    buildBaselineRecords,
    hasPendingChanges,
    getRecordKey,
    mysqlDdlMap,
    setMysqlDdlMap
  });

  // 批量关闭 Tab：统一处理通知计时器、Tab 列表和激活项收敛。
  function closeTabsByObjectNames(objectNames: string[]) {
    if (objectNames.length === 0) return;

    const closeSet = new Set(objectNames);
    Object.keys(noticeTimersRef.current).forEach((objectName) => {
      if (!closeSet.has(objectName)) return;
      clearTimeout(noticeTimersRef.current[objectName]);
      delete noticeTimersRef.current[objectName];
    });

    const nextTabs = tabs.filter((tab) => !closeSet.has(tab.objectName));
    const nextActive = closeSet.has(activeTabObjectName) ? nextTabs[0]?.objectName || "" : activeTabObjectName;
    setTabs(nextTabs);
    setActiveTabObjectName(nextActive);
  }

  // 关闭单个对象 Tab。
  function closeTab(objectName: string) {
    closeTabsByObjectNames([objectName]);
  }

  // 右键动作：关闭目标 Tab 左侧全部。
  function closeLeftTabs(objectName: string) {
    const index = tabs.findIndex((tab) => tab.objectName === objectName);
    if (index <= 0) return;
    closeTabsByObjectNames(tabs.slice(0, index).map((tab) => tab.objectName));
  }

  // 右键动作：关闭目标 Tab 右侧全部。
  function closeRightTabs(objectName: string) {
    const index = tabs.findIndex((tab) => tab.objectName === objectName);
    if (index < 0 || index >= tabs.length - 1) return;
    closeTabsByObjectNames(tabs.slice(index + 1).map((tab) => tab.objectName));
  }

  // 右键动作：关闭除目标 Tab 外的其它 Tab。
  function closeOtherTabs(objectName: string) {
    closeTabsByObjectNames(tabs.filter((tab) => tab.objectName !== objectName).map((tab) => tab.objectName));
  }

  // 右键动作：关闭全部 Tab。
  function closeAllTabs() {
    closeTabsByObjectNames(tabs.map((tab) => tab.objectName));
  }

  // 统一工作区 Tab 状态：抽离 data/console 混合映射与焦点回退逻辑。
  const { workspaceTabs, activeWorkspaceTabId, setActiveWorkspaceTabId, activeWorkspaceTabKind } = useWorkspaceTabs({
    dataTabs: tabs,
    consoleTabs: soqlTabs,
    activeDataObjectName: activeTabObjectName,
    activeConsoleTabId: activeSoqlTabId
  });

  const pageLoading = loading || sourcesFetching || objectsFetching;
  const visibleColumns = activeTab ? getVisibleColumns(activeTab) : [];
  const loadingText = tokenRefreshing ? "重新获取认证凭证中..." : "Loading...";
  const fieldMetadataMap = activeTab
    ? activeTab.describe?.fields.reduce(
        (acc, field) => ({
          ...acc,
          [field.name]: {
            ...(field.metadata || {}),
            // 补齐统一 type：让 DataGrid 类型策略可识别 MySQL/Salesforce 字段类型。
            type: field.dataType || (field.metadata?.type as string) || ""
          }
        }),
        {} as Record<string, Record<string, unknown>>
      ) || {}
    : {};
  const activeTabHasPendingChanges = activeTab ? hasPendingChanges(activeTab) : false;

  // QueryPanel 交互输出：所有行为回调都在本 hook 侧实现。
  const rawQueryPanelActions: QueryPanelActions = useQueryPanelActions({
    activeTab,
    selectedSourceId,
    selectedSourceType: selectedSource?.sourceType || "salesforce",
    setViewMode,
    openAuthWindow,
    createSoqlConsoleTab,
    setActiveWorkspaceTabId,
    buildConsoleWorkspaceTabId,
    parseWorkspaceTabId,
    setActiveTabObjectName,
    setActiveSoqlTabId,
    closeSoqlTab,
    closeSoqlTabsByIds,
    refreshSources,
    handleSourceChange,
    buildDataWorkspaceTabId,
    openObjectTab,
    handleNotQueryableObjectClick,
    closeTab,
    closeTabsByObjectNames,
    closeLeftTabs,
    closeRightTabs,
    closeOtherTabs,
    closeAllTabs,
    createRecordQuickly,
    deleteCheckedRecords,
    applyPendingChanges,
    discardPendingChanges,
    toggleDrawerForActiveTab,
    loadMysqlDdl,
    patchTab,
    queryTabData,
    executeCustomSoql,
    persistColumnVisibility,
    clearWorkspaceNotice,
    setSoqlSidebarWidth
  });

  // QueryPanel 绑定数据：统一产出 viewState 与 actions。
  const { queryPanelViewState, queryPanelActions } = useQueryPanelBindings({
    viewMode,
    soqlSidebarWidth,
    selectedSourceId,
    selectedSourceType: selectedSource?.sourceType || "salesforce",
    salesforceTimezone,
    pageLoading,
    objectsLoading: Boolean(selectedSourceId) && objectsFetching,
    tabs,
    activeTabObjectName,
    activeTab,
    workspaceNotice,
    visibleColumns,
    fieldMetadataMap,
    hasPendingChanges: activeTabHasPendingChanges,
    pendingDeleteRecordIds: activeTab?.pendingDeleteRecordIds ?? [],
    loadingText,
    objects,
    sources,
    mysqlDdl: activeTab ? mysqlDdlMap[activeTab.objectName]?.data || null : null,
    mysqlDdlLoading: activeTab ? Boolean(mysqlDdlMap[activeTab.objectName]?.loading) : false,
    mysqlDdlError: activeTab ? mysqlDdlMap[activeTab.objectName]?.error || "" : "",
    workspaceTabs,
    activeWorkspaceTabId,
    activeWorkspaceTabKind,
    queryableObjectNames: objects.filter((item) => item.queryable).map((item) => item.name),
    actions: rawQueryPanelActions
  });

  // 清理通知计时器：组件卸载时释放资源。
  useEffect(() => {
    return () => {
      Object.values(noticeTimersRef.current).forEach((timer) => clearTimeout(timer));
      noticeTimersRef.current = {};
      if (sourceNoticeTimerRef.current) {
        clearTimeout(sourceNoticeTimerRef.current);
        sourceNoticeTimerRef.current = null;
      }
    };
  }, []);

  // 数据源切换时：切换控制台 source 上下文，恢复该数据源下的控制台 Tabs。
  useEffect(() => {
    if (!startupComplete) return;
    switchSoqlSource(selectedSourceId);
    switchTerminalSource(selectedSourceId);
  }, [startupComplete, selectedSourceId, switchSoqlSource, switchTerminalSource]);

  // 对象列表加载失败时给出明确提示，避免出现“空白但无错误”。
  useEffect(() => {
    if (!objectsError) return;
    showWorkspaceNotice(
      {
        type: "error",
        message: `加载 Objects 列表失败：${String(objectsError)}`
      },
      5000
    );
  }, [objectsError]);

  // 当当前数据源被删除或失效时，清空当前选择。
  useEffect(() => {
    if (!selectedSourceId) return;
    if (sources.length === 0) {
      setSelectedSourceId("");
      return;
    }
    if (!sources.some((item) => item.id === selectedSourceId)) {
      setSelectedSourceId("");
    }
  }, [sources, selectedSourceId, setSelectedSourceId]);

  // 数据源切换后拉取当前用户上下文（时区/地区），用于 datetime 展示对齐。
  useEffect(() => {
    if (!selectedSourceId) {
      setSalesforceTimezone(null);
      setMysqlDdlMap({});
      return;
    }
    setMysqlDdlMap({});

    const seq = userContextSeqRef.current + 1;
    userContextSeqRef.current = seq;
    let cancelled = false;

    void api
      .getCurrentUserContext(selectedSourceId)
      .then((context) => {
        if (cancelled) return;
        if (userContextSeqRef.current !== seq) return;
        setSalesforceTimezone(context.timezoneSidKey || null);
      })
      .catch(() => {
        if (cancelled) return;
        if (userContextSeqRef.current !== seq) return;
        setSalesforceTimezone(null);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSourceId]);

  return {
    queryPanelViewState,
    queryPanelActions,
    refreshSources,
    reloadRestoredTabs,
    showWorkspaceNotice
  };
}
