import { buildObjectTabBindingKey, type TabState } from "../types/index.ts";

// Query Tab 持久化快照：复用完整 TabState 结构，恢复时补齐缺失字段。
export type PersistedQueryTabState = TabState;

// 将持久化快照恢复为完整 TabState，兼容历史字段缺失并重置瞬态运行标记。
export function hydrateTab(persisted: Partial<PersistedQueryTabState>): TabState {
  const sourceId = persisted.sourceId || "";
  const objectName = persisted.objectName || "";
  const bindingKey =
    typeof persisted.bindingKey === "string" && persisted.bindingKey.trim() !== ""
      ? persisted.bindingKey
      : buildObjectTabBindingKey(sourceId, objectName);
  return {
    ...persisted,
    bindingKey,
    sourceId,
    sourceType: persisted.sourceType || "",
    sourceName: persisted.sourceName || "",
    sourceColor: persisted.sourceColor || "",
    objectName,
    label: persisted.label || objectName || "",
    describe: persisted.describe || null,
    result: persisted.result || { totalSize: 0, records: [] },
    whereClause: persisted.whereClause || "",
    limit: typeof persisted.limit === "number" ? persisted.limit : 200,
    sortField: persisted.sortField || "",
    sortDirection: persisted.sortDirection === "ASC" ? "ASC" : "DESC",
    sortClause: persisted.sortClause || "",
    selectedRecordIds: Array.isArray(persisted.selectedRecordIds) ? persisted.selectedRecordIds : [],
    pendingDeleteRecordIds: Array.isArray(persisted.pendingDeleteRecordIds) ? persisted.pendingDeleteRecordIds : [],
    currentSoql: persisted.currentSoql || "",
    soqlDraft: persisted.soqlDraft || "",
    showQueryBar: persisted.showQueryBar !== false,
    showDrawer: persisted.showDrawer === true,
    drawerView:
      persisted.drawerView === "mysql-ddl" || persisted.drawerView === "mysql-fields" || persisted.drawerView === "salesforce"
        ? persisted.drawerView
        : "salesforce",
    showLogs: persisted.showLogs === true,
    logs: Array.isArray(persisted.logs) ? persisted.logs : [],
    columnVisibility: persisted.columnVisibility || {},
    dirtyCellKeys: Array.isArray(persisted.dirtyCellKeys) ? persisted.dirtyCellKeys : [],
    baselineRecords: persisted.baselineRecords || {},
    notice: persisted.notice || null,
    loading: false
  };
}
