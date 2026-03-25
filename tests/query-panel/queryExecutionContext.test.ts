import test from "node:test";
import assert from "node:assert/strict";
import { buildObjectTabBindingKey, type TabState } from "../../src/types/index.ts";
import { resolveQueryExecutionContext } from "../../src/features/main/QueryPanel/logic/queryExecutionContext.ts";

// 构造最小 Query Tab：覆盖查询上下文解析所需字段。
function createTab(partial: Partial<TabState>): TabState {
  const sourceId = partial.sourceId || "sf-1";
  const objectName = partial.objectName || "Account";
  return {
    bindingKey: partial.bindingKey || buildObjectTabBindingKey(sourceId, objectName),
    sourceId,
    sourceType: partial.sourceType || "salesforce",
    sourceName: partial.sourceName || "Source",
    sourceColor: partial.sourceColor || "",
    objectName,
    label: partial.label || objectName,
    describe: partial.describe || null,
    result: partial.result || { totalSize: 0, records: [] },
    whereClause: partial.whereClause || "",
    limit: partial.limit ?? 200,
    sortField: partial.sortField || "",
    sortDirection: partial.sortDirection || "DESC",
    sortClause: partial.sortClause || "",
    selectedRecordIds: partial.selectedRecordIds || [],
    pendingDeleteRecordIds: partial.pendingDeleteRecordIds || [],
    currentSoql: partial.currentSoql || "",
    soqlDraft: partial.soqlDraft || "",
    showQueryBar: partial.showQueryBar ?? true,
    showDrawer: partial.showDrawer ?? false,
    drawerView: partial.drawerView || "salesforce",
    showLogs: partial.showLogs ?? false,
    logs: partial.logs || [],
    columnVisibility: partial.columnVisibility || {},
    dirtyCellKeys: partial.dirtyCellKeys || [],
    baselineRecords: partial.baselineRecords || {},
    notice: partial.notice || null,
    loading: partial.loading ?? false
  };
}

test("resolveQueryExecutionContext: 新建 tab 尚未进入闭包 tabs 时，应回退使用 fallbackTab 的 source 上下文", () => {
  const fallbackTab = createTab({
    sourceId: "mysql-1",
    sourceType: "mysql",
    objectName: "users"
  });

  const context = resolveQueryExecutionContext({
    tabs: [],
    tabIdentity: fallbackTab.bindingKey,
    selectedSourceId: "",
    selectedSourceType: "salesforce",
    fallbackTab
  });

  assert.equal(context?.resolvedSourceId, "mysql-1");
  assert.equal(context?.resolvedSourceType, "mysql");
  assert.equal(context?.tabBindingKey, "mysql-1::users");
  assert.equal(context?.tabObjectName, "users");
});

test("resolveQueryExecutionContext: 无 tab 且无 fallbackTab 时应返回 null", () => {
  const context = resolveQueryExecutionContext({
    tabs: [],
    tabIdentity: "sf-1::Account",
    selectedSourceId: "",
    selectedSourceType: "salesforce"
  });

  assert.equal(context, null);
});
