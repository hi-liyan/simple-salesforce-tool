import { useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { useQueryClient } from "@tanstack/react-query";
import { api } from "../api";
import { LeftSidebar } from "../features/main/LeftSidebar";
import { RightWorkspace } from "../features/main/RightWorkspace";
import { MainLayout } from "../layouts/MainLayout";
import { useObjectsQuery, useSourcesQuery, useSyncSourcesMutation } from "../queries/salesforce";
import { useAppStore } from "../store/useAppStore";
import { Notice, ObjectDescribe, QueryResult, SalesforceObject, TabState } from "../types";

// 主页面：对象列表 + 结果面板 + SOQL 抽屉。
export function MainPage() {
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
  const closeTabInStore = useAppStore((state) => state.closeTab);
  const resetTabs = useAppStore((state) => state.resetTabs);

  // React Query：数据源与对象列表。
  const queryClient = useQueryClient();
  const { data: sources = [], isFetching: sourcesFetching } = useSourcesQuery();
  const { data: objects = [], isFetching: objectsFetching } = useObjectsQuery(selectedSourceId);
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

  // 初始化加载：进入页面时同步一次数据源列表。
  useEffect(() => {
    // 触发 CLI 同步刷新数据源。
    void refreshSources(true);
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
      if (preferredId && list.some((item) => item.id === preferredId)) {
        setSelectedSourceId(preferredId);
      } else if (!list.some((item) => item.id === selectedSourceId)) {
        setSelectedSourceId("");
      } else {
        setSelectedSourceId(selectedSourceId);
      }
    } catch (error) {
      patchActiveTabNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function handleSourceChange(sourceId: string) {
    setSelectedSourceId(sourceId);

    if (sourceNoticeTimerRef.current) {
      clearTimeout(sourceNoticeTimerRef.current);
    }

    if (!sourceId) {
      setWorkspaceNotice(null);
      return;
    }

    const selectedSource = sources.find((item) => item.id === sourceId);
    const sourceDisplayName = selectedSource?.name || sourceId;
    setWorkspaceNotice({
      type: "success",
      message: `已切换到数据源：${sourceDisplayName}`
    });
    sourceNoticeTimerRef.current = setTimeout(() => {
      setWorkspaceNotice(null);
      sourceNoticeTimerRef.current = null;
    }, 2600);
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
      const noticeChanged =
        (tab.notice?.type ?? "") !== (next.notice?.type ?? "") ||
        (tab.notice?.message ?? "") !== (next.notice?.message ?? "");

      if (next.notice && noticeChanged) {
        shouldAutoCloseNotice = true;
      }

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
      sortField: "Id",
      sortDirection: "DESC",
      selectedRecordIds: [],
      currentSoql: "",
      soqlDraft: "",
      showDrawer: false,
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
      const defaultSortField = describe.fields.find((field) => field.name === "LastModifiedDate")
        ? "LastModifiedDate"
        : describe.fields.find((field) => field.name === "CreatedDate")
          ? "CreatedDate"
          : describe.fields.find((field) => field.name === "Name")
            ? "Name"
            : "Id";

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
    const sortField = sortFieldOverride ?? tab?.sortField ?? "Id";
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
      const result = await api.queryRecords(selectedSourceId, soql);

      patchTab(objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: soql,
        soqlDraft: soql,
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
        notice: { type: "success", message: `${objectName} 查询成功，共 ${result.totalSize} 条。` }
      }));
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `${objectName} 查询失败：${String(error)}` }
      }));
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

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));

    try {
      await Promise.all(
        activeTab.selectedRecordIds.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId))
      );

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "success", message: `已删除 ${activeTab.selectedRecordIds.length} 条记录。` }
      }));
      await queryTabData(activeTab.objectName);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `批量删除失败：${String(error)}` }
      }));
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
      const result = await api.queryRecords(selectedSourceId, activeTab.soqlDraft);
      const nextVisibility = buildVisibilityFromSoql(activeTab.soqlDraft, activeTab.describe, activeTab.columnVisibility);

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility,
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records),
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` }
      }));
      await persistColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行 SOQL 失败：${String(error)}` }
      }));
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
    const creates: Record<string, unknown>[] = [];
    const updates: { recordId: string; values: Record<string, unknown> }[] = [];

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

      await api.saveRecords({
        sourceId: selectedSourceId,
        objectName: activeTab.objectName,
        creates,
        updates
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
    }
  }

  function discardPendingChanges() {
    if (!activeTab) return;
    if (!hasPendingChanges(activeTab)) return;

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
        selectedRecordIds: [],
        notice: { type: "success", message: "已撤回未提交修改。" }
      };
    });
  }

  function closeTab(objectName: string) {
    if (noticeTimersRef.current[objectName]) {
      clearTimeout(noticeTimersRef.current[objectName]);
      delete noticeTimersRef.current[objectName];
    }
    closeTabInStore(objectName);
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
  const fieldMetadataMap = activeTab
    ? activeTab.describe?.fields.reduce(
        (acc, field) => ({ ...acc, [field.name]: field.metadata || {} }),
        {} as Record<string, Record<string, unknown>>
      ) || {}
    : {};
  const activeTabHasPendingChanges = activeTab ? hasPendingChanges(activeTab) : false;

  return (
    <MainLayout
      leftSidebar={
        <LeftSidebar
          sources={sources}
          selectedSourceId={selectedSourceId}
          pageLoading={pageLoading}
          onOpenAuthWindow={openAuthWindow}
          onChangeSource={handleSourceChange}
          onRefreshSources={() => void refreshSources(true)}
          objects={objects}
          activeTabObjectName={activeTabObjectName}
          onOpenObject={(item) => void openObjectTab(item)}
        />
      }
      rightWorkspace={
        <RightWorkspace
          tabs={tabs}
          activeTabObjectName={activeTabObjectName}
          activeTab={activeTab}
          workspaceNotice={workspaceNotice}
          visibleColumns={visibleColumns}
          fieldMetadataMap={fieldMetadataMap}
          hasPendingChanges={activeTabHasPendingChanges}
          onActivateTab={setActiveTabObjectName}
          onCloseTab={closeTab}
          onCreateRecord={createRecordQuickly}
          onDeleteCheckedRecords={() => void deleteCheckedRecords()}
          onApplyPendingChanges={() => void applyPendingChanges()}
          onDiscardPendingChanges={discardPendingChanges}
          onToggleDrawer={() => void toggleDrawerForActiveTab()}
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
        />
      }
    />
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
  return `SELECT ${fields.join(", ")} FROM ${objectName}${whereSegment} ORDER BY ${sortField} ${sortDirection} LIMIT ${limit}`;
}

// 判断 Tab 是否存在未提交的变更。
function hasPendingChanges(tab: TabState): boolean {
  const hasNewRows = tab.result.records.some((record) => Boolean(record.__isNew));
  return hasNewRows || tab.dirtyCellKeys.length > 0;
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
