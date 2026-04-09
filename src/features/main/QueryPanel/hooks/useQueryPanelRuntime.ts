import { useCallback } from "react";
import { api } from "../../../../api";
import { buildObjectTabBindingKey, ObjectDescribe, ObjectDdl, TabLog, TabState, SalesforceObject, SalesforceSource } from "../../../../types";
import { getSourceColor } from "../logic/sourceColor.ts";
import { useAppStore } from "../../../../store/useAppStore";

type MysqlDdlState = Record<string, { loading: boolean; data: ObjectDdl | null; error: string }>;

// MySQL 新增行必填字段缺失信息。
type MysqlMissingRequiredFieldItem = {
  // 行号（从 1 开始，便于用户在表格里定位）。
  row: number;
  // 当前行缺失的字段名列表。
  fields: string[];
};

// 判断单元格值是否可视为“未输入”。
function isBlankCellValue(value: unknown): boolean {
  // null/undefined 统一视为空。
  if (value === null || value === undefined) return true;
  // 字符串去掉空白后为空，也视为未输入。
  if (typeof value === "string") return value.trim() === "";
  return false;
}

// 收集 MySQL 新增行中“NOT NULL 且无默认值”的缺失字段。
function collectMysqlMissingRequiredFields(
  records: Record<string, unknown>[],
  describe: ObjectDescribe
): MysqlMissingRequiredFieldItem[] {
  // 只校验创建时可写、非可空、无默认值，且排除自增/生成列。
  const requiredFields = describe.fields.filter((field) => {
    if (!field.createable || field.nillable) return false;
    const defaultValue = field.metadata?.columnDefault;
    if (defaultValue !== null && defaultValue !== undefined) return false;
    const extraText = String(field.metadata?.extra || "").toLowerCase();
    if (extraText.includes("auto_increment") || extraText.includes("generated")) return false;
    return true;
  });
  if (requiredFields.length === 0) return [];

  const missingItems: MysqlMissingRequiredFieldItem[] = [];
  records.forEach((record, rowIndex) => {
    // 仅对前端本地新增行做必填校验。
    if (!record.__isNew) return;
    const missingFieldNames = requiredFields
      .filter((field) => isBlankCellValue(record[field.name]))
      .map((field) => field.name);
    if (missingFieldNames.length > 0) {
      missingItems.push({ row: rowIndex + 1, fields: missingFieldNames });
    }
  });
  return missingItems;
}

