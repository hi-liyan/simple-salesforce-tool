import test from "node:test";
import assert from "node:assert/strict";
import { applyPersistedStateToWorkspaceSnapshot, createEmptyWorkspaceSnapshot, restoreWorkspaceSnapshot } from "../../src/store/workspaceSnapshot.ts";
import type { TabState } from "../../src/types/index.ts";

// 构造最小 Query Tab：覆盖结构化快照恢复所需字段。
function createQueryTab(): TabState {
  return {
    bindingKey: "sf-1::Account",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "测试 Org",
    sourceColor: "#60A5FA",
    objectName: "Account",
    label: "客户",
    describe: null,
    result: {
      totalSize: 1,
      records: [{ Id: "001" }]
    },
    whereClause: "Name != ''",
    limit: 50,
    sortField: "Name",
    sortDirection: "ASC",
    sortClause: "Name ASC",
    selectedRecordIds: ["001"],
    pendingDeleteRecordIds: [],
    currentSoql: "SELECT Id FROM Account",
    soqlDraft: "SELECT Id FROM Account",
    showQueryBar: true,
    showDrawer: false,
    drawerView: "salesforce",
    showLogs: false,
    logs: [],
    columnVisibility: { Id: true },
    dirtyCellKeys: [],
    baselineRecords: {},
    notice: null,
    loading: true
  };
}

test("restoreWorkspaceSnapshot: 应按 query/console/tool/terminal 分层恢复，并重置运行态标记", () => {
  const snapshot = applyPersistedStateToWorkspaceSnapshot(createEmptyWorkspaceSnapshot(), "ui.app-store", {
    state: {
      selectedSourceId: "sf-1",
      viewMode: "query",
      soqlSidebarWidth: 320,
      tabs: [createQueryTab()],
      activeTabObjectName: "sf-1::Account"
    },
    version: 0
  });
  const withConsole = applyPersistedStateToWorkspaceSnapshot(snapshot, "ui.soql-executor-store", {
    state: {
      tabs: [{
        id: "console-1",
        name: "SOQL 1",
        sourceId: "sf-1",
        sourceType: "salesforce",
        sourceName: "测试 Org",
        sourceColor: "#60A5FA",
        soqlDraft: "SELECT Id FROM Account",
        selectedSoqlText: "",
        result: { totalSize: 0, records: [] },
        loading: true,
        notice: null,
        logs: [],
        selectedRecordIds: [],
        showBottomPanel: false,
        aiConversationId: "",
        aiPromptDraft: "",
        aiMessages: [],
        aiLoading: true,
        aiMode: false,
        aiStreamRequestId: "stream-1"
      }],
      activeTabId: "console-1"
    },
    version: 0
  });
  const restored = restoreWorkspaceSnapshot(withConsole);

  assert.equal(restored.app.tabs[0].loading, false);
  assert.equal(restored.app.tabs[0].objectName, "Account");
  assert.equal(restored.app.tabs[0].result.totalSize, 1);
  assert.equal(restored.console.tabs[0].loading, false);
  assert.equal(restored.console.tabs[0].aiLoading, false);
  assert.equal(restored.console.tabs[0].aiStreamRequestId, "");
});

test("restoreWorkspaceSnapshot: 应恢复二维码工具的当前配置与历史记录", () => {
  const snapshot = applyPersistedStateToWorkspaceSnapshot(createEmptyWorkspaceSnapshot(), "ui.qr-code-tool-store", {
    state: {
      inputText: "https://example.com",
      options: {
        errorCorrectionLevel: "H",
        margin: 2,
        scale: 8,
        darkColor: "#000000",
        lightColor: "#FFFFFF"
      },
      history: [
        {
          id: "qr-history-1",
          inputText: "https://example.com",
          createdAt: "2026-05-28T10:00:00.000Z",
          options: {
            errorCorrectionLevel: "H",
            margin: 2,
            scale: 8,
            darkColor: "#000000",
            lightColor: "#FFFFFF"
          }
        }
      ]
    },
    version: 0
  });

  const restored = restoreWorkspaceSnapshot(snapshot);

  assert.equal(restored.qrCode.inputText, "https://example.com");
  assert.equal(restored.qrCode.options.errorCorrectionLevel, "H");
  assert.equal(restored.qrCode.history.length, 1);
  assert.equal(restored.qrCode.history[0].id, "qr-history-1");
});
