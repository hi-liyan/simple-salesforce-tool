import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { hydrateTab } from "../../src/store/queryTabHydration.ts";
import { createStartupCoordinator, shouldKeepQueryPanelMounted, shouldMountQueryPanel } from "../../src/pages/mainPageStartup.ts";
import { createPersistedQueryTabSnapshot } from "../../src/store/queryTabPersistence.ts";
import type { TabState } from "../../src/types/index.ts";

// 构造最小运行时 Tab：覆盖启动恢复与持久化裁剪所需字段。
function createRuntimeTab(): TabState {
  return {
    bindingKey: "sf-1::Account",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "测试 Org",
    sourceColor: "#60A5FA",
    objectName: "Account",
    label: "客户",
    describe: {
      name: "Account",
      label: "客户",
      fields: [
        {
          name: "Id",
          label: "ID",
          dataType: "id",
          nillable: false,
          updateable: false,
          createable: false,
          metadata: {}
        }
      ],
      childRelationships: []
    },
    result: {
      totalSize: 1,
      records: [
        {
          Id: "001-test",
          Name: "Acme"
        }
      ]
    },
    whereClause: "Name != ''",
    limit: 50,
    sortField: "Name",
    sortDirection: "ASC",
    sortClause: "Name ASC",
    selectedRecordIds: ["001-test"],
    pendingDeleteRecordIds: ["001-delete"],
    currentSoql: "SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 50",
    soqlDraft: "SELECT Id, Name FROM Account",
    showQueryBar: true,
    showDrawer: true,
    drawerView: "salesforce",
    showLogs: true,
    logs: [
      {
        id: "log-1",
        timestamp: "2026-04-24T00:00:00.000Z",
        action: "QUERY",
        success: true,
        request: "SELECT Id FROM Account",
        summary: "查询成功"
      }
    ],
    columnVisibility: {
      Id: true,
      Name: true
    },
    dirtyCellKeys: ["001-test:Name"],
    baselineRecords: {
      "001-test": {
        Id: "001-test",
        Name: "Acme"
      }
    },
    notice: {
      type: "success",
      message: "查询成功"
    },
    loading: true
  };
}

test("createStartupCoordinator: 重复启动时应只执行一次初始化任务", async () => {
  const coordinator = createStartupCoordinator("rehydrate");
  let runCount = 0;

  const first = coordinator.ensureStarted(async ({ setStage, finish }) => {
    runCount += 1;
    setStage("restore-sources");
    await Promise.resolve();
    finish();
  });
  const second = coordinator.ensureStarted(async () => {
    runCount += 1;
  });

  await Promise.all([first, second]);

  assert.equal(runCount, 1);
  assert.deepEqual(coordinator.getSnapshot(), {
    stage: "restore-sources",
    loading: false,
    complete: true
  });
});

test("shouldMountQueryPanel: 启动完成前不应挂载 Query 工作区", () => {
  assert.equal(shouldMountQueryPanel("query", false), false);
  assert.equal(shouldMountQueryPanel("query", true), true);
  assert.equal(shouldMountQueryPanel("settings", true), false);
});

test("shouldKeepQueryPanelMounted: 首次进入 Query 后切换到其他 Panel 也应保持挂载", () => {
  assert.equal(shouldKeepQueryPanelMounted(false, "query", true), true);
  assert.equal(shouldKeepQueryPanelMounted(true, "terminal", true), true);
  assert.equal(shouldKeepQueryPanelMounted(true, "tools", true), true);
  assert.equal(shouldKeepQueryPanelMounted(false, "settings", true), false);
});

test("MainPage: Query 工作区保活后切换 panel 不应再用 hidden 打断 DataGrid 尺寸", () => {
  const source = readFileSync(new URL("../../src/pages/MainPage.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("invisible pointer-events-none"), true);
  assert.equal(source.includes('shouldMountQueryPanel(viewMode, startupState.complete) ? "h-full w-full" : "hidden h-full w-full"'), false);
});

test("createPersistedQueryTabSnapshot: 应裁掉阻塞启动的大字段，仅保留恢复所需快照", () => {
  const snapshot = createPersistedQueryTabSnapshot(createRuntimeTab());

  assert.deepEqual(snapshot, {
    bindingKey: "sf-1::Account",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "测试 Org",
    sourceColor: "#60A5FA",
    objectName: "Account",
    label: "客户",
    whereClause: "Name != ''",
    limit: 50,
    sortField: "Name",
    sortDirection: "ASC",
    sortClause: "Name ASC",
    currentSoql: "SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 50",
    soqlDraft: "SELECT Id, Name FROM Account",
    showQueryBar: true,
    showDrawer: true,
    drawerView: "salesforce",
    showLogs: true,
    columnVisibility: {
      Id: true,
      Name: true
    }
  });
});

test("hydrateTab: 轻量快照恢复时应补齐默认运行态字段", () => {
  const hydrated = hydrateTab(
    createPersistedQueryTabSnapshot(createRuntimeTab())
  );

  assert.equal(hydrated.describe, null);
  assert.deepEqual(hydrated.result, {
    totalSize: 0,
    records: []
  });
  assert.deepEqual(hydrated.logs, []);
  assert.deepEqual(hydrated.baselineRecords, {});
  assert.deepEqual(hydrated.selectedRecordIds, []);
  assert.deepEqual(hydrated.pendingDeleteRecordIds, []);
  assert.deepEqual(hydrated.dirtyCellKeys, []);
  assert.equal(hydrated.loading, false);
  assert.equal(hydrated.notice, null);
  assert.equal(hydrated.sortClause, "Name ASC");
  assert.equal(hydrated.currentSoql, "SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 50");
});
