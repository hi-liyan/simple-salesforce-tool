import { useCallback, useMemo, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../../../../api";
import { useObjectsQuery, useSourcesQuery, useSyncSourcesMutation } from "../../../../queries/salesforce";
import { MainViewMode, useAppStore } from "../../../../store/useAppStore";
import { useSoqlExecutorStore } from "../../../../store/useSoqlExecutorStore";
import { buildObjectTabBindingKey, Notice, ObjectDescribe, ObjectDdl, SalesforceObject, TabLog, TabState } from "../../../../types";
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
import { getSourceColor } from "../logic/sourceColor.ts";

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
  refreshSources: (
    syncCli: boolean,
    preferredOrgId?: string,
    preferredSourceId?: string,
    options?: {
      forceObjectRefresh?: boolean;
      showLoading?: boolean;
    }
  ) => Promise<void>;
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
  // 读取对象 Tab 身份：优先使用 bindingKey，兼容历史 objectName。
  function getTabIdentity(tab: Pick<TabState, "bindingKey" | "sourceId" | "objectName">): string {
    return tab.bindingKey || buildObjectTabBindingKey(tab.sourceId || "", tab.objectName || "");
  }

  // 判断 Tab 是否命中指定身份：兼容旧 objectName 传参。
  function isTabMatchedByIdentity(tab: Pick<TabState, "bindingKey" | "sourceId" | "objectName">, tabIdentity: string): boolean {
    return getTabIdentity(tab) === tabIdentity || tab.objectName === tabIdentity;
  }

  // React Query：数据源与对象列表。
  const queryClient = useQueryClient();
  const { data: sources = [], isFetching: sourcesFetching } = useSourcesQuery(startupComplete);
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
  const createSoqlConsoleTab = useSoqlExecutorStore((state) => state.createTab);
  const soqlTabs = useSoqlExecutorStore((state) => state.tabs);
  const activeSoqlTabId = useSoqlExecutorStore((state) => state.activeTabId);
  const setActiveSoqlTabId = useSoqlExecutorStore((state) => state.setActiveTabId);
  const closeSoqlTab = useSoqlExecutorStore((state) => state.closeTab);
  const closeSoqlTabsByIds = useSoqlExecutorStore((state) => state.closeTabsByIds);

  // Objects 查询：随数据源变化拉取对象元数据。
  const { data: objects = [], isFetching: objectsFetching, isPending: objectsPending, error: objectsError } = useObjectsQuery(selectedSourceId);

  // 当前选中数据源：用于按 sourceType 切换 SQL/SOQL 行为。
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );
  // 当前选中数据源的颜色：用于新建 console tab 时写入来源元信息。
  const selectedSourceColor = selectedSource ? getSourceColor(selectedSource) : "";
  // 数据源颜色索引：用于让已打开的工作区 Tab 跟随最新设置颜色即时更新。
  const sourceColorMap = useMemo(() => new Map(sources.map((source) => [source.id, getSourceColor(source)])), [sources]);
  // 当前激活的 Query Tab。
  const activeTab = useMemo(
    () => tabs.find((item) => isTabMatchedByIdentity(item, activeTabObjectName)) || null,
    [tabs, activeTabObjectName]
  );
  // 当前激活对象 Tab 所绑定的数据源：优先使用 tab 自带 source 上下文，兼容旧模型回退到 selectedSource。
  const activeTabSourceId = activeTab?.sourceId || selectedSourceId;
  const activeTabSourceType = activeTab?.sourceType || selectedSource?.sourceType || "salesforce";
  // 查询语言标签：优先跟随当前激活 tab 的 sourceType。
  const queryLanguageLabel = activeTabSourceType.toLowerCase() === "mysql" ? "SQL" : "SOQL";

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
    selectedSourceId: activeTabSourceId,
    selectedSourceType: activeTabSourceType,
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
    selectedSourceId: activeTabSourceId,
    selectedSourceType: activeTabSourceType,
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

    const nextTabs = tabs.filter((tab) => !closeSet.has(getTabIdentity(tab)) && !closeSet.has(tab.objectName));
    const nextActive = closeSet.has(activeTabObjectName) ? (nextTabs[0] ? getTabIdentity(nextTabs[0]) : "") : activeTabObjectName;
    setTabs(nextTabs);
    setActiveTabObjectName(nextActive);
  }

  // 关闭单个对象 Tab。
  function closeTab(objectName: string) {
    closeTabsByObjectNames([objectName]);
  }

  // 右键动作：关闭目标 Tab 左侧全部。
  function closeLeftTabs(objectName: string) {
    const index = tabs.findIndex((tab) => isTabMatchedByIdentity(tab, objectName));
    if (index <= 0) return;
    closeTabsByObjectNames(tabs.slice(0, index).map((tab) => getTabIdentity(tab)));
  }

  // 右键动作：关闭目标 Tab 右侧全部。
  function closeRightTabs(objectName: string) {
    const index = tabs.findIndex((tab) => isTabMatchedByIdentity(tab, objectName));
    if (index < 0 || index >= tabs.length - 1) return;
    closeTabsByObjectNames(tabs.slice(index + 1).map((tab) => getTabIdentity(tab)));
  }

  // 右键动作：关闭除目标 Tab 外的其它 Tab。
  function closeOtherTabs(objectName: string) {
    closeTabsByObjectNames(tabs.filter((tab) => !isTabMatchedByIdentity(tab, objectName)).map((tab) => getTabIdentity(tab)));
  }

  // 右键动作：关闭全部 Tab。
  function closeAllTabs() {
    closeTabsByObjectNames(tabs.map((tab) => getTabIdentity(tab)));
  }

  // 工作区 data tabs：优先使用当前数据源列表中的最新颜色，避免设置页改色后旧 Tab 颜色滞后。
  const workspaceDataTabs = useMemo(
    () =>
      tabs.map((tab) => ({
        ...tab,
        sourceColor: sourceColorMap.get(tab.sourceId || "") || tab.sourceColor || ""
      })),
    [tabs, sourceColorMap]
  );
  // 工作区 console tabs：同样跟随最新数据源颜色，保持标签视觉与左树一致。
  const workspaceConsoleTabs = useMemo(
    () =>
      soqlTabs.map((tab) => ({
        ...tab,
        sourceColor: sourceColorMap.get(tab.sourceId || "") || tab.sourceColor || ""
      })),
    [soqlTabs, sourceColorMap]
  );

  // 统一工作区 Tab 状态：抽离 data/console 混合映射与焦点回退逻辑。
  const { workspaceTabs, activeWorkspaceTabId, setActiveWorkspaceTabId, reorderWorkspaceTabs, activeWorkspaceTabKind } = useWorkspaceTabs({
    dataTabs: workspaceDataTabs,
    consoleTabs: workspaceConsoleTabs,
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
            // 补齐顶层字段能力，避免仅依赖 metadata 时丢失 nillable/createable/updateable。
            nillable: field.nillable,
            createable: field.createable,
            updateable: field.updateable,
            ...(field.metadata || {}),
            // 补齐统一 type：让 DataGrid 类型策略可识别 MySQL/Salesforce 字段类型。
            type: field.dataType || (field.metadata?.type as string) || ""
          }
        }),
        {} as Record<string, Record<string, unknown>>
      ) || {}
    : {};
  const activeTabHasPendingChanges = activeTab ? hasPendingChanges(activeTab) : false;

  // 强制刷新单个 MySQL 对象的字段元数据与 DDL，并同步已打开 Tab。
  const refreshMysqlObjectMetadata = useCallback(
    async (objectName: string) => {
      const sourceId = selectedSourceId.trim();
      const normalizedObjectName = objectName.trim();
      const normalizedSourceType = (selectedSource?.sourceType || "salesforce").toLowerCase();
      if (!sourceId) {
        throw new Error("请先选择数据源。");
      }
      if (normalizedSourceType !== "mysql") {
        throw new Error("当前数据源不是 MySQL。");
      }
      if (!normalizedObjectName) {
        throw new Error("表名不能为空。");
      }

      setMysqlDdlMap((state) => ({
        ...state,
        [normalizedObjectName]: {
          loading: true,
          data: state[normalizedObjectName]?.data || null,
          error: ""
        }
      }));
      patchTab(normalizedObjectName, (tab) => ({ ...tab, loading: true }));

      try {
        const refreshedObjects = await queryClient.fetchQuery({
          queryKey: ["objects", sourceId],
          staleTime: 0,
          // 对象级刷新复用现有后端强刷链路：更新对象列表缓存并清空该数据源全部元数据缓存。
          queryFn: () => api.refreshObjects(sourceId)
        });
        if (!refreshedObjects.some((item) => item.name === normalizedObjectName)) {
          throw new Error(`刷新后未找到表：${normalizedObjectName}`);
        }

        const describe = await api.describeObject(sourceId, normalizedObjectName);
        const visibility = await loadColumnVisibilityFromDb(sourceId, normalizedObjectName, describe);
        const ddl = await api.getObjectDdl(sourceId, normalizedObjectName);

        setMysqlDdlMap((state) => ({
          ...state,
          [normalizedObjectName]: {
            loading: false,
            data: ddl,
            error: ""
          }
        }));

        const openedTab = useAppStore.getState().tabs.find((tab) => tab.objectName === normalizedObjectName);
        if (openedTab) {
          patchTab(normalizedObjectName, (tab) => ({
            ...tab,
            describe,
            columnVisibility: visibility
          }));
          await queryTabData(normalizedObjectName, describe);
        }

        return { describe, ddl };
      } catch (error) {
        const errorMessage = String(error);
        setMysqlDdlMap((state) => ({
          ...state,
          [normalizedObjectName]: {
            loading: false,
            data: state[normalizedObjectName]?.data || null,
            error: errorMessage
          }
        }));
        patchTab(normalizedObjectName, (tab) => ({ ...tab, loading: false }));
        throw error;
      }
    },
    [selectedSourceId, selectedSource, setMysqlDdlMap, patchTab, queryClient, loadColumnVisibilityFromDb, queryTabData]
  );

  // QueryPanel 交互输出：所有行为回调都在本 hook 侧实现。
  const rawQueryPanelActions: QueryPanelActions = useQueryPanelActions({
    activeTab,
    selectedSourceId,
    selectedSourceType: selectedSource?.sourceType || "salesforce",
    selectedSourceName: selectedSource?.name || "",
    selectedSourceColor,
    setViewMode,
    openAuthWindow,
    createSoqlConsoleTab,
    setActiveWorkspaceTabId,
    reorderWorkspaceTabs,
    buildConsoleWorkspaceTabId,
    parseWorkspaceTabId,
    setActiveTabObjectName,
    setActiveSoqlTabId,
    closeSoqlTab,
    closeSoqlTabsByIds,
    refreshSources,
    refreshMysqlObjectMetadata,
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
    // 仅在当前数据源尚无可用 Objects 数据时显示 loading，避免切换到已缓存数据源时闪烁。
    objectsLoading: Boolean(selectedSourceId) && (objectsPending || (objectsFetching && objects.length === 0)),
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
    mysqlDdlMap,
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
    // 启动阶段由 MainPage 手动恢复 selectedSourceId，避免 Query 尚未接管前被空列表误清空。
    if (!startupComplete) return;
    if (!selectedSourceId) return;
    if (sources.length === 0) {
      setSelectedSourceId("");
      return;
    }
    if (!sources.some((item) => item.id === selectedSourceId)) {
      setSelectedSourceId("");
    }
  }, [startupComplete, sources, selectedSourceId, setSelectedSourceId]);

  // 数据源切换后拉取当前用户上下文（时区/地区），用于 datetime 展示对齐。
  useEffect(() => {
    // 首屏阶段优先保证 UI 可交互，用户上下文放到启动完成后再异步拉取。
    if (!startupComplete) return;
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
  }, [startupComplete, selectedSourceId]);

  return {
    queryPanelViewState,
    queryPanelActions,
    refreshSources,
    reloadRestoredTabs,
    showWorkspaceNotice
  };
}
