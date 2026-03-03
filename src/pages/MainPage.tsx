import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { QueryPanel } from "../features/main/QueryPanel";
import { QueryPanelActions } from "../features/main/QueryPanel/types";
import {
  buildConsoleWorkspaceTabId,
  buildDataWorkspaceTabId,
  parseWorkspaceTabId,
  useWorkspaceTabs
} from "../features/main/QueryPanel/hooks/useWorkspaceTabs";
import { useSourceActions } from "../features/main/QueryPanel/hooks/useSourceActions";
import { useQueryExecution } from "../features/main/QueryPanel/hooks/useQueryExecution";
import { useQueryPanelBindings } from "../features/main/QueryPanel/hooks/useQueryPanelBindings";
import { useQueryPanelActions } from "../features/main/QueryPanel/hooks/useQueryPanelActions";
import { useQueryPanelRuntime } from "../features/main/QueryPanel/hooks/useQueryPanelRuntime";
import { useObjectsQuery, useSourcesQuery, useSyncSourcesMutation } from "../queries/salesforce";
import { useAppStore } from "../store/useAppStore";
import { useSoqlExecutorStore } from "../store/useSoqlExecutorStore";
import { enableStorageWrite } from "../store/tauriStorage";
import { Notice, ObjectDdl, ObjectDescribe, ObjectField, QueryResult, SalesforceObject, TabLog, TabState } from "../types";

// GitHub Releases 固定地址：用于更新提示中的展示与跳转。
const GITHUB_RELEASE_PAGE_URL = "https://github.com/hi-liyan/simple-salesforce-tool/releases";
// GitHub Latest Release API：用于读取最新版本号并做对比。
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/hi-liyan/simple-salesforce-tool/releases/latest";
// 启动版本检查标志：避免 React StrictMode 在开发环境重复触发弹窗。
let startupVersionCheckTriggered = false;

