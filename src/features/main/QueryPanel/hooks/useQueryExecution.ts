import { useCallback } from "react";
import { api } from "../../../../api";
import { buildObjectTabBindingKey, ObjectDescribe, QueryResult, TabLog, TabState } from "../../../../types";

type UseQueryExecutionInput = {
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 当前选中数据源类型（salesforce/mysql）。
  selectedSourceType: string;
  // 当前 Query Tab 列表。
  tabs: TabState[];
  // 当前激活 Query Tab。
  activeTab: TabState | null;
  // 查询语言标签：SQL/SOQL。
  queryLanguageLabel: string;
  // 更新指定对象 Tab。
  patchTab: (tabIdentity: string, updater: (tab: TabState) => TabState) => void;
  // 追加 Tab 日志。
  appendTabLog: (tabIdentity: string, nextLog: Omit<TabLog, "id" | "timestamp">) => void;
  // 持久化字段可见性。
  persistColumnVisibility: (sourceId: string, objectName: string, visibility: Record<string, boolean>) => Promise<void>;
  // 构建 SQL/SOQL 语句。
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
  normalizeQueryResult: (input: QueryResult) => QueryResult;
  // 从查询语句生成字段可见性。
  buildVisibilityFromSoql: (
    soql: string,
    describe: ObjectDescribe | null,
    fallback: Record<string, boolean>
  ) => Record<string, boolean>;
  // 从查询语句提取 where 子句。
  extractWhereClause: (soql: string, objectName: string) => string | null;
  // 构建基线记录快照。
  buildBaselineRecords: (
    records: Record<string, unknown>[],
    options?: { sourceType?: string; mysqlPrimaryKeyField?: string }
  ) => Record<string, Record<string, unknown>>;
  // 获取可排序字段集合。
  getSortableFieldNames: (describe: ObjectDescribe) => string[];
};

