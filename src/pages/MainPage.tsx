import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { Braces, ScrollText, Settings, Table2 } from "lucide-react";
import { api } from "../api";
import { LeftSidebar } from "../features/main/LeftSidebar";
import { RightWorkspace } from "../features/main/RightWorkspace";
import { SoqlExecutorWorkspace } from "../features/main/SoqlExecutorWorkspace";
import { SettingsPanel } from "../features/main/SettingsPanel";
import { SystemLogsPanel } from "../features/main/SystemLogsPanel";
import { MainLayout } from "../layouts/MainLayout";
import { useObjectsQuery, useSourcesQuery, useSyncSourcesMutation } from "../queries/salesforce";
import { useAppStore } from "../store/useAppStore";
import { Notice, ObjectDescribe, ObjectField, QueryResult, SalesforceObject, TabLog, TabState } from "../types";

// 主页面：对象列表 + 结果面板 + SOQL 抽屉。
export function MainPage() {
  const [viewMode, setViewMode] = useState<"query" | "soqlExecutor" | "systemLogs" | "settings">("query");
  // 启动画面状态：首次初始化完成前显示全屏遮罩，避免用户误以为卡死。
  const [startupLoading, setStartupLoading] = useState(true);
  // SOQL 执行器左侧栏宽度：支持拖拽调整。
  const [soqlSidebarWidth, setSoqlSidebarWidth] = useState(320);
  // 是否正在拖拽 SOQL 侧栏分隔条。
  const [soqlSidebarResizing, setSoqlSidebarResizing] = useState(false);
  // 拖拽起始点 X 坐标。
  const soqlResizeStartXRef = useRef(0);
  // 拖拽起始宽度。
  const soqlResizeStartWidthRef = useRef(320);
  // 拖拽前 body 的 user-select 样式，结束拖拽后恢复。
  const prevBodyUserSelectRef = useRef("");
  // 拖拽前 body 的 cursor 样式，结束拖拽后恢复。
  const prevBodyCursorRef = useRef("");
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

  // React Query：数据源与对象列表。
  const queryClient = useQueryClient();
  const { data: sources = [], isFetching: sourcesFetching } = useSourcesQuery();
  const { data: objects = [], isFetching: objectsFetching, error: objectsError } = useObjectsQuery(selectedSourceId);
  const syncSourcesMutation = useSyncSourcesMutation();

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
  // 认证凭证刷新计数器：用于处理并发 API 请求下的开始/结束配对。
  const tokenRefreshingCountRef = useRef(0);
  // 是否正在通过 CLI 重新获取 accessToken。
  const [tokenRefreshing, setTokenRefreshing] = useState(false);

  // SOQL 执行器侧栏拖拽：鼠标移动时更新宽度，抬起时结束拖拽。
  useEffect(() => {
    if (!soqlSidebarResizing) return;

    // 进入拖拽：禁用文本选中并统一鼠标样式，避免误选中与拖拽卡顿。
    prevBodyUserSelectRef.current = document.body.style.userSelect;
    prevBodyCursorRef.current = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - soqlResizeStartXRef.current;
      const rawWidth = soqlResizeStartWidthRef.current + deltaX;
      // 侧栏宽度限制：避免过窄影响可读性，避免过宽挤压主区域。
      const maxWidth = Math.max(420, Math.floor(window.innerWidth * 0.6));
      const nextWidth = Math.max(240, Math.min(maxWidth, rawWidth));
      setSoqlSidebarWidth(nextWidth);
    };

    const onMouseUp = () => {
      setSoqlSidebarResizing(false); // 结束拖拽状态，解除全局监听。
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      // 退出拖拽：恢复页面原有光标与文本选中样式。
      document.body.style.userSelect = prevBodyUserSelectRef.current;
      document.body.style.cursor = prevBodyCursorRef.current;
    };
  }, [soqlSidebarResizing]);

  // 初始化加载：进入页面时同步一次数据源列表。
  useEffect(() => {
    // 标记组件生命周期，避免卸载后 setState。
    let active = true;
    const setup = async () => {
      // 触发 CLI 同步刷新数据源。
      await refreshSources(true);
      if (!active) return;
      // 首次初始化结束后关闭启动遮罩。
      setStartupLoading(false);
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
  useEffect(() => {
    // 未选择数据源时清空 Tab。
    if (!selectedSourceId) {
      resetTabs();
      return;
    }
    // 已选择数据源也重置 Tab，确保数据一致。
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

  async function refreshSources(syncCli: boolean, preferredOrgId?: string) {
    setLoading(true);
    try {
      let list = sources;
      if (syncCli) {
        list = await syncSourcesMutation.mutateAsync();
      } else {
        list = await queryClient.fetchQuery({
          queryKey: ["sources"],
          queryFn: () => api.listSources()
        });
      }

      const preferredId = preferredOrgId ? `cli-${preferredOrgId}` : "";
      // 计算刷新后的最终选中数据源，用于决定是否要同步刷新 Objects。
      let nextSelectedSourceId = "";
      if (preferredId && list.some((item) => item.id === preferredId)) {
        nextSelectedSourceId = preferredId;
      } else if (!list.some((item) => item.id === selectedSourceId)) {
        nextSelectedSourceId = "";
      } else {
        nextSelectedSourceId = selectedSourceId;
      }
      setSelectedSourceId(nextSelectedSourceId);

      // 刷新按钮行为增强：若当前仍有选中数据源，则立即重新拉取 Objects 列表。
      if (nextSelectedSourceId) {
        await queryClient.fetchQuery({
          queryKey: ["objects", nextSelectedSourceId],
          queryFn: () => api.refreshObjects(nextSelectedSourceId)
        });
      }
    } catch (error) {
      patchActiveTabNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function handleSourceChange(sourceId: string) {
    setSelectedSourceId(sourceId);

    if (!sourceId) {
      clearWorkspaceNotice();
      return;
    }

    const selectedSource = sources.find((item) => item.id === sourceId);
    const sourceDisplayName = selectedSource?.name || sourceId;
    showWorkspaceNotice({
      type: "success",
      message: `已切换到数据源：${sourceDisplayName}`
    });
  }

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

  async function openObjectTab(objectItem: SalesforceObject) {
    if (!selectedSourceId) return;

    const existed = tabs.find((tab) => tab.objectName === objectItem.name);
    if (existed) {
      setActiveTabObjectName(objectItem.name);
      return;
    }

    const newTab: TabState = {
      objectName: objectItem.name,
      label: objectItem.label,
      describe: null,
      result: { totalSize: 0, records: [] },
      whereClause: "",
      limit: 200,
      sortField: "",
      sortDirection: "DESC",
      selectedRecordIds: [],
      // 待删除记录：仅做前端标记，执行更新时统一提交。
      pendingDeleteRecordIds: [],
      currentSoql: "",
      soqlDraft: "",
      showQueryBar: true,
      showDrawer: false,
      showLogs: false,
      logs: [],
      columnVisibility: {},
      dirtyCellKeys: [],
      baselineRecords: {},
      notice: null,
      loading: true
    };

    setTabs((current) => [...current, newTab]);
    setActiveTabObjectName(objectItem.name);

    try {
      const describe = await api.describeObject(selectedSourceId, objectItem.name);
      const persistedVisibility = await loadColumnVisibilityFromDb(selectedSourceId, objectItem.name, describe);
      // 默认排序字段：仅从“可排序字段”中选择优先级最高的一项。
      const defaultSortField = pickDefaultSortField(getSortableFieldNames(describe));

      patchTab(objectItem.name, (tab) => ({
        ...tab,
        describe,
        sortField: defaultSortField,
        columnVisibility: persistedVisibility
      }));

      await queryTabData(objectItem.name, describe, "", defaultSortField, 200, "DESC");
    } catch (error) {
      patchTab(objectItem.name, (tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `打开对象失败：${String(error)}` }
      }));
    }
  }

  async function queryTabData(
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC"
  ) {
    if (!selectedSourceId) return;
    const tab = tabs.find((item) => item.objectName === objectName);
    if (!tab && !describeOverride) return;

    const describe = describeOverride ?? tab?.describe;
    if (!describe) return;

    const whereClause = (whereOverride ?? tab?.whereClause ?? "").trim();
    const limit = Math.max(1, Math.min(2000, limitOverride ?? tab?.limit ?? 200));
    const sortableFieldSet = new Set(getSortableFieldNames(describe));
    const rawSortField = (sortFieldOverride ?? tab?.sortField ?? "").trim();
    // 排序字段兜底：仅允许使用字段元数据中 sortable=true 的字段，否则视为“不排序”。
    const sortField = sortableFieldSet.has(rawSortField) ? rawSortField : "";
    const sortDirection = directionOverride ?? tab?.sortDirection ?? "DESC";
    const visibility = tab?.columnVisibility ?? {};
    const selectedFields = describe.fields
      .map((field) => field.name)
      .filter((name) => (visibility[name] ?? true) === true);

    if (selectedFields.length === 0) {
      patchTab(objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `${objectName} 至少要勾选一个字段。` },
        loading: false
      }));
      return;
    }

    patchTab(objectName, (item) => ({ ...item, loading: true, whereClause, limit, sortField, sortDirection }));

    try {
      const soql = buildQuerySoql(objectName, selectedFields, whereClause, sortField, sortDirection, limit);
      const rawResult = await api.queryRecords(selectedSourceId, soql);
      const result = normalizeQueryResult(rawResult);

      patchTab(objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        pendingDeleteRecordIds: [],
        currentSoql: soql,
        soqlDraft: soql,
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
        notice: { type: "success", message: `${objectName} 查询成功，共 ${result.totalSize} 条。` }
      }));
      appendTabLog(objectName, {
        action: "QUERY",
        success: true,
        request: soql,
        summary: `查询成功，返回 ${result.totalSize} 条。`
      });
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `${objectName} 查询失败：${String(error)}` }
      }));
      appendTabLog(objectName, {
        action: "QUERY",
        success: false,
        request: `object=${objectName}, where=${whereClause}, sort=${sortField ? `${sortField} ${sortDirection}` : "无排序"}, limit=${limit}`,
        summary: "查询失败。",
        errorMessage: String(error)
      });
    }
  }

  async function deleteCheckedRecords() {
    if (!selectedSourceId || !activeTab) return;
    if (activeTab.selectedRecordIds.length === 0) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: "请先勾选要删除的记录。" }
      }));
      return;
    }

    // 删除按钮仅标记待删除，真正删除由“执行更新”统一提交。
    try {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        pendingDeleteRecordIds: Array.from(new Set([...item.pendingDeleteRecordIds, ...item.selectedRecordIds])),
        selectedRecordIds: [],
        notice: { type: "success", message: `已标记 ${activeTab.selectedRecordIds.length} 条记录，执行更新时删除。` }
      }));
      appendTabLog(activeTab.objectName, {
        action: "DELETE",
        success: true,
        request: `recordIds=${activeTab.selectedRecordIds.join(",")}`,
        summary: `已标记删除 ${activeTab.selectedRecordIds.length} 条，待执行更新提交。`
      });
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `标记删除失败：${String(error)}` }
      }));
      appendTabLog(activeTab.objectName, {
        action: "DELETE",
        success: false,
        request: `recordIds=${activeTab.selectedRecordIds.join(",")}`,
        summary: "标记删除失败。",
        errorMessage: String(error)
      });
    }
  }

  async function executeCustomSoql() {
    if (!selectedSourceId || !activeTab) return;
    if (!activeTab.soqlDraft.trim()) {
      patchTab(activeTab.objectName, (item) => ({ ...item, notice: { type: "error", message: "SOQL 不能为空。" } }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      const rawResult = await api.queryRecords(selectedSourceId, activeTab.soqlDraft);
      const result = normalizeQueryResult(rawResult);
      const nextVisibility = buildVisibilityFromSoql(activeTab.soqlDraft, activeTab.describe, activeTab.columnVisibility);

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        pendingDeleteRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility,
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` }
      }));
      appendTabLog(activeTab.objectName, {
        action: "SOQL",
        success: true,
        request: activeTab.soqlDraft,
        summary: `执行成功，返回 ${result.totalSize} 条。`
      });
      await persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行 SOQL 失败：${String(error)}` }
      }));
      appendTabLog(activeTab.objectName, {
        action: "SOQL",
        success: false,
        request: activeTab.soqlDraft,
        summary: "执行 SOQL 失败。",
        errorMessage: String(error)
      });
    }
  }

  async function toggleDrawerForActiveTab() {
    if (!activeTab || !selectedSourceId) return;

    const nextOpen = !activeTab.showDrawer;
    if (!nextOpen) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: false }));
      return;
    }

    if (activeTab.describe) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true }));
      return;
    }

    // 抽屉打开时兜底拉取字段元数据，避免出现空白面板。
    patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true, loading: true }));
    try {
      const describe = await api.describeObject(selectedSourceId, activeTab.objectName);
      const visibility = await loadColumnVisibilityFromDb(selectedSourceId, activeTab.objectName, describe);
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        describe,
        columnVisibility: visibility,
        loading: false
      }));
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `加载字段元数据失败：${String(error)}` }
      }));
    }
  }

  function createRecordQuickly() {
    if (!activeTab) return;

    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchTab(activeTab.objectName, (item) => ({
      ...item,
      result: {
        ...item.result,
        records: [{ __localId: tempId, __isNew: true }, ...item.result.records]
      },
      notice: { type: "success", message: "已新增一行，请填写后点击执行更新。" }
    }));
  }

  async function applyPendingChanges() {
    if (!selectedSourceId || !activeTab || !activeTab.describe) return;
    if (!hasPendingChanges(activeTab)) return;

    const editableFields = new Set(activeTab.describe.fields.map((field) => field.name));
    const dirtyCellSet = new Set(activeTab.dirtyCellKeys);
    const pendingDeleteSet = new Set(activeTab.pendingDeleteRecordIds);
    const creates: Record<string, unknown>[] = [];
    const updates: { recordId: string; values: Record<string, unknown> }[] = [];
    const deletes: string[] = [];

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      for (let rowIndex = 0; rowIndex < activeTab.result.records.length; rowIndex += 1) {
        const record = activeTab.result.records[rowIndex];
        const recordKey = getRecordKey(record, rowIndex);
        const isNewRow = Boolean(record.__isNew);

        if (isNewRow) {
          const values: Record<string, unknown> = {};
          Object.entries(record).forEach(([field, raw]) => {
            if (field.startsWith("__") || field === "Id" || !editableFields.has(field)) return;
            if (raw === null || raw === undefined || String(raw).trim() === "") return;
            values[field] = raw;
          });
          creates.push(values);
          continue;
        }

        const recordId = String(record.Id ?? "");
        if (!recordId) continue;
        if (pendingDeleteSet.has(recordId)) {
          // 已标记待删除的记录不再参与更新，只在删除阶段提交。
          deletes.push(recordId);
          continue;
        }

        const values: Record<string, unknown> = {};
        dirtyCellSet.forEach((cellKey) => {
          const splitIndex = cellKey.indexOf(":");
          if (splitIndex < 0) return;
          const key = cellKey.slice(0, splitIndex);
          const field = cellKey.slice(splitIndex + 1);
          if (key !== recordKey || field === "Id" || !editableFields.has(field)) return;
          values[field] = record[field];
        });

        if (Object.keys(values).length > 0) {
          updates.push({ recordId, values });
        }
      }

      if (creates.length > 0 || updates.length > 0) {
        await api.saveRecords({
          sourceId: selectedSourceId,
          objectName: activeTab.objectName,
          creates,
          updates
        });
      }
      if (deletes.length > 0) {
        await Promise.all(
          deletes.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId))
        );
      }
      appendTabLog(activeTab.objectName, {
        action: "UPSERT",
        success: true,
        request: `creates=${creates.length}, updates=${updates.length}, deletes=${deletes.length}`,
        summary: `执行更新成功，新增 ${creates.length} 条，更新 ${updates.length} 条，删除 ${deletes.length} 条。`
      });

      await queryTabData(activeTab.objectName);
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "success", message: "执行更新成功，变更已提交。" }
      }));
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行更新失败：${String(error)}` }
      }));
      appendTabLog(activeTab.objectName, {
        action: "UPSERT",
        success: false,
        request: `creates=${creates.length}, updates=${updates.length}, deletes=${deletes.length}`,
        summary: "执行更新失败。",
        errorMessage: String(error)
      });
    }
  }

  function discardPendingChanges() {
    if (!activeTab) return;
    if (!hasPendingChanges(activeTab)) return;
    const revertedNewCount = activeTab.result.records.filter((record) => Boolean(record.__isNew)).length;
    const revertedDirtyCount = activeTab.dirtyCellKeys.length;
    const revertedDeleteCount = activeTab.pendingDeleteRecordIds.length;

    patchTab(activeTab.objectName, (item) => {
      const revertedRecords = item.result.records
        .filter((record) => !record.__isNew)
        .map((record, index) => {
          const key = getRecordKey(record, index);
          const baseline = item.baselineRecords[key];
          return baseline ? { ...baseline } : { ...record };
        });

      return {
        ...item,
        result: { ...item.result, records: revertedRecords },
        dirtyCellKeys: [],
        pendingDeleteRecordIds: [],
        selectedRecordIds: [],
        notice: { type: "success", message: "已撤回未提交修改。" }
      };
    });
    appendTabLog(activeTab.objectName, {
      action: "DISCARD",
      success: true,
      request: `newRows=${revertedNewCount}, dirtyCells=${revertedDirtyCount}, pendingDeletes=${revertedDeleteCount}`,
      summary: `撤回成功，已撤销新增 ${revertedNewCount} 条、编辑 ${revertedDirtyCount} 个单元格、待删除 ${revertedDeleteCount} 条。`
    });
  }

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

  const pageLoading = loading || sourcesFetching || objectsFetching;
  const visibleColumns = activeTab ? getVisibleColumns(activeTab) : [];
  const loadingText = tokenRefreshing ? "重新获取认证凭证中..." : "Loading...";
  const fieldMetadataMap = activeTab
    ? activeTab.describe?.fields.reduce(
        (acc, field) => ({ ...acc, [field.name]: field.metadata || {} }),
        {} as Record<string, Record<string, unknown>>
      ) || {}
    : {};
  const activeTabHasPendingChanges = activeTab ? hasPendingChanges(activeTab) : false;

  return (
    // 页面容器：用于承载主布局与启动遮罩层。
    <div className="relative h-full w-full">
      <MainLayout
        navRail={
          <div className="flex flex-col items-center gap-1 py-2">
            <button
              className={`tool-rail-btn ${viewMode === "query" ? "tool-rail-btn--active" : ""}`}
              title="Query 布局"
              onClick={() => setViewMode("query")}
            >
                <Table2 size={16} />
            </button>
            <button
              className={`tool-rail-btn ${viewMode === "soqlExecutor" ? "tool-rail-btn--active" : ""}`}
              title="SOQL 执行器"
              onClick={() => setViewMode("soqlExecutor")}
            >
                <Braces size={16} />
            </button>
            <button
              className={`tool-rail-btn ${viewMode === "systemLogs" ? "tool-rail-btn--active" : ""}`}
              title="系统日志"
              onClick={() => setViewMode("systemLogs")}
            >
                <ScrollText size={16} />
            </button>
            <button
              className={`tool-rail-btn ${viewMode === "settings" ? "tool-rail-btn--active" : ""}`}
              title="设置"
              onClick={() => setViewMode("settings")}
            >
                <Settings size={16} />
            </button>
          </div>
        }
        content={
          <>
            {viewMode === "query" && (
              <div className="grid h-full w-full grid-cols-[320px_1fr] overflow-hidden">
                <div className="flex min-h-0 flex-col border-r border-base-300">
                  <LeftSidebar
                    sources={sources}
                    selectedSourceId={selectedSourceId}
                    pageLoading={pageLoading}
                    objectsLoading={Boolean(selectedSourceId) && objectsFetching}
                    onOpenAuthWindow={openAuthWindow}
                    onChangeSource={handleSourceChange}
                    onRefreshSources={() => void refreshSources(true)}
                    objects={objects}
                    activeTabObjectName={activeTabObjectName}
                    onOpenObject={(item) => void openObjectTab(item)}
                    onNotQueryableObjectClick={handleNotQueryableObjectClick}
                    objectListMode="list"
                  />
                </div>
                <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                  <RightWorkspace
                    selectedSourceId={selectedSourceId}
                    tabs={tabs}
                    activeTabObjectName={activeTabObjectName}
                    activeTab={activeTab}
                    workspaceNotice={workspaceNotice}
                    visibleColumns={visibleColumns}
                    fieldMetadataMap={fieldMetadataMap}
                    hasPendingChanges={activeTabHasPendingChanges}
                    pendingDeleteRecordIds={activeTab?.pendingDeleteRecordIds ?? []}
                    onActivateTab={setActiveTabObjectName}
                    onCloseTab={closeTab}
                    onCloseCurrentTab={closeTab}
                    onCloseLeftTabs={closeLeftTabs}
                    onCloseRightTabs={closeRightTabs}
                    onCloseOtherTabs={closeOtherTabs}
                    onCloseAllTabs={closeAllTabs}
                    onCreateRecord={createRecordQuickly}
                    onDeleteCheckedRecords={() => void deleteCheckedRecords()}
                    onApplyPendingChanges={() => void applyPendingChanges()}
                    onDiscardPendingChanges={discardPendingChanges}
                    onToggleDrawer={() => void toggleDrawerForActiveTab()}
                    onToggleQueryBar={() => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, showQueryBar: !item.showQueryBar }));
                    }}
                    onToggleLogs={() => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, showLogs: !item.showLogs }));
                    }}
                    onWhereChange={(value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, whereClause: value }));
                    }}
                    onLimitChange={(value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, limit: value }));
                    }}
                    onSortFieldChange={(value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, sortField: value }));
                    }}
                    onSortDirectionChange={(value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, sortDirection: value }));
                    }}
                    onQuery={() => {
                      if (!activeTab) return;
                      void queryTabData(
                        activeTab.objectName,
                        activeTab.describe || undefined,
                        activeTab.whereClause,
                        activeTab.sortField,
                        activeTab.limit,
                        activeTab.sortDirection
                      );
                    }}
                    onToggleRecord={(recordId, checked) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        selectedRecordIds: checked
                          ? Array.from(new Set([...item.selectedRecordIds, recordId]))
                          : item.selectedRecordIds.filter((id) => id !== recordId)
                      }));
                    }}
                    onToggleAllRecords={(checked, recordIds) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, selectedRecordIds: checked ? recordIds : [] }));
                    }}
                    onEditCell={(rowIndex, columnName, value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => {
                        const nextRecords = [...item.result.records];
                        const target = nextRecords[rowIndex];
                        if (!target) return item;

                        const nextRecord = { ...target, [columnName]: value };
                        const recordKey = getRecordKey(nextRecord, rowIndex);
                        const cellKey = `${recordKey}:${columnName}`;
                        const dirtySet = new Set(item.dirtyCellKeys);
                        const isNewRow = Boolean(nextRecord.__isNew);
                        if (isNewRow) {
                          dirtySet.add(cellKey);
                        } else {
                          const baselineValue = stringifyComparableValue(item.baselineRecords[recordKey]?.[columnName]);
                          const nextValue = stringifyComparableValue(value);
                          if (baselineValue === nextValue) {
                            dirtySet.delete(cellKey);
                          } else {
                            dirtySet.add(cellKey);
                          }
                        }

                        nextRecords[rowIndex] = nextRecord;
                        return {
                          ...item,
                          result: { ...item.result, records: nextRecords },
                          dirtyCellKeys: Array.from(dirtySet)
                        };
                      });
                    }}
                    onShowMessage={(message) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        notice: { type: "error", message }
                      }));
                    }}
                    onToggleAllFields={() => {
                      if (!activeTab?.describe) return;
                      const allSelected = activeTab.describe.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true);
                      const nextChecked = !allSelected;
                      const nextVisibility = activeTab.describe.fields.reduce((acc, field) => {
                        acc[field.name] = nextChecked;
                        return acc;
                      }, {} as Record<string, boolean>);
                      patchTab(activeTab.objectName, (item) => ({ ...item, columnVisibility: nextVisibility }));
                      if (selectedSourceId) {
                        void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                      }
                    }}
                    onToggleFieldVisibility={(fieldName, checked) => {
                      if (!activeTab) return;
                      const nextVisibility = { ...activeTab.columnVisibility, [fieldName]: checked };
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        columnVisibility: nextVisibility
                      }));
                      if (selectedSourceId) {
                        void persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                      }
                    }}
                    onSoqlChange={(value) => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, soqlDraft: value }));
                    }}
                    onExecuteCustomSoql={() => void executeCustomSoql()}
                    onCloseWorkspaceNotice={clearWorkspaceNotice}
                    onCloseActiveTabNotice={() => {
                      if (!activeTab) return;
                      patchTab(activeTab.objectName, (item) => ({ ...item, notice: null }));
                    }}
                    loadingText={loadingText}
                    objectNames={objects.filter((item) => item.queryable).map((item) => item.name)}
                  />
                </div>
              </div>
            )}

            {/* SOQL 执行器面板：始终挂载，切换左侧导航时仅隐藏，避免内容与结果被清理。 */}
            <div className={viewMode === "soqlExecutor" ? "flex h-full w-full overflow-hidden" : "hidden h-full w-full"}>
              {/* 左侧沿用数据源/对象面板：便于在编写 SOQL 时参考对象信息。 */}
              <div className="relative flex min-h-0 flex-col border-r border-base-300" style={{ width: soqlSidebarWidth }}>
                <LeftSidebar
                  sources={sources}
                  selectedSourceId={selectedSourceId}
                  pageLoading={pageLoading}
                  objectsLoading={Boolean(selectedSourceId) && objectsFetching}
                  onOpenAuthWindow={openAuthWindow}
                  onChangeSource={handleSourceChange}
                  onRefreshSources={() => void refreshSources(true)}
                  objects={objects}
                  activeTabObjectName={activeTabObjectName}
                  onOpenObject={(item) => void openObjectTab(item)}
                  onNotQueryableObjectClick={handleNotQueryableObjectClick}
                  objectListMode="tree"
                />
                {/* 透明拖拽热区：视觉保持原样，仅提供宽度调整能力。 */}
                <div
                  className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize"
                  role="separator"
                  aria-orientation="vertical"
                  aria-label="拖拽调整侧栏宽度"
                  onMouseDown={(event) => {
                    event.preventDefault(); // 阻止拖拽起点触发文本选中。
                    soqlResizeStartXRef.current = event.clientX; // 记录本次拖拽起点 X。
                    soqlResizeStartWidthRef.current = soqlSidebarWidth; // 记录本次拖拽起始宽度。
                    setSoqlSidebarResizing(true); // 进入拖拽状态。
                  }}
                />
              </div>
              {/* 右侧 SOQL 执行器：多 Tab、执行、结果/层级/日志。 */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
                <SoqlExecutorWorkspace selectedSourceId={selectedSourceId} loadingText={loadingText} objects={objects} />
              </div>
            </div>

            {viewMode === "systemLogs" && <SystemLogsPanel />}
            {viewMode === "settings" && <SettingsPanel />}
          </>
        }
      />
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
  const whereSegment = whereClause.trim() ? ` WHERE ${whereClause.trim()}` : "";
  // 当排序字段为空时，明确不拼接 ORDER BY，避免生成无效 SOQL。
  const orderBySegment = sortField.trim() ? ` ORDER BY ${sortField} ${sortDirection}` : "";
  return `SELECT ${fields.join(", ")} FROM ${objectName}${whereSegment}${orderBySegment} LIMIT ${limit}`;
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