// 主页面：对象列表 + 结果面板 + SOQL 抽屉。
export function MainPage() {
  // Store：视图模式与侧栏宽度（已通过 Zustand persist 自动持久化到 SQLite）。
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const soqlSidebarWidth = useAppStore((state) => state.soqlSidebarWidth);
  const setSoqlSidebarWidth = useAppStore((state) => state.setSoqlSidebarWidth);
  // 启动画面状态：首次初始化完成前显示全屏遮罩，避免用户误以为卡死。
  const [startupLoading, setStartupLoading] = useState(true);
  // 启动完成标记：整个启动流程（rehydrate + refreshSources）完成前为 false，
  // 期间 selectedSourceId useEffect 跳过 resetTabs，避免清空 hydration 恢复的 Tab。
  const startupCompleteRef = useRef(false);
  // Store：读取全局状态。
  const selectedSourceId = useAppStore((state) => state.selectedSourceId);
  const tabs = useAppStore((state) => state.tabs);
  const activeTabObjectName = useAppStore((state) => state.activeTabObjectName);
  const loading = useAppStore((state) => state.loading);
  const setSelectedSourceId = useAppStore((state) => state.setSelectedSourceId);
  const setActiveTabObjectName = useAppStore((state) => state.setActiveTabObjectName);
  const setTabs = useAppStore((state) => state.setTabs);
  const setLoading = useAppStore((state) => state.setLoading);
  const patchTabInStore = useAppStore((state) => state.patchTab);
  const resetTabs = useAppStore((state) => state.resetTabs);
  // SOQL 控制台：用于“查询控制台”按钮每次点击都新增 Tab。
  const createSoqlConsoleTab = useSoqlExecutorStore((state) => state.createTab);
  // SOQL 控制台 Tab 列表：用于统一工作区混合 Tab。
  const soqlTabs = useSoqlExecutorStore((state) => state.tabs);
  // 当前激活 SOQL 控制台 Tab ID。
  const activeSoqlTabId = useSoqlExecutorStore((state) => state.activeTabId);
  // 激活 SOQL 控制台 Tab。
  const setActiveSoqlTabId = useSoqlExecutorStore((state) => state.setActiveTabId);
  // 关闭 SOQL 控制台 Tab。
  const closeSoqlTab = useSoqlExecutorStore((state) => state.closeTab);

  // React Query：数据源与对象列表。
  const queryClient = useQueryClient();
  const { data: sources = [], isFetching: sourcesFetching } = useSourcesQuery();
  const { data: objects = [], isFetching: objectsFetching, error: objectsError } = useObjectsQuery(selectedSourceId);
  const syncSourcesMutation = useSyncSourcesMutation();
  // 当前选中数据源：用于按 sourceType 切换 SQL/SOQL 行为。
  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );
  // 查询语言标签：MySQL 显示 SQL，其它默认 SOQL。
  const queryLanguageLabel = (selectedSource?.sourceType || "salesforce").toLowerCase() === "mysql" ? "SQL" : "SOQL";

  // 当前激活的 Tab。
  const activeTab = useMemo(
    () => tabs.find((item) => item.objectName === activeTabObjectName) || null,
    [tabs, activeTabObjectName]
  );
  // 通知自动关闭的计时器。
  const noticeTimersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // 数据源切换提示计时器。
  const sourceNoticeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 工作区全局浮动提示（与 Tab 无关）。
  const [workspaceNotice, setWorkspaceNotice] = useState<Notice | null>(null);
  // 新版本提示模态框状态：有值时显示升级弹窗。
  const [versionUpdateModal, setVersionUpdateModal] = useState<VersionUpdateModalState | null>(null);
  // 认证凭证刷新计数器：用于处理并发 API 请求下的开始/结束配对。
  const tokenRefreshingCountRef = useRef(0);
  // 数据源切换请求序号：用于忽略过期请求结果，避免并发切换互相覆盖。
  const sourceSwitchSeqRef = useRef(0);
  // 是否正在通过 CLI 重新获取 accessToken。
  const [tokenRefreshing, setTokenRefreshing] = useState(false);
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 一致展示。
  const [salesforceTimezone, setSalesforceTimezone] = useState<string | null>(null);
  // MySQL DDL 缓存：按对象维度保存建表/索引/约束信息。
  const [mysqlDdlMap, setMysqlDdlMap] = useState<
    Record<string, { loading: boolean; data: ObjectDdl | null; error: string }>
  >({});
  // 用户上下文请求序号：用于忽略过期响应，避免并发切换数据源造成时区回写错乱。
  const userContextSeqRef = useRef(0);


  // 初始化加载：手动触发 Zustand rehydrate，等待完成后再同步数据源列表。
  useEffect(() => {
    // 标记组件生命周期，避免卸载后 setState。
    let active = true;
    const setup = async () => {
      // 手动触发 rehydrate（skipHydration: true），从 SQLite 恢复持久化状态。
      // 两个 store 并行恢复，缩短启动耗时。
      await Promise.all([
        useAppStore.persist.rehydrate(),
        useSoqlExecutorStore.persist.rehydrate()
      ]);
      if (!active) return;
      // rehydrate 完成且确认组件仍存活后，才开启写入门控。
      // 必须在 active 检查之后，否则 StrictMode 下被卸载的 setup 会提前打开门控，
      // 导致后续 rehydrate 的 set() 触发 subscriber 时写入空数据覆盖 SQLite。
      enableStorageWrite();
      // hydration 完成后从 store 读取持久化的数据源 ID。
      const persistedSourceId = useAppStore.getState().selectedSourceId;
      // 触发 CLI 同步刷新数据源。
      await refreshSources(true, undefined, persistedSourceId);
      if (!active) return;
      // 首次初始化结束后关闭启动遮罩，并标记启动完成。
      setStartupLoading(false);
      startupCompleteRef.current = true;
      // 异步重新拉取恢复的 Tab 数据（describe + query），不阻塞主界面。
      void reloadRestoredTabs(persistedSourceId);
      if (!startupVersionCheckTriggered) {
        startupVersionCheckTriggered = true; // 严格模式下可能重复挂载，这里只触发一次版本检查。
        void checkLatestVersionOnStartup(showVersionUpdateModal);
      }
    };
    void setup();
    return () => {
      active = false;
    };
  }, []);

  // 监听 token 刷新事件：用于在 loading 遮罩中显示更明确文案。
  useEffect(() => {
    // 标记组件生命周期，避免卸载后 setState。
    let active = true;
    let unlistenStart: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    const setup = async () => {
      unlistenStart = await listen("sf:token-refresh-start", () => {
        if (!active) return;
        tokenRefreshingCountRef.current += 1;
        setTokenRefreshing(true);
      });

      unlistenEnd = await listen("sf:token-refresh-end", () => {
        if (!active) return;
        tokenRefreshingCountRef.current = Math.max(0, tokenRefreshingCountRef.current - 1);
        setTokenRefreshing(tokenRefreshingCountRef.current > 0);
      });
    };

    void setup();
    return () => {
      active = false;
      unlistenStart?.();
      unlistenEnd?.();
      tokenRefreshingCountRef.current = 0;
    };
  }, []);

  // 监听登录成功事件：自动刷新数据源并切换到新登录的 org。
  useEffect(() => {
    // 标记是否仍处于激活状态，避免卸载后更新状态。
    let active = true;
    // 监听事件注册逻辑。
    const setup = async () => {
      // 监听登录成功事件。
      const unlisten = await listen<{ orgId: string }>("sf:login-success", async (event) => {
        // 组件已卸载则不处理。
        if (!active) return;
        // 刷新数据源，并优先选中本次登录的 org。
        await refreshSources(true, event.payload?.orgId);
        showWorkspaceNotice({
          type: "success",
          message: "Salesforce 认证成功。"
        });
      });
      return unlisten;
    };

    // 保存取消监听函数。
    let cleanup: (() => void) | undefined;
    setup().then((unlisten) => {
      cleanup = unlisten;
    });
    // 卸载时取消监听并标记失活。
    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  // 清理通知计时器：组件卸载时释放资源。
  useEffect(() => {
    // 组件卸载时清理所有通知定时器，避免内存泄漏。
    return () => {
      // 逐个清除定时器。
      Object.values(noticeTimersRef.current).forEach((timer) => clearTimeout(timer));
      // 重置引用，避免残留。
      noticeTimersRef.current = {};
      if (sourceNoticeTimerRef.current) {
        clearTimeout(sourceNoticeTimerRef.current);
        sourceNoticeTimerRef.current = null;
      }
    };
  }, []);

  // 数据源切换时：重置 Tab 状态，避免跨数据源混淆。
  // 启动阶段完全跳过，避免 hydration / refreshSources 引起的 selectedSourceId 变化清空恢复的 Tab。
  useEffect(() => {
    if (!startupCompleteRef.current) return;
    resetTabs();
  }, [selectedSourceId, resetTabs]);


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
    // 未选择数据源则不需要处理。
    if (!selectedSourceId) return;
    // 列表为空时清空选中项。
    if (sources.length === 0) {
      setSelectedSourceId("");
      return;
    }
    // 当前选中项不存在时清空选择，不自动切到第一个。
    if (!sources.some((item) => item.id === selectedSourceId)) {
      setSelectedSourceId("");
    }
  }, [sources, selectedSourceId, setSelectedSourceId]);

  // 数据源切换后拉取当前用户上下文（时区/地区），用于 datetime 与 Salesforce Web 行为对齐。
  useEffect(() => {
    if (!selectedSourceId) {
      setSalesforceTimezone(null); // 未选择数据源时重置时区，回退前端默认行为。
      setMysqlDdlMap({}); // 未选择数据源时清空 DDL 缓存。
      return;
    }
    setMysqlDdlMap({}); // 切换到新数据源后清空旧 DDL 缓存，避免跨源污染。

    const seq = userContextSeqRef.current + 1;
    userContextSeqRef.current = seq;
    let cancelled = false;

    void api.getCurrentUserContext(selectedSourceId)
      .then((context) => {
        if (cancelled) return;
        if (userContextSeqRef.current !== seq) return;
        setSalesforceTimezone(context.timezoneSidKey || null); // 仅使用有效时区；空值时走前端兜底。
      })
      .catch(() => {
        if (cancelled) return;
        if (userContextSeqRef.current !== seq) return;
        setSalesforceTimezone(null); // 获取失败时降级，不阻塞主流程。
      });

    return () => {
      cancelled = true;
    };
  }, [selectedSourceId]);

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

  // 点击 Object“不可查询”徽标时，在工作区顶部显示提示。
  function handleNotQueryableObjectClick(objectItem: SalesforceObject) {
    showWorkspaceNotice({
      type: "error",
      message: `${objectItem.name} 不可查询`
    });
  }

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

  function clearWorkspaceNotice() {
    if (sourceNoticeTimerRef.current) {
      clearTimeout(sourceNoticeTimerRef.current);
      sourceNoticeTimerRef.current = null;
    }
    setWorkspaceNotice(null);
  }

  // 版本检查命中时展示升级模态框。
  function showVersionUpdateModal(payload: VersionUpdateModalState) {
    setVersionUpdateModal(payload);
  }

  // 关闭升级模态框。
  function closeVersionUpdateModal() {
    setVersionUpdateModal(null);
  }

  // 点击“前往更新”：由后端调用系统浏览器打开发布页，避免 window.open。
  async function handleConfirmVersionUpdateModal() {
    if (!versionUpdateModal) return;
    try {
      await api.openExternalUrl(versionUpdateModal.releasePageUrl); // 通过 Tauri 命令打开外链，避免浏览器弹窗拦截。
      setVersionUpdateModal(null);
    } catch (error) {
      showWorkspaceNotice(
        {
          type: "error",
          message: `打开发布页失败：${String(error)}`
        },
        5000
      );
    }
  }

  function openAuthWindow() {
    api
      .openAuthWindow()
      .catch((error) => patchActiveTabNotice({ type: "error", message: `打开登录窗口失败：${String(error)}` }));
  }

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

    // 只要出现新的通知，就在 3 秒后自动关闭。
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

  function patchActiveTabNotice(nextNotice: Notice) {
    if (!activeTabObjectName) return;
    patchTab(activeTabObjectName, (item) => ({ ...item, notice: nextNotice }));
  }

  function appendTabLog(
    objectName: string,
    payload: Omit<TabLog, "id" | "timestamp">
  ) {
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
  const { openObjectTab, reloadRestoredTabs, loadMysqlDdl, toggleDrawerForActiveTab, deleteCheckedRecords, createRecordQuickly, applyPendingChanges, discardPendingChanges } = useQueryPanelRuntime({
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

  function closeTab(objectName: string) {
    closeTabsByObjectNames([objectName]); // 单个关闭复用批量关闭逻辑，保持行为一致。
  }

  // 批量关闭 Tab：统一处理通知计时器、Tab 列表和激活项收敛。
  function closeTabsByObjectNames(objectNames: string[]) {
    if (objectNames.length === 0) return;

    const closeSet = new Set(objectNames);
    Object.keys(noticeTimersRef.current).forEach((objectName) => {
      if (!closeSet.has(objectName)) return;
      clearTimeout(noticeTimersRef.current[objectName]); // 关闭前清理通知计时器，避免悬空回调。
      delete noticeTimersRef.current[objectName];
    });

    const nextTabs = tabs.filter((tab) => !closeSet.has(tab.objectName));
    const nextActive = closeSet.has(activeTabObjectName) ? nextTabs[0]?.objectName || "" : activeTabObjectName;
    setTabs(nextTabs); // 批量写回剩余 Tab。
    setActiveTabObjectName(nextActive); // 若当前激活 Tab 被关闭，则切到第一个剩余 Tab。
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

  // 统一工作区 Tab 状态：抽离 data/console 混合映射与焦点回退逻辑，降低 MainPage 复杂度。
  const {
    workspaceTabs,
    activeWorkspaceTabId,
    setActiveWorkspaceTabId,
    activeWorkspaceTabParsed,
    activeWorkspaceTabKind
  } = useWorkspaceTabs({
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
  // QueryPanel 交互输出：所有行为回调都在 MainPage 侧实现，便于后续替换 store 适配层。
  const rawQueryPanelActions: QueryPanelActions = useQueryPanelActions({
    activeTab,
    selectedSourceId,
    setViewMode,
    openAuthWindow,
    createSoqlConsoleTab,
    setActiveWorkspaceTabId,
    buildConsoleWorkspaceTabId,
    parseWorkspaceTabId,
    setActiveTabObjectName,
    setActiveSoqlTabId,
    closeSoqlTab,
    refreshSources,
    handleSourceChange,
    buildDataWorkspaceTabId,
    openObjectTab,
    handleNotQueryableObjectClick,
    closeTab,
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
  // QueryPanel 绑定数据：将 viewState/actions 组装下沉到 QueryPanel hooks。
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

  return (
    // 页面容器：用于承载主布局与启动遮罩层。
    <div className="relative h-full w-full">
      {/* QueryPanel 壳层：统一承载 Query/SOQL/设置视图编排。 */}
      <QueryPanel viewState={queryPanelViewState} actions={queryPanelActions} />
      {versionUpdateModal && (
        // 新版本提示模态框：统一替代 confirm + 通知的双提示流程。
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-base-300/45 p-4 backdrop-blur-[2px]">
          {/* 模态框卡片：展示版本信息与更新入口。 */}
          <div className="w-full max-w-xl rounded-xl border border-base-300 bg-base-100 p-6 shadow-2xl">
            {/* 标题区：强调发现新版本。 */}
            <div className="mb-3">
              <h3 className="text-lg font-semibold">检测到新版本</h3>
              <p className="mt-1 text-sm text-neutral/70">
                发现可用更新，是否现在前往 GitHub Releases 页面查看并下载？
              </p>
            </div>
            {/* 版本信息：便于快速确认升级差异。 */}
            <div className="rounded-lg border border-base-300 bg-base-200/60 p-3 text-sm">
              <p>
                <span className="text-neutral/70">当前版本：</span>
                <span className="font-medium">{versionUpdateModal.currentVersion}</span>
              </p>
              <p className="mt-1">
                <span className="text-neutral/70">最新版本：</span>
                <span className="font-medium text-primary">{versionUpdateModal.latestVersion}</span>
              </p>
              <p className="mt-1 break-all text-xs text-neutral/70">{versionUpdateModal.releasePageUrl}</p>
            </div>
            {/* 操作区：支持暂不更新或立即前往发布页。 */}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={closeVersionUpdateModal}>
                稍后再说
              </button>
              <button className="btn btn-primary" onClick={() => void handleConfirmVersionUpdateModal()}>
                前往更新
              </button>
            </div>
          </div>
        </div>
      )}
      {startupLoading && (
        // 启动遮罩：初始化期间覆盖全屏并拦截鼠标事件。
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-base-200/95 backdrop-blur-sm">
          {/* 启动卡片：展示加载状态与提示文案。 */}
          <div className="w-[380px] rounded-xl border border-base-300 bg-base-100 p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="loading loading-spinner text-primary" style={{ width: 26, height: 26 }} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">正在启动应用</p>
                <p className="mt-1 text-[12px] text-neutral/70">正在加载数据源与对象元数据，请稍候...</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 计算默认字段可见性。
function buildDefaultVisibility(describe: ObjectDescribe): Record<string, boolean> {
  return describe.fields.reduce((acc, field) => ({ ...acc, [field.name]: true }), {} as Record<string, boolean>);
}

// 根据字段勾选返回可见列。
function getVisibleColumns(tab: TabState): string[] {
  if (!tab.describe) return [];
  return tab.describe.fields
    .map((field) => field.name)
    .filter((name) => (tab.columnVisibility[name] ?? true) === true);
}

// 根据 SOQL 解析字段可见性。
function buildVisibilityFromSoql(
  soql: string,
  describe: ObjectDescribe | null,
  fallback: Record<string, boolean>
): Record<string, boolean> {
  if (!describe) return fallback;
  const selected = extractSelectedFields(soql);
  if (selected.length === 0) return fallback;

  const selectedSet = new Set(selected.map((name) => name.toLowerCase()));
  return describe.fields.reduce((acc, field) => {
    acc[field.name] = selectedSet.has(field.name.toLowerCase());
    return acc;
  }, {} as Record<string, boolean>);
}

// 从 SOQL 中抽取字段列表。
function extractSelectedFields(soql: string): string[] {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^select\s+(.+?)\s+from\s+/i);
  if (!match) return [];

  const fieldSegment = match[1].trim();
  if (!fieldSegment || fieldSegment === "*") return [];
  if (/^count\(/i.test(fieldSegment)) return [];

  return fieldSegment
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const withoutAlias = item.split(/\s+/)[0];
      const dotParts = withoutAlias.split(".");
      return dotParts[dotParts.length - 1];
    });
}

// 从 SOQL 中抽取 WHERE 条件。
function extractWhereClause(soql: string, objectName: string): string | null {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const objectEscaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`\\sfrom\\s+${objectEscaped}\\s*(.*)$`, "i"));
  if (!match) return null;
  const tail = match[1].trim();

  const whereMatch = tail.match(/^where\s+(.+?)(\s+order\s+by\s+|\s+limit\s+|$)/i);
  if (!whereMatch) return "";
  return whereMatch[1].trim();
}

// 构建标准查询语句：按 sourceType 生成 SQL 或 SOQL。
function buildQueryStatement(
  sourceType: string,
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  limit: number,
  sortClause: string
): string {
  const normalizedType = (sourceType || "salesforce").toLowerCase();
  if (normalizedType === "mysql") {
    return buildQuerySql(objectName, selectedFields, whereClause, sortClause, limit);
  }
  return buildQuerySoql(objectName, selectedFields, whereClause, sortField, sortDirection, limit);
}

// 构建标准 SOQL 查询语句。
function buildQuerySoql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  // SELECT 字段逐行展开：生成“真实换行”的多行 SOQL，避免编辑器内只有单行内容。
  const selectFieldsSegment = fields.map((field, index) => `  ${field}${index < fields.length - 1 ? "," : ""}`).join("\n");
  const whereSegment = whereClause.trim() ? `\nWHERE ${whereClause.trim()}` : "";
  // 当排序字段为空时，明确不拼接 ORDER BY，避免生成无效 SOQL。
  const orderBySegment = sortField.trim() ? `\nORDER BY ${sortField} ${sortDirection}` : "";
  return `SELECT\n${selectFieldsSegment}\nFROM ${objectName}${whereSegment}${orderBySegment}\nLIMIT ${limit}`;
}

// 构建标准 SQL 查询语句（MySQL）。
function buildQuerySql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortClause: string,
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  // SELECT 字段逐行展开：统一多行风格，便于用户快速审阅。
  const selectFieldsSegment = fields.map((field, index) => `  ${field}${index < fields.length - 1 ? "," : ""}`).join("\n");
  const whereSegment = whereClause.trim() ? `\nWHERE ${whereClause.trim()}` : "";
  // MySQL 排序支持手动表达式输入，允许多字段/函数排序。
  const normalizedSortClause = sortClause.trim().replace(/^order\s+by\s+/i, "");
  const orderBySegment = normalizedSortClause ? `\nORDER BY ${normalizedSortClause}` : "";
  return `SELECT\n${selectFieldsSegment}\nFROM ${objectName}${whereSegment}${orderBySegment}\nLIMIT ${limit}`;
}

// 判断字段是否可排序：依据后端返回的字段元数据 `sortable`。
function isFieldSortable(field: ObjectField): boolean {
  return field.metadata?.sortable === true;
}

// 提取对象的可排序字段列表。
function getSortableFieldNames(describe: ObjectDescribe): string[] {
  return describe.fields.filter((field) => isFieldSortable(field)).map((field) => field.name);
}

// 按优先级挑选默认排序字段；若无可排序字段则返回空字符串（不排序）。
function pickDefaultSortField(sortableFieldNames: string[]): string {
  const priority = ["LastModifiedDate", "CreatedDate", "Name", "Id"];
  const preferred = priority.find((fieldName) => sortableFieldNames.includes(fieldName));
  if (preferred) return preferred;
  return sortableFieldNames[0] || "";
}

// 判断 Tab 是否存在未提交的变更。
function hasPendingChanges(tab: TabState): boolean {
  const hasNewRows = tab.result.records.some((record) => Boolean(record.__isNew));
  return hasNewRows || tab.dirtyCellKeys.length > 0 || tab.pendingDeleteRecordIds.length > 0;
}

// 基线记录：用于比较单元格是否发生变化。
function buildBaselineRecords(records: Record<string, unknown>[]): Record<string, Record<string, unknown>> {
  const baseline: Record<string, Record<string, unknown>> = {};
  records.forEach((record, index) => {
    baseline[getRecordKey(record, index)] = { ...record };
  });
  return baseline;
}

// 获取记录主键或临时键。
function getRecordKey(record: Record<string, unknown>, rowIndex: number): string {
  if (record.__localId) return String(record.__localId);
  if (record.Id) return String(record.Id);
  return `row-${rowIndex}`;
}

// 将值转换为可比较字符串。
function stringifyComparableValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}

// GitHub Latest Release API 返回结构：仅取版本号字段即可完成比较。
type GithubLatestReleasePayload = {
  tag_name?: string;
};

// 新版本提示模态框载荷：包含版本差异与发布页地址。
type VersionUpdateModalState = {
  currentVersion: string;
  latestVersion: string;
  releasePageUrl: string;
};

// 语义版本结构：拆分主版本段与预发布标签，便于稳定比较。
type ParsedSemanticVersion = {
  coreParts: number[];
  preRelease: string | null;
};

// 启动时检查 GitHub 最新版本；若有更新则触发升级模态框。
async function checkLatestVersionOnStartup(onFoundNewVersion: (payload: VersionUpdateModalState) => void): Promise<void> {
  try {
    const currentVersion = (await getVersion()).trim();
    if (!currentVersion) return;

    const latestVersion = await fetchLatestGithubReleaseVersion();
    if (!latestVersion) return;
    if (!isGithubVersionNewer(currentVersion, latestVersion)) return;
    onFoundNewVersion({
      currentVersion,
      latestVersion,
      releasePageUrl: GITHUB_RELEASE_PAGE_URL
    });
  } catch (error) {
    // 版本检查失败不影响业务启动，只打印调试日志。
    console.warn("启动版本检查失败：", error);
  }
}

// 拉取 GitHub 最新发布版本号（tag_name），失败时返回 null。
async function fetchLatestGithubReleaseVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as GithubLatestReleasePayload;
  const version = (payload.tag_name ?? "").trim();
  return version || null;
}

// 判断 GitHub 版本是否高于当前版本。
function isGithubVersionNewer(currentVersion: string, latestVersion: string): boolean {
  return compareSemanticVersion(latestVersion, currentVersion) > 0;
}

// 比较两个语义版本：返回 1 表示 left 更新，-1 表示 right 更新，0 表示相等。
function compareSemanticVersion(leftVersion: string, rightVersion: string): number {
  // 比较前统一忽略版本号前缀 `v/V`，避免 `v1.2.3` 与 `1.2.3` 被误判为不相等。
  const normalizedLeftVersion = leftVersion.trim().replace(/^[vV]/, "");
  const normalizedRightVersion = rightVersion.trim().replace(/^[vV]/, "");
  const left = parseSemanticVersion(normalizedLeftVersion);
  const right = parseSemanticVersion(normalizedRightVersion);
  if (!left || !right) {
    // 兜底比较：非标准版本格式时使用带数字感知的字符串比较。
    return normalizedLeftVersion.localeCompare(normalizedRightVersion, undefined, { numeric: true, sensitivity: "base" });
  }

  const compareLength = Math.max(left.coreParts.length, right.coreParts.length);
  for (let index = 0; index < compareLength; index += 1) {
    const leftPart = left.coreParts[index] ?? 0;
    const rightPart = right.coreParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  const leftIsStable = !left.preRelease;
  const rightIsStable = !right.preRelease;
  // 主版本一致时：正式版 > 预发布版。
  if (leftIsStable && !rightIsStable) return 1;
  if (!leftIsStable && rightIsStable) return -1;
  if (left.preRelease && right.preRelease) {
    return left.preRelease.localeCompare(right.preRelease, undefined, { numeric: true, sensitivity: "base" });
  }
  return 0;
}

// 解析语义版本字符串，兼容 `v1.2.3` 与 `1.2.3-beta.1`。
function parseSemanticVersion(rawVersion: string): ParsedSemanticVersion | null {
  const normalizedVersion = rawVersion.trim().replace(/^[vV]/, "");
  if (!normalizedVersion) return null;

  const [coreSegment, preReleaseSegment = ""] = normalizedVersion.split("-", 2);
  if (!/^\d+(\.\d+)*$/.test(coreSegment)) return null;

  return {
    coreParts: coreSegment.split(".").map((part) => Number.parseInt(part, 10)),
    preRelease: preReleaseSegment.trim() || null
  };
}