// 查询执行行为：统一封装对象查询与自定义 SQL/SOQL 执行流程。
export function useQueryExecution({
  selectedSourceId,
  selectedSourceType,
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
}: UseQueryExecutionInput) {
  // 执行对象查询：根据可见字段和筛选条件构建语句并回写结果。
  const queryTabData = useCallback(
    async (
      objectName: string,
      describeOverride?: ObjectDescribe,
      whereOverride?: string,
      sortFieldOverride?: string,
      limitOverride?: number,
      directionOverride?: "ASC" | "DESC",
      sortClauseOverride?: string
    ) => {
      const tab = tabs.find((item) => item.bindingKey === objectName || item.objectName === objectName);
      if (!tab && !describeOverride) return;

      const describe = describeOverride ?? tab?.describe;
      if (!describe) return;
      const tabObjectName = tab?.objectName || objectName;
      const resolvedSourceId = tab?.sourceId || selectedSourceId;
      if (!resolvedSourceId) return;
      const resolvedSourceType = String(tab?.sourceType || selectedSourceType || "salesforce");
      const tabBindingKey = tab?.bindingKey || buildObjectTabBindingKey(resolvedSourceId, tabObjectName);

      const whereClause = (whereOverride ?? tab?.whereClause ?? "").trim();
      const limit = Math.max(1, Math.min(2000, limitOverride ?? tab?.limit ?? 200));
      const normalizedType = resolvedSourceType.toLowerCase();
      const sortableFieldSet = new Set(getSortableFieldNames(describe));
      const rawSortField = (sortFieldOverride ?? tab?.sortField ?? "").trim();
      // 排序字段兜底：仅允许使用字段元数据中 sortable=true 的字段，否则视为“不排序”。
      const sortField = sortableFieldSet.has(rawSortField) ? rawSortField : "";
      const sortDirection = directionOverride ?? tab?.sortDirection ?? "DESC";
      const sortClause = (sortClauseOverride ?? tab?.sortClause ?? "").trim();
      // MySQL 主键字段：用于生成稳定记录键，避免脏标记与基线键不一致。
      const mysqlPrimaryKeyField = normalizedType === "mysql"
        ? describe.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
        : "";
      const visibility = tab?.columnVisibility ?? {};
      const selectedFields = describe.fields
        .map((field) => field.name)
        .filter((name) => (visibility[name] ?? true) === true);

      if (selectedFields.length === 0) {
        patchTab(tabBindingKey, (item) => ({
          ...item,
          notice: { type: "error", message: `${tabObjectName} 至少要勾选一个字段。` },
          loading: false
        }));
        return;
      }

      patchTab(tabBindingKey, (item) => ({
        ...item,
        loading: true,
        whereClause,
        limit,
        sortField,
        sortDirection,
        sortClause
      }));

      try {
        const soql = buildQueryStatement(
          normalizedType,
          tabObjectName,
          selectedFields,
          whereClause,
          sortField,
          sortDirection,
          limit,
          sortClause
        );
        const rawResult = await api.queryRecords(resolvedSourceId, soql);
        const result = normalizeQueryResult(rawResult);

        patchTab(tabBindingKey, (item) => ({
          ...item,
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
          notice: { type: "success", message: `${tabObjectName} 查询成功，共 ${result.totalSize} 条。` }
        }));
        appendTabLog(tabBindingKey, {
          action: "QUERY",
          success: true,
          request: soql,
          summary: `查询成功，返回 ${result.totalSize} 条。`
        });
      } catch (error) {
        patchTab(tabBindingKey, (item) => ({
          ...item,
          loading: false,
          notice: { type: "error", message: `${tabObjectName} 查询失败：${String(error)}` }
        }));
        appendTabLog(tabBindingKey, {
          action: "QUERY",
          success: false,
          request: `object=${tabObjectName}, where=${whereClause}, sort=${
            normalizedType === "mysql" ? (sortClause || "无排序") : sortField ? `${sortField} ${sortDirection}` : "无排序"
          }, limit=${limit}`,
          summary: "查询失败。",
          errorMessage: String(error)
        });
      }
    },
    [
      tabs,
      selectedSourceType,
      getSortableFieldNames,
      patchTab,
      buildQueryStatement,
      normalizeQueryResult,
      buildBaselineRecords,
      appendTabLog
    ]
  );

  // 执行自定义 SQL/SOQL：按草稿执行并同步结果与字段可见性。
  const executeCustomSoql = useCallback(async () => {
    if (!activeTab) return;
    const resolvedSourceId = activeTab.sourceId || selectedSourceId;
    if (!resolvedSourceId) return;
    const resolvedSourceType = String(activeTab.sourceType || selectedSourceType || "salesforce");
    const activeTabBindingKey =
      activeTab.bindingKey || buildObjectTabBindingKey(resolvedSourceId, activeTab.objectName);
    if (!activeTab.soqlDraft.trim()) {
      patchTab(activeTabBindingKey, (item) => ({ ...item, notice: { type: "error", message: `${queryLanguageLabel} 不能为空。` } }));
      return;
    }

    patchTab(activeTabBindingKey, (item) => ({ ...item, loading: true }));
    try {
      const normalizedType = resolvedSourceType.toLowerCase();
      // 自定义 SQL/SOQL 执行后仍需使用统一记录键策略，保证高亮与撤销一致。
      const mysqlPrimaryKeyField = normalizedType === "mysql"
        ? activeTab.describe?.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI")?.name || ""
        : "";
      const rawResult = await api.queryRecords(resolvedSourceId, activeTab.soqlDraft);
      const result = normalizeQueryResult(rawResult);
      const nextVisibility = buildVisibilityFromSoql(activeTab.soqlDraft, activeTab.describe, activeTab.columnVisibility);

      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        pendingDeleteRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility,
        dirtyCellKeys: [],
        baselineRecords: buildBaselineRecords(result.records, {
          sourceType: normalizedType,
          mysqlPrimaryKeyField
        }),
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行${queryLanguageLabel}成功，共 ${result.totalSize} 条。` }
      }));
      appendTabLog(activeTabBindingKey, {
        action: "SOQL",
        success: true,
        request: activeTab.soqlDraft,
        summary: `执行${queryLanguageLabel}成功，返回 ${result.totalSize} 条。`
      });
      await persistColumnVisibility(resolvedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTabBindingKey, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行${queryLanguageLabel}失败：${String(error)}` }
      }));
      appendTabLog(activeTabBindingKey, {
        action: "SOQL",
        success: false,
        request: activeTab.soqlDraft,
        summary: `执行${queryLanguageLabel}失败。`,
        errorMessage: String(error)
      });
    }
  }, [
    selectedSourceId,
    activeTab,
    patchTab,
    queryLanguageLabel,
    normalizeQueryResult,
    buildVisibilityFromSoql,
    buildBaselineRecords,
    extractWhereClause,
    selectedSourceType,
    appendTabLog,
    persistColumnVisibility
  ]);

  return {
    queryTabData,
    executeCustomSoql
  };
}