// 收集 Salesforce 新增行中“创建必填字段”的缺失字段。
function collectSalesforceMissingRequiredFields(
  records: Record<string, unknown>[],
  describe: ObjectDescribe
): MysqlMissingRequiredFieldItem[] {
  // Salesforce 必填判定：可创建 + 不可空；并排除“系统默认赋值/自动编号/公式字段”。
  const requiredFields = describe.fields.filter((field) => {
    if (!field.createable || field.nillable) return false;
    if (field.metadata?.defaultedOnCreate === true) return false;
    if (field.metadata?.autoNumber === true) return false;
    if (field.metadata?.calculated === true) return false;
    return true;
  });
  if (requiredFields.length === 0) return [];

  const missingItems: MysqlMissingRequiredFieldItem[] = [];
  records.forEach((record, rowIndex) => {
    // 仅校验本地新增行，避免影响普通更新场景。
    if (!record.__isNew) return;
    const missingFieldNames = requiredFields
      .filter((field) => isBlankCellValue(record[field.name]))
      .map((field) => field.name);
    if (missingFieldNames.length > 0) {
      missingItems.push({ row: rowIndex + 1, fields: missingFieldNames });
    }
  });
  return missingItems;
}

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
  patchTab: (tabIdentity: string, updater: (tab: TabState) => TabState) => void;
  // 追加 Tab 日志。
  appendTabLog: (tabIdentity: string, payload: Omit<TabLog, "id" | "timestamp">) => void;
  // 执行对象查询。
  queryTabData: (
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC",
    sortClauseOverride?: string,
    fallbackTab?: TabState
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

type ReloadTabOptions = {
  // 当历史快照缺少 sourceId 时，允许调用方注入兜底数据源。
  fallbackSourceId?: string;
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
  // 解析 Tab 实际绑定的数据源 ID：优先使用 Tab 快照，其次回退到默认数据源。
  const resolveTabSourceId = useCallback((tab: TabState, fallbackSourceId = "") => {
    return tab.sourceId || fallbackSourceId || selectedSourceId;
  }, [selectedSourceId]);

  // 解析 Tab 稳定身份：优先使用 bindingKey，兼容历史快照只保存 objectName 的场景。
  const resolveTabIdentity = useCallback((tab: TabState, fallbackSourceId = "") => {
    return tab.bindingKey || buildObjectTabBindingKey(resolveTabSourceId(tab, fallbackSourceId), tab.objectName);
  }, [resolveTabSourceId]);

  // 打开对象：若不存在则新建 Tab 并加载 describe + 首次查询。
  const openObjectTab = useCallback(
    async (objectItem: SalesforceObject, sourceOverride?: SalesforceSource) => {
      const targetSourceId = sourceOverride?.id || selectedSourceId;
      const targetSourceType = String(sourceOverride?.sourceType || selectedSourceType || "salesforce");
      if (!targetSourceId) return;

      const bindingKey = buildObjectTabBindingKey(targetSourceId, objectItem.name);
      const existed = tabs.find(
        (tab) => (tab.bindingKey || buildObjectTabBindingKey(tab.sourceId || targetSourceId, tab.objectName)) === bindingKey
      );
      if (existed) {
        setActiveTabObjectName(bindingKey);
        return;
      }

      // 新建对象 Tab 时补齐 source 名称和颜色，确保跨 source 恢复时绑定信息完整。
      let sourceName = sourceOverride?.name || "";
      let sourceColor = sourceOverride ? getSourceColor(sourceOverride) : "";
      try {
        if (!sourceName || !sourceColor) {
          const sources = await api.listSources();
          const currentSource = sources.find((source) => source.id === targetSourceId) || null;
          sourceName = sourceName || currentSource?.name || "";
          sourceColor = sourceColor || (currentSource ? getSourceColor(currentSource) : "");
        }
      } catch {
        // 元信息读取失败不阻塞打开流程，保持空值回退。
      }

      const newTab: TabState = {
        bindingKey,
        sourceId: targetSourceId,
        sourceType: targetSourceType,
        sourceName,
        sourceColor,
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
        drawerView: targetSourceType.toLowerCase() === "mysql" ? "mysql-ddl" : "salesforce",
        showLogs: false,
        logs: [],
        columnVisibility: {},
        dirtyCellKeys: [],
        baselineRecords: {},
        notice: null,
        loading: true
      };

      setTabs((current) => [...current, newTab]);
      setActiveTabObjectName(bindingKey);

      try {
        const describe = await api.describeObject(targetSourceId, objectItem.name);
        const persistedVisibility = await loadColumnVisibilityFromDb(targetSourceId, objectItem.name, describe);
        const defaultSortField = pickDefaultSortField(getSortableFieldNames(describe));

        patchTab(bindingKey, (tab) => ({
          ...tab,
          describe,
          sortField: defaultSortField,
          columnVisibility: persistedVisibility
        }));

        await queryTabData(bindingKey, describe, "", defaultSortField, 200, "DESC", undefined, newTab);
      } catch (error) {
        patchTab(bindingKey, (tab) => ({
          ...tab,
          loading: false,
          notice: { type: "error", message: `打开对象失败：${String(error)}` }
        }));
      }
    },
    [
      selectedSourceId,
      selectedSourceType,
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
    async (tab: TabState, options?: ReloadTabOptions) => {
      const { patchTab: storePatchTab } = useAppStore.getState();
      const resolvedSourceId = resolveTabSourceId(tab, options?.fallbackSourceId);
      if (!resolvedSourceId) return;
      const tabBindingKey = resolveTabIdentity(tab, options?.fallbackSourceId);
      try {
        storePatchTab(tabBindingKey, (t) => ({ ...t, loading: true }));
        const describe = await api.describeObject(resolvedSourceId, tab.objectName);

        const defaults = describe.fields.reduce((acc, field) => ({ ...acc, [field.name]: true }), {} as Record<string, boolean>);
        let visibility: Record<string, boolean>;
        try {
          const stored = await api.getColumnVisibility(resolvedSourceId, tab.objectName);
          visibility = { ...defaults, ...stored };
        } catch {
          visibility = defaults;
        }

        storePatchTab(tabBindingKey, (t) => ({ ...t, describe, columnVisibility: visibility }));
        const freshTab = useAppStore.getState().tabs.find((t) => {
          const currentBindingKey = resolveTabIdentity(t, resolvedSourceId);
          return currentBindingKey === tabBindingKey;
        });
        if (!freshTab) return;

        const whereClause = (freshTab.whereClause ?? "").trim();
        const limit = Math.max(1, Math.min(2000, freshTab.limit ?? 200));
        const normalizedType = String(freshTab.sourceType || selectedSourceType || "salesforce").toLowerCase();
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
          storePatchTab(tabBindingKey, (t) => ({
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
        const rawResult = await api.queryRecords(resolvedSourceId, soql, freshTab.objectName);
        const result = normalizeQueryResult(rawResult);

        storePatchTab(tabBindingKey, (t) => ({
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
        appendTabLog(tabBindingKey, {
          action: "QUERY",
          success: true,
          request: soql,
          summary: `恢复查询成功，返回 ${result.totalSize} 条。`
        });
      } catch (error) {
        const { patchTab: storePatchTab } = useAppStore.getState();
        storePatchTab(tabBindingKey, (t) => ({
          ...t,
          loading: false,
          notice: { type: "error", message: `恢复 ${tab.objectName} 数据失败：${String(error)}` }
        }));
      }
    },
    [
      resolveTabSourceId,
      resolveTabIdentity,
      selectedSourceType,
      getSortableFieldNames,
      buildQueryStatement,
      normalizeQueryResult,
      buildBaselineRecords,
      appendTabLog
    ]
  );

  // 启动后恢复持久化 Tabs：优先恢复激活 Tab，其余并发加载。
  const reloadRestoredTabs = useCallback(
    async (fallbackSourceId = "") => {
      const restoredTabs = useAppStore.getState().tabs;
      const activeTabIdentity = useAppStore.getState().activeTabObjectName;
      if (restoredTabs.length === 0) return;

      const runnableTabs = restoredTabs.filter((tab) => Boolean(resolveTabSourceId(tab, fallbackSourceId)));
      if (runnableTabs.length === 0) return;

      const active = runnableTabs.find(
        (tab) => resolveTabIdentity(tab, fallbackSourceId) === activeTabIdentity || tab.objectName === activeTabIdentity
      );
      if (active) {
        await reloadSingleTab(active, { fallbackSourceId });
      }
      const remainingTabs = runnableTabs.filter((tab) => {
        if (!active) return true;
        return resolveTabIdentity(tab, fallbackSourceId) !== resolveTabIdentity(active, fallbackSourceId);
      });
      if (remainingTabs.length > 0) {
        await Promise.allSettled(remainingTabs.map((tab) => reloadSingleTab(tab, { fallbackSourceId })));
      }
    },
    [reloadSingleTab, resolveTabIdentity, resolveTabSourceId]
  );

  // 刷新指定数据源下的所有已打开 Tab：用于手动刷新对象列表后同步重载字段元数据与查询结果。
  const reloadTabsForSource = useCallback(
    async (sourceId: string) => {
      if (!sourceId) return;

      const sourceTabs = useAppStore.getState().tabs.filter((tab) => resolveTabSourceId(tab, sourceId) === sourceId);
      if (sourceTabs.length === 0) return;

      const activeTabIdentity = useAppStore.getState().activeTabObjectName;
      const active = sourceTabs.find((tab) => resolveTabIdentity(tab, sourceId) === activeTabIdentity || tab.objectName === activeTabIdentity);

      if (active) {
        await reloadSingleTab(active, { fallbackSourceId: sourceId });
      }

      const remainingTabs = sourceTabs.filter((tab) => {
        if (!active) return true;
        return resolveTabIdentity(tab, sourceId) !== resolveTabIdentity(active, sourceId);
      });
      if (remainingTabs.length === 0) return;

      await Promise.allSettled(remainingTabs.map((tab) => reloadSingleTab(tab, { fallbackSourceId: sourceId })));
    },
    [reloadSingleTab, resolveTabIdentity, resolveTabSourceId]
  );

  // 加载指定对象的 MySQL DDL（建表/索引/约束）。
  const loadMysqlDdl = useCallback(
    async (objectName: string) => {
      const resolvedSourceId = activeTab?.sourceId || selectedSourceId;
      if (!resolvedSourceId) return;
      setMysqlDdlMap((state) => ({
        ...state,
        [objectName]: {
          loading: true,
          data: state[objectName]?.data || null,
          error: ""
        }
      }));
      try {
        const ddl = await api.getObjectDdl(resolvedSourceId, objectName);
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
    [activeTab?.sourceId, selectedSourceId, setMysqlDdlMap]
  );

  // 切换抽屉：支持按目标视图打开（MySQL DDL / MySQL 字段 / Salesforce）。
  const toggleDrawerForActiveTab = useCallback(async (drawerView?: "salesforce" | "mysql-ddl" | "mysql-fields") => {
    const resolvedSourceId = activeTab?.sourceId || selectedSourceId;
    const resolvedSourceType = activeTab?.sourceType || selectedSourceType || "salesforce";
    if (!activeTab || !resolvedSourceId) return;
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || resolvedSourceId, activeTab.objectName);
    const isMysqlSource = resolvedSourceType.toLowerCase() === "mysql";
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
      patchTab(activeTabBindingKey, (item) => ({ ...item, showDrawer: false, drawerView: targetDrawerView }));
      return;
    }

    if (targetDrawerView === "mysql-ddl") {
      patchTab(activeTabBindingKey, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView }));
      const ddlState = mysqlDdlMap[activeTab.objectName];
      if (!ddlState?.loading && !ddlState?.data) {
        await loadMysqlDdl(activeTab.objectName);
      }
      return;
    }

    // MySQL 字段抽屉与 Salesforce 抽屉都依赖 describe 字段元数据。
    if (activeTab.describe) {
      patchTab(activeTabBindingKey, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView }));
      return;
    }

    patchTab(activeTabBindingKey, (item) => ({ ...item, showDrawer: true, drawerView: targetDrawerView, loading: true }));
    try {
      const describe = await api.describeObject(resolvedSourceId, activeTab.objectName);
      const visibility = await loadColumnVisibilityFromDb(resolvedSourceId, activeTab.objectName, describe);
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        describe,
        columnVisibility: visibility,
        drawerView: targetDrawerView,
        loading: false
      }));
    } catch (error) {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `加载字段元数据失败：${String(error)}` }
      }));
    }
  }, [
    activeTab,
    selectedSourceType,
    patchTab,
    mysqlDdlMap,
    loadMysqlDdl,
    loadColumnVisibilityFromDb
  ]);

  // 标记删除勾选记录：仅前端标记，提交时再真正删除。
  const deleteCheckedRecords = useCallback(async () => {
    const resolvedSourceId = activeTab?.sourceId || selectedSourceId;
    if (!resolvedSourceId || !activeTab) return;
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || resolvedSourceId, activeTab.objectName);
    if (activeTab.selectedRecordIds.length === 0) {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        notice: { type: "error", message: "请先勾选要删除的记录。" }
      }));
      return;
    }

    try {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        pendingDeleteRecordIds: Array.from(new Set([...item.pendingDeleteRecordIds, ...item.selectedRecordIds])),
        selectedRecordIds: [],
        notice: { type: "success", message: `已标记 ${activeTab.selectedRecordIds.length} 条记录，执行更新时删除。` }
      }));
      appendTabLog(activeTabBindingKey, {
        action: "DELETE",
        success: true,
        request: `recordIds=${activeTab.selectedRecordIds.join(",")}`,
        summary: `已标记删除 ${activeTab.selectedRecordIds.length} 条，待执行更新提交。`
      });
    } catch (error) {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        notice: { type: "error", message: `标记删除失败：${String(error)}` }
      }));
      appendTabLog(activeTabBindingKey, {
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
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || selectedSourceId, activeTab.objectName);

    const tempId = `new-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    patchTab(activeTabBindingKey, (item) => ({
      ...item,
      result: {
        ...item.result,
        records: [{ __localId: tempId, __isNew: true }, ...item.result.records]
      },
      notice: { type: "success", message: "已新增一行，请填写后点击执行更新。" }
    }));
  }, [activeTab, patchTab, selectedSourceId]);

  // 执行新增/更新/删除提交。
  const applyPendingChanges = useCallback(async () => {
    const resolvedSourceId = activeTab?.sourceId || selectedSourceId;
    const resolvedSourceType = activeTab?.sourceType || selectedSourceType || "salesforce";
    if (!resolvedSourceId || !activeTab || !activeTab.describe) return;
    if (!hasPendingChanges(activeTab)) return;
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || resolvedSourceId, activeTab.objectName);

    const isMysqlSource = resolvedSourceType.toLowerCase() === "mysql";
    // MySQL 新增前置校验：必填字段缺失时直接提示并中断提交。
    if (isMysqlSource) {
      const mysqlMissingRequiredItems = collectMysqlMissingRequiredFields(activeTab.result.records, activeTab.describe);
      if (mysqlMissingRequiredItems.length > 0) {
        const message = `MySQL 新增失败：存在 NOT NULL 且无默认值字段未填写。${mysqlMissingRequiredItems
          .map((item) => `第 ${item.row} 行缺少 ${item.fields.join("、")}`)
          .join("；")}。`;
        patchTab(activeTabBindingKey, (item) => ({
          ...item,
          notice: { type: "error", message }
        }));
        return;
      }
    } else {
      // Salesforce 新增前置校验：创建必填字段缺失时直接提示并中断提交。
      const salesforceMissingRequiredItems = collectSalesforceMissingRequiredFields(activeTab.result.records, activeTab.describe);
      if (salesforceMissingRequiredItems.length > 0) {
        const message = `Salesforce 新增失败：存在创建必填字段未填写。${salesforceMissingRequiredItems
          .map((item) => `第 ${item.row} 行缺少 ${item.fields.join("、")}`)
          .join("；")}。`;
        patchTab(activeTabBindingKey, (item) => ({
          ...item,
          notice: { type: "error", message }
        }));
        return;
      }
    }

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

    patchTab(activeTabBindingKey, (item) => ({ ...item, loading: true }));
    try {
      for (let rowIndex = 0; rowIndex < activeTab.result.records.length; rowIndex += 1) {
        const record = activeTab.result.records[rowIndex];
        const recordKey = getRecordKey(record, rowIndex, {
          sourceType: resolvedSourceType,
          mysqlPrimaryKeyField
        });
        // 稳定基线键：编辑主键列后仍使用初始键定位 dirty/baseline，避免更新丢失。
        const baselineKeyFromRecord = typeof record.__baselineKey === "string" ? record.__baselineKey : "";
        const stableRecordKey = baselineKeyFromRecord || recordKey;
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
          // 记录键可能包含 ":"（例如时间字符串主键），因此按最后一个 ":" 分割字段名更安全。
          const splitIndex = cellKey.lastIndexOf(":");
          if (splitIndex < 0) return;
          const key = cellKey.slice(0, splitIndex);
          const field = cellKey.slice(splitIndex + 1);
          if (key !== stableRecordKey || field === "Id" || !editableFields.has(field)) return;
          values[field] = record[field];
        });

        const baselineRecord = activeTab.baselineRecords[stableRecordKey];
        const recordIdRaw = baselineRecord?.Id
          ?? (isMysqlSource && mysqlPrimaryKeyField ? baselineRecord?.[mysqlPrimaryKeyField] : undefined)
          ?? record.Id
          ?? (isMysqlSource && mysqlPrimaryKeyField ? record[mysqlPrimaryKeyField] : undefined);
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

      if (isMysqlSource) {
        // MySQL 下统一走单事务命令，确保新增/更新/删除原子提交。
        await api.saveRecordsWithDeletes({
          sourceId: resolvedSourceId,
          objectName: activeTab.objectName,
          creates,
          updates,
          deletes
        });
      } else {
        // Salesforce 仍使用现有拆分逻辑：新增/更新批量提交，删除逐条提交。
        if (creates.length > 0 || updates.length > 0) {
          await api.saveRecords({
            sourceId: resolvedSourceId,
            objectName: activeTab.objectName,
            creates,
            updates
          });
        }
        if (deletes.length > 0) {
          await Promise.all(
            deletes.map((recordId) => api.deleteRecord(resolvedSourceId, activeTab.objectName, recordId))
          );
        }
      }
      appendTabLog(activeTabBindingKey, {
        action: "UPSERT",
        success: true,
        request: `creates=${creates.length}, updates=${updates.length}, deletes=${deletes.length}`,
        summary: `执行更新成功，新增 ${creates.length} 条，更新 ${updates.length} 条，删除 ${deletes.length} 条。`
      });

      await queryTabData(activeTabBindingKey);
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        notice: { type: "success", message: "执行更新成功，变更已提交。" }
      }));
    } catch (error) {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行更新失败：${String(error)}` }
      }));
      appendTabLog(activeTabBindingKey, {
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
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(activeTab.sourceId || selectedSourceId, activeTab.objectName);
    const revertedNewCount = activeTab.result.records.filter((record) => Boolean(record.__isNew)).length;
    const revertedDirtyCount = activeTab.dirtyCellKeys.length;
    const revertedDeleteCount = activeTab.pendingDeleteRecordIds.length;

    patchTab(activeTabBindingKey, (item) => {
      const resolvedSourceType = activeTab.sourceType || selectedSourceType || "salesforce";
      const isMysqlSource = resolvedSourceType.toLowerCase() === "mysql";
      const mysqlPrimaryKeyField = isMysqlSource
        ? item.describe?.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
        : "";
      const revertedRecords: Record<string, unknown>[] = [];
      // 这里保留原始 rowIndex，避免先 filter 再 map 造成 row-索引键错位，导致回滚命中失败。
      item.result.records.forEach((record, index) => {
        if (record.__isNew) return;
        const keyFromRecord = typeof record.__baselineKey === "string" ? record.__baselineKey : "";
        const key = keyFromRecord || getRecordKey(record, index, {
          sourceType: resolvedSourceType,
          mysqlPrimaryKeyField
        });
        const baseline = item.baselineRecords[key];
        revertedRecords.push(baseline ? { ...baseline } : { ...record });
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
    appendTabLog(activeTabBindingKey, {
      action: "DISCARD",
      success: true,
      request: `newRows=${revertedNewCount}, dirtyCells=${revertedDirtyCount}, pendingDeletes=${revertedDeleteCount}`,
      summary: `撤回成功，已撤销新增 ${revertedNewCount} 条、编辑 ${revertedDirtyCount} 个单元格、待删除 ${revertedDeleteCount} 条。`
    });
  }, [activeTab, hasPendingChanges, selectedSourceType, patchTab, getRecordKey, appendTabLog, selectedSourceId]);

  return {
    openObjectTab,
    reloadRestoredTabs,
    reloadTabsForSource,
    loadMysqlDdl,
    toggleDrawerForActiveTab,
    deleteCheckedRecords,
    createRecordQuickly,
    applyPendingChanges,
    discardPendingChanges
  };
}
