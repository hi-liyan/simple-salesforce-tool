import { useCallback } from "react";
import { api } from "../../../../api";
import { ObjectDescribe, ObjectDdl, TabLog, TabState, SalesforceObject } from "../../../../types";
import { useAppStore } from "../../../../store/useAppStore";

type MysqlDdlState = Record<string, { loading: boolean; data: ObjectDdl | null; error: string }>;

type UseQueryPanelRuntimeInput = {
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型。
  selectedSourceType: string;
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 当前 Query Tab 列表。
  tabs: TabState[];
  // 写入 Query Tab 列表。
  setTabs: (updater: (current: TabState[]) => TabState[]) => void;
  // 设置激活对象名。
  setActiveTabObjectName: (objectName: string) => void;
  // 通用 Tab 更新器。
  patchTab: (objectName: string, updater: (tab: TabState) => TabState) => void;
  // 追加 Tab 日志。
  appendTabLog: (objectName: string, payload: Omit<TabLog, "id" | "timestamp">) => void;
  // 执行对象查询。
  queryTabData: (
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC",
    sortClauseOverride?: string
  ) => Promise<void>;
  // 从 DB 读取字段可见性。
  loadColumnVisibilityFromDb: (
    sourceId: string,
    objectName: string,
    describe: ObjectDescribe
  ) => Promise<Record<string, boolean>>;
  // 获取可排序字段列表。
  getSortableFieldNames: (describe: ObjectDescribe) => string[];
  // 选择默认排序字段。
  pickDefaultSortField: (sortableFieldNames: string[]) => string;
  // 构建查询语句。
  buildQueryStatement: (
    sourceType: string,
    objectName: string,
    selectedFields: string[],
    whereClause: string,
    sortField: string,
    sortDirection: "ASC" | "DESC",
    limit: number,
    sortClause: string
  ) => string;
  // 归一化查询结果。
  normalizeQueryResult: (input: { totalSize: number; records: Record<string, unknown>[] }) => {
    totalSize: number;
    records: Record<string, unknown>[];
  };
  // 构建基线记录快照。
  buildBaselineRecords: (
    records: Record<string, unknown>[],
    options?: { sourceType?: string; mysqlPrimaryKeyField?: string }
  ) => Record<string, Record<string, unknown>>;
  // 判断是否存在未提交修改。
  hasPendingChanges: (tab: TabState) => boolean;
  // 获取记录唯一键。
  getRecordKey: (
    record: Record<string, unknown>,
    rowIndex: number,
    options?: { sourceType?: string; mysqlPrimaryKeyField?: string }
  ) => string;
  // MySQL DDL 映射。
  mysqlDdlMap: MysqlDdlState;
  // 写入 MySQL DDL 映射。
  setMysqlDdlMap: (updater: (state: MysqlDdlState) => MysqlDdlState) => void;
};

