import test from "node:test";
import assert from "node:assert/strict";
import { buildObjectTabBindingKey, type ObjectDescribe, type TabState } from "../../src/types/index.ts";
import { ensureQueryTabReady } from "../../src/features/main/QueryPanel/logic/queryExecutionPreflight.ts";

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

function createDescribe(): ObjectDescribe {
  return {
    fields: [
      {
        name: "Id",
        label: "ID",
        dataType: "id",
        nillable: false,
        createable: false,
        updateable: false,
        metadata: { type: "id" }
      },
      {
        name: "Name",
        label: "名称",
        dataType: "string",
        nillable: true,
        createable: true,
        updateable: true,
        metadata: { type: "string", sortable: true }
      }
    ]
  } as ObjectDescribe;
}

test("ensureQueryTabReady: describe 缺失时应先拉取元数据并补齐当前 tab", async () => {
  const describe = createDescribe();
  const targetTab = createTab({
    sourceId: "sf-1",
    sourceType: "salesforce",
    objectName: "Account",
    describe: null,
    columnVisibility: {},
    sortField: ""
  });
  const patches: Array<{ tabIdentity: string; tab: TabState }> = [];

  const result = await ensureQueryTabReady({
    tab: targetTab,
    tabBindingKey: targetTab.bindingKey,
    tabObjectName: targetTab.objectName,
    resolvedSourceId: targetTab.sourceId,
    resolvedSourceType: targetTab.sourceType,
    describeOverride: undefined,
    loadDescribe: async () => describe,
    loadColumnVisibility: async () => ({ Id: true, Name: true }),
    getSortableFieldNames: (nextDescribe) => nextDescribe.fields.filter((field) => field.metadata?.sortable).map((field) => field.name),
    pickDefaultSortField: (sortableFields) => sortableFields[0] || "",
    patchTab: (tabIdentity, updater) => {
      const nextTab = updater(targetTab);
      patches.push({ tabIdentity, tab: nextTab });
    }
  });

  assert.equal(result.describe, describe);
  assert.equal(result.tab.describe, describe);
  assert.equal(result.tab.sortField, "Name");
  assert.deepEqual(result.tab.columnVisibility, { Id: true, Name: true });
  assert.equal(patches.length, 1);
  assert.equal(patches[0]?.tabIdentity, targetTab.bindingKey);
});
