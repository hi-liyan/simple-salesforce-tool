import type { TabState } from "../types/index.ts";

// 轻量对象 Tab 持久化快照：仅保留恢复查询上下文与 UI 展示态所需字段。
export type PersistedQueryTabSnapshot = Pick<
  TabState,
  | "bindingKey"
  | "sourceId"
  | "sourceType"
  | "sourceName"
  | "sourceColor"
  | "objectName"
  | "label"
  | "whereClause"
  | "limit"
  | "sortField"
  | "sortDirection"
  | "sortClause"
  | "currentSoql"
  | "soqlDraft"
  | "showQueryBar"
  | "showDrawer"
  | "drawerView"
  | "showLogs"
  | "columnVisibility"
>;

// 生成轻量对象 Tab 快照：显式剥离 records/describe/baseline/logs 等启动期重字段。
export function createPersistedQueryTabSnapshot(tab: TabState): PersistedQueryTabSnapshot {
  return {
    bindingKey: tab.bindingKey,
    sourceId: tab.sourceId,
    sourceType: tab.sourceType,
    sourceName: tab.sourceName,
    sourceColor: tab.sourceColor,
    objectName: tab.objectName,
    label: tab.label,
    whereClause: tab.whereClause,
    limit: tab.limit,
    sortField: tab.sortField,
    sortDirection: tab.sortDirection,
    sortClause: tab.sortClause,
    currentSoql: tab.currentSoql,
    soqlDraft: tab.soqlDraft,
    showQueryBar: tab.showQueryBar,
    showDrawer: tab.showDrawer,
    drawerView: tab.drawerView,
    showLogs: tab.showLogs,
    columnVisibility: tab.columnVisibility
  };
}