// QueryPanel 运行时行为：封装对象打开、恢复查询、抽屉与 DDL 加载逻辑。
export function useQueryPanelRuntime({
  selectedSourceId,
  selectedSourceType,
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
}: UseQueryPanelRuntimeInput) {
  // 打开对象：若不存在则新建 Tab 并加载 describe + 首次查询。
  const openObjectTab = useCallback(
    async (objectItem: SalesforceObject) => {
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
        sortClause: "",
        selectedRecordIds: [],
        pendingDeleteRecordIds: [],
        currentSoql: "",
        soqlDraft: "",
        showQueryBar: true,
        showDrawer: false,
        // 新建 Tab 时按数据源初始化抽屉视图：MySQL 默认先看 DDL。
        drawerView: (selectedSourceType || "salesforce").toLowerCase() === "mysql" ? "mysql-ddl" : "salesforce",
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
    },
    [
      selectedSourceId,
      tabs,
      setActiveTabObjectName,
      setTabs,
      loadColumnVisibilityFromDb,
      pickDefaultSortField,
      getSortableFieldNames,
      patchTab,
      queryTabData
    ]
  );

  // 重新拉取单个 Tab 的 describe + 字段可见性 + 查询结果。
  const reloadSingleTab = useCallback(
    async (sourceId: string, tab: TabState) => {
      const { patchTab: storePatchTab } = useAppStore.getState();
      try {
        storePatchTab(tab.objectName, (t) => ({ ...t, loading: true }));
        const describe = await api.describeObject(sourceId, tab.objectName);

        const defaults = describe.fields.reduce((acc, field) => ({ ...acc, [field.name]: true }), {} as Record<string, boolean>);
        let visibility: Record<string, boolean>;
        try {
          const stored = await api.getColumnVisibility(sourceId, tab.objectName);
          visibility = { ...defaults, ...stored };
        } catch {
          visibility = defaults;
        }

        storePatchTab(tab.objectName, (t) => ({ ...t, describe, columnVisibility: visibility }));
        const freshTab = useAppStore.getState().tabs.find((t) => t.objectName === tab.objectName);
        if (!freshTab) return;

        const whereClause = (freshTab.whereClause ?? "").trim();
        const limit = Math.max(1, Math.min(2000, freshTab.limit ?? 200));
        const normalizedType = (selectedSourceType || "salesforce").toLowerCase();
        // MySQL 恢复查询时补齐主键字段，确保基线键与表格高亮键一致。
        const mysqlPrimaryKeyField = normalizedType === "mysql"
          ? describe.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
          : "";
        const sortableFieldSet = new Set(getSortableFieldNames(describe));
        const sortField = sortableFieldSet.has(freshTab.sortField) ? freshTab.sortField : "";
        const sortDirection = freshTab.sortDirection ?? "DESC";
        const sortClause = (freshTab.sortClause ?? "").trim();
        const selectedFields = describe.fields
          .map((field) => field.name)
          .filter((name) => (visibility[name] ?? true) === true);

        if (selectedFields.length === 0) {
          storePatchTab(tab.objectName, (t) => ({
            ...t,
            loading: false,
            notice: { type: "error", message: `${tab.objectName} 至少要勾选一个字段。` }
          }));
          return;
        }

        const soql = buildQueryStatement(
          normalizedType,
          tab.objectName,
          selectedFields,
          whereClause,
          sortField,
          sortDirection,
          limit,
          sortClause
        );
        const rawResult = await api.queryRecords(sourceId, soql);
        const result = normalizeQueryResult(rawResult);

        storePatchTab(tab.objectName, (t) => ({
          ...t,
          result,
          loading: false,
          selectedRecordIds: [],
          pendingDeleteRecordIds: [],
          currentSoql: soql,
          soqlDraft: soql,
          dirtyCellKeys: [],
          baselineRecords: buildBaselineRecords(result.records, {
            sourceType: normalizedType,
            mysqlPrimaryKeyField
          }),
          notice: { type: "success", message: `${tab.objectName} 查询成功，共 ${result.totalSize} 条。` }
        }));
        appendTabLog(tab.objectName, {
          action: "QUERY",
          success: true,
          request: soql,
          summary: `恢复查询成功，返回 ${result.totalSize} 条。`
        });
      } catch (error) {
        const { patchTab: storePatchTab } = useAppStore.getState();
        storePatchTab(tab.objectName, (t) => ({
          ...t,
          loading: false,
          notice: { type: "error", message: `恢复 ${tab.objectName} 数据失败：${String(error)}` }
        }));
      }
    },
    [selectedSourceType, getSortableFieldNames, buildQueryStatement, normalizeQueryResult, buildBaselineRecords, appendTabLog]
  );

  // 启动后恢复持久化 Tabs：优先恢复激活 Tab，其余并发加载。
  const reloadRestoredTabs = useCallback(
    async (sourceId: string) => {
      const restoredTabs = useAppStore.getState().tabs;
      const activeObjectName = useAppStore.getState().activeTabObjectName;
      if (restoredTabs.length === 0 || !sourceId) return;

      const active = restoredTabs.find((t) => t.objectName === activeObjectName);
      if (active) {
        await reloadSingleTab(sourceId, active);
      }
      const remainingTabs = restoredTabs.filter((t) => t.objectName !== activeObjectName);
      if (remainingTabs.length > 0) {
        await Promise.allSettled(remainingTabs.map((tab) => reloadSingleTab(sourceId, tab)));
      }
    },
    [reloadSingleTab]
  );

  // 加载指定对象的 MySQL DDL（建表/索引/约束）。
  const loadMysqlDdl = useCallback(
    async (objectName: string) => {
      if (!selectedSourceId) return;
      setMysqlDdlMap((state) => ({
        ...state,
        [objectName]: {
          loading: true,
          data: state[objectName]?.data || null,
          error: ""
        }
      }));
      try {
        const ddl = await api.getObjectDdl(selectedSourceId, objectName);
        setMysqlDdlMap((state) => ({
          ...state,
          [objectName]: {
            loading: false,
            data: ddl,
            error: ""
          }
        }));
      } catch (error) {
        setMysqlDdlMap((state) => ({
          ...state,
          [objectName]: {
            loading: false,
            data: state[objectName]?.data || null,
            error: String(error)
          }
        }));
      }
    },
    [selectedSourceId, setMysqlDdlMap]
  );

  // 切换抽屉：支持按目标视图打开（MySQL DDL / MySQL 字段 / Salesforce）。
  const toggleDrawerForActiveTab = useCallback(async (drawerView?: "salesforce" | "mysql-ddl" | "mysql-fields") => {
    if (!activeTab || !selectedSourceId) return;
    const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
    // 目标视图推导：MySQL 默认 DDL，Salesforce 固定复合抽屉。
    const targetDrawerView = isMysqlSource
      ? drawerView === "mysql-fields"
        ? "mysql-fields"
        : "mysql-ddl"
      : "salesforce";
    // 兼容历史数据：旧快照缺少 drawerView 时按数据源回退默认值。
    const currentDrawerView = activeTab.drawerView || (isMysqlSource ? "mysql-ddl" : "salesforce");

    // 点击同一个按钮时直接关闭；点击另一个按钮时保持打开并切换抽屉内容。
    if (activeTab.showDrawer && currentDrawerView === targetDrawerView) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: false, drawerView: targetDrawerView }));
      return;
    }

    if (targetDrawerView === "mysql-ddl") {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView }));
      const ddlState = mysqlDdlMap[activeTab.objectName];
      if (!ddlState?.loading && !ddlState?.data) {
        await loadMysqlDdl(activeTab.objectName);
      }
      return;
    }

    // MySQL 字段抽屉与 Salesforce 抽屉都依赖 describe 字段元数据。
    if (activeTab.describe) {
      patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView, loading: true }));
    try {
      const describe = await api.describeObject(selectedSourceId, activeTab.objectName);
      const visibility = await loadColumnVisibilityFromDb(selectedSourceId, activeTab.objectName, describe);
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        describe,
        columnVisibility: visibility,
        drawerView: targetDrawerView,
        loading: false
      }));
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `加载字段元数据失败：${String(error)}` }
      }));
    }
  }, [
    activeTab,
    selectedSourceId,
    selectedSourceType,
    patchTab,
    mysqlDdlMap,
    loadMysqlDdl,
    loadColumnVisibilityFromDb
  ]);

  // 标记删除勾选记录：仅前端标记，提交时再真正删除。
  const deleteCheckedRecords = useCallback(async () => {
    if (!selectedSourceId || !activeTab) return;
    if (activeTab.selectedRecordIds.length === 0) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: "请先勾选要删除的记录。" }
      }));
      return;
    }

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
  }, [selectedSourceId, activeTab, patchTab, appendTabLog]);

  // 快速创建一行本地新增记录。
  const createRecordQuickly = useCallback(() => {
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
  }, [activeTab, patchTab]);

  // 执行新增/更新/删除提交。
  const applyPendingChanges = useCallback(async () => {
    if (!selectedSourceId || !activeTab || !activeTab.describe) return;
    if (!hasPendingChanges(activeTab)) return;

    const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
    const editableFields = new Set(activeTab.describe.fields.map((field) => field.name));
    const mysqlPrimaryKeyField = isMysqlSource
      ? activeTab.describe.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
      : "";
    const dirtyCellSet = new Set(activeTab.dirtyCellKeys);
    const pendingDeleteSet = new Set(activeTab.pendingDeleteRecordIds);
    const creates: Record<string, unknown>[] = [];
    const updates: { recordId: string; values: Record<string, unknown> }[] = [];
    const deletes: string[] = [];
    const missingRecordIdRows: number[] = [];

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      for (let rowIndex = 0; rowIndex < activeTab.result.records.length; rowIndex += 1) {
        const record = activeTab.result.records[rowIndex];
        const recordKey = getRecordKey(record, rowIndex, {
          sourceType: selectedSourceType,
          mysqlPrimaryKeyField
        });
        const isNewRow = Boolean(record.__isNew);

        if (isNewRow) {
          const values: Record<string, unknown> = {};
          Object.entries(record).forEach(([field, raw]) => {
            if (field.startsWith("__") || field === "Id" || !editableFields.has(field)) return;
            if (raw === null || raw === undefined || String(raw).trim() === "") return;
            values[field] = raw;
          });
          if (Object.keys(values).length > 0) {
            creates.push(values);
          }
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

        const recordIdRaw = record.Id ?? (isMysqlSource && mysqlPrimaryKeyField ? record[mysqlPrimaryKeyField] : undefined);
        const recordId = recordIdRaw === null || recordIdRaw === undefined ? "" : String(recordIdRaw).trim();
        if (!recordId) {
          if (isMysqlSource && Object.keys(values).length > 0) {
            missingRecordIdRows.push(rowIndex + 1);
          }
          continue;
        }
        if (pendingDeleteSet.has(recordId)) {
          deletes.push(recordId);
          continue;
        }

        if (Object.keys(values).length > 0) {
          updates.push({ recordId, values });
        }
      }

      if (missingRecordIdRows.length > 0) {
        throw new Error(
          `MySQL 更新失败：存在已编辑但缺少 Id 的行（第 ${missingRecordIdRows.join("、")} 行）。请确保查询结果包含主键列。`
        );
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
        await Promise.all(deletes.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId)));
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
  }, [selectedSourceId, activeTab, hasPendingChanges, selectedSourceType, patchTab, getRecordKey, appendTabLog, queryTabData]);

  // 撤销未提交修改：回滚到基线记录。
  const discardPendingChanges = useCallback(() => {
    if (!activeTab) return;
    if (!hasPendingChanges(activeTab)) return;
    const revertedNewCount = activeTab.result.records.filter((record) => Boolean(record.__isNew)).length;
    const revertedDirtyCount = activeTab.dirtyCellKeys.length;
    const revertedDeleteCount = activeTab.pendingDeleteRecordIds.length;

    patchTab(activeTab.objectName, (item) => {
      const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
      const mysqlPrimaryKeyField = isMysqlSource
        ? item.describe?.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
        : "";
      const revertedRecords = item.result.records
        .filter((record) => !record.__isNew)
        .map((record, index) => {
          const key = getRecordKey(record, index, {
            sourceType: selectedSourceType,
            mysqlPrimaryKeyField
          });
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
  }, [activeTab, hasPendingChanges, selectedSourceType, patchTab, getRecordKey, appendTabLog]);

  return {
    openObjectTab,
    reloadRestoredTabs,
    loadMysqlDdl,
    toggleDrawerForActiveTab,
    deleteCheckedRecords,
    createRecordQuickly,
    applyPendingChanges,
    discardPendingChanges
  };
}
