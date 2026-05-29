import type { StorageValue } from "zustand/middleware";
import type {
  ConsoleTabStateDto,
  Notice,
  QueryResult,
  QueryResultSetDto,
  QueryRowDraftDto,
  QueryTabStateDto,
  SourceSecretView,
  TabLog,
  TabState,
  TerminalTabStateDto,
  ToolTabStateDto,
  WorkspaceSnapshotDto,
  WorkspaceTabDto
} from "../types/index.ts";
import type { MainViewMode } from "./useAppStore.ts";
import type { SoqlExecutorTab } from "./useSoqlExecutorStore.ts";
import type { TerminalTab } from "./useTerminalStore.ts";
import type { JsonFormatterTab } from "./useJsonFormatterStore.ts";
import type { JsonDiffTab } from "./useJsonDiffStore.ts";
import type { TextDiffTab } from "./useTextDiffStore.ts";
import type { QrCodeHistoryEntry, QrCodeOptions } from "../features/main/ToolsPanel/logic/qrCode.ts";
import type {
  UnicodeConverterHistoryEntry,
  UnicodeConverterOutputFormat
} from "../features/main/ToolsPanel/logic/unicodeConverter.ts";
import type { PersistedSourceTreeUiState } from "../features/main/QueryPanel/logic/sourceTreePersistence.ts";
import { normalizePersistedSourceTreeUiState } from "../features/main/QueryPanel/logic/sourceTreePersistence.ts";
import { buildConsoleWorkspaceTabId, buildDataWorkspaceTabId } from "../features/main/QueryPanel/logic/workspaceTabs.ts";
import { normalizeQrCodeToolPersistedState } from "../features/main/ToolsPanel/logic/qrCode.ts";
import { normalizeUnicodeConverterToolPersistedState } from "../features/main/ToolsPanel/logic/unicodeConverter.ts";

const APP_SELECTED_SOURCE_ID_KEY = "app.selectedSourceId";
const APP_VIEW_MODE_KEY = "app.viewMode";
const APP_SIDEBAR_WIDTH_KEY = "app.soqlSidebarWidth";
const APP_ACTIVE_TAB_KEY = "app.activeTabObjectName";
const QUERY_WORKSPACE_ORDER_KEY = "query.workspaceTabOrder";
const QUERY_SOURCE_TREE_KEY = "query.sourceTreeUiState";
const TERMINAL_TAB_ORDER_KEY = "terminal.tabOrder";
const TERMINAL_ACTIVE_TAB_KEY = "terminal.activeTabId";
const JSON_FORMATTER_TAB_ORDER_KEY = "tool.jsonFormatter.tabOrder";
const JSON_FORMATTER_ACTIVE_TAB_KEY = "tool.jsonFormatter.activeTabId";
const JSON_DIFF_TAB_ORDER_KEY = "tool.jsonDiff.tabOrder";
const JSON_DIFF_ACTIVE_TAB_KEY = "tool.jsonDiff.activeTabId";
const TEXT_DIFF_TAB_ORDER_KEY = "tool.textDiff.tabOrder";
const TEXT_DIFF_ACTIVE_TAB_KEY = "tool.textDiff.activeTabId";
const QR_CODE_INPUT_TEXT_KEY = "tool.qrCode.inputText";
const QR_CODE_OPTIONS_KEY = "tool.qrCode.options";
const QR_CODE_HISTORY_KEY = "tool.qrCode.history";
const UNICODE_CONVERTER_INPUT_TEXT_KEY = "tool.unicodeConverter.inputText";
const UNICODE_CONVERTER_OUTPUT_TEXT_KEY = "tool.unicodeConverter.outputText";
const UNICODE_CONVERTER_OUTPUT_FORMAT_KEY = "tool.unicodeConverter.outputFormat";
const UNICODE_CONVERTER_HISTORY_KEY = "tool.unicodeConverter.history";

type AppStoreSlice = {
  selectedSourceId: string;
  viewMode: MainViewMode;
  soqlSidebarWidth: number;
  tabs: TabState[];
  activeTabObjectName: string;
};

type SoqlStoreSlice = {
  tabs: SoqlExecutorTab[];
  activeTabId: string;
};

type QueryWorkspaceTabsSlice = {
  tabOrder: string[];
};

type QuerySourceTreeSlice = {
  treeUiState: PersistedSourceTreeUiState;
};

type TerminalStoreSlice = {
  tabs: TerminalTab[];
  tabOrder: string[];
  activeTabId: string;
};

type JsonFormatterStoreSlice = {
  tabs: JsonFormatterTab[];
  tabOrder: string[];
  activeTabId: string;
};

type JsonDiffStoreSlice = {
  tabs: JsonDiffTab[];
  tabOrder: string[];
  activeTabId: string;
};

type TextDiffStoreSlice = {
  tabs: TextDiffTab[];
  tabOrder: string[];
  activeTabId: string;
};

type QrCodeToolStoreSlice = {
  inputText: string;
  options: QrCodeOptions;
  history: QrCodeHistoryEntry[];
};

type UnicodeConverterToolStoreSlice = {
  inputText: string;
  outputText: string;
  outputFormat: UnicodeConverterOutputFormat;
  history: UnicodeConverterHistoryEntry[];
};

/// 创建空的结构化工作区快照。
export function createEmptyWorkspaceSnapshot(): WorkspaceSnapshotDto {
  return {
    tabs: [],
    queryTabs: [],
    queryResults: [],
    queryRowDrafts: [],
    consoleTabs: [],
    toolTabs: [],
    terminalTabs: [],
    uiState: {}
  };
}

/// 将 Zustand `StorageValue` 应用到结构化工作区快照。
export function applyPersistedStateToWorkspaceSnapshot(
  snapshot: WorkspaceSnapshotDto,
  key: string,
  value: StorageValue<unknown> | null
): WorkspaceSnapshotDto {
  const nextSnapshot = cloneWorkspaceSnapshot(snapshot);
  const state = value?.state as Record<string, unknown> | undefined;

  if (key === "ui.app-store") {
    applyAppStoreSlice(nextSnapshot, state as AppStoreSlice | undefined);
  } else if (key === "ui.soql-executor-store") {
    applySoqlStoreSlice(nextSnapshot, state as SoqlStoreSlice | undefined);
  } else if (key === "ui.query-workspace-tabs-store") {
    const tabOrder = Array.isArray(state?.tabOrder) ? (state?.tabOrder as string[]) : [];
    nextSnapshot.uiState[QUERY_WORKSPACE_ORDER_KEY] = tabOrder;
  } else if (key === "ui.query-source-tree-store") {
    nextSnapshot.uiState[QUERY_SOURCE_TREE_KEY] = normalizePersistedSourceTreeUiState(
      (state?.treeUiState as PersistedSourceTreeUiState | undefined) || undefined
    );
  } else if (key === "ui.terminal-store") {
    applyTerminalStoreSlice(nextSnapshot, state as TerminalStoreSlice | undefined);
  } else if (key === "ui.json-formatter-store") {
    applyJsonFormatterSlice(nextSnapshot, state as JsonFormatterStoreSlice | undefined);
  } else if (key === "ui.json-diff-store") {
    applyJsonDiffSlice(nextSnapshot, state as JsonDiffStoreSlice | undefined);
  } else if (key === "ui.text-diff-store") {
    applyTextDiffSlice(nextSnapshot, state as TextDiffStoreSlice | undefined);
  } else if (key === "ui.qr-code-tool-store") {
    applyQrCodeToolSlice(nextSnapshot, state as QrCodeToolStoreSlice | undefined);
  } else if (key === "ui.unicode-converter-tool-store") {
    applyUnicodeConverterToolSlice(nextSnapshot, state as UnicodeConverterToolStoreSlice | undefined);
  }

  rebuildWorkspaceTabs(nextSnapshot);
  return nextSnapshot;
}

/// 从结构化工作区快照读取某个 Zustand key 的持久化值。
export function getPersistedStateFromWorkspaceSnapshot(
  snapshot: WorkspaceSnapshotDto,
  key: string
): StorageValue<unknown> | null {
  if (key === "ui.app-store") {
    return {
      state: restoreAppStoreSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.soql-executor-store") {
    return {
      state: restoreSoqlStoreSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.query-workspace-tabs-store") {
    return {
      state: {
        tabOrder: readStringArray(snapshot.uiState[QUERY_WORKSPACE_ORDER_KEY])
      },
      version: 0
    };
  }
  if (key === "ui.query-source-tree-store") {
    return {
      state: {
        treeUiState: normalizePersistedSourceTreeUiState(
          (snapshot.uiState[QUERY_SOURCE_TREE_KEY] as PersistedSourceTreeUiState | undefined) || undefined
        )
      },
      version: 0
    };
  }
  if (key === "ui.terminal-store") {
    return {
      state: restoreTerminalStoreSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.json-formatter-store") {
    return {
      state: restoreJsonFormatterSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.json-diff-store") {
    return {
      state: restoreJsonDiffSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.text-diff-store") {
    return {
      state: restoreTextDiffSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.qr-code-tool-store") {
    return {
      state: restoreQrCodeToolSlice(snapshot),
      version: 0
    };
  }
  if (key === "ui.unicode-converter-tool-store") {
    return {
      state: restoreUnicodeConverterToolSlice(snapshot),
      version: 0
    };
  }
  return null;
}

/// 读取设置页编辑所需的 Salesforce secret 明文并回填到表单。
export function buildSourceEditForm(secretView: SourceSecretView) {
  return {
    accessToken: secretView.accessToken,
    password: secretView.password
  };
}

/// 基于后端结构化快照恢复工作区分层状态。
export function restoreWorkspaceSnapshot(snapshot: WorkspaceSnapshotDto) {
  return {
    app: restoreAppStoreSlice(snapshot),
    console: restoreSoqlStoreSlice(snapshot),
    queryWorkspaceTabs: {
      tabOrder: readStringArray(snapshot.uiState[QUERY_WORKSPACE_ORDER_KEY])
    },
    querySourceTree: {
      treeUiState: normalizePersistedSourceTreeUiState(
        (snapshot.uiState[QUERY_SOURCE_TREE_KEY] as PersistedSourceTreeUiState | undefined) || undefined
      )
    },
    terminal: restoreTerminalStoreSlice(snapshot),
    jsonFormatter: restoreJsonFormatterSlice(snapshot),
    jsonDiff: restoreJsonDiffSlice(snapshot),
    textDiff: restoreTextDiffSlice(snapshot),
    qrCode: restoreQrCodeToolSlice(snapshot),
    unicodeConverter: restoreUnicodeConverterToolSlice(snapshot)
  };
}

/// 将 app store 切片写入结构化快照。
function applyAppStoreSlice(snapshot: WorkspaceSnapshotDto, state?: AppStoreSlice) {
  const safeState = state || {
    selectedSourceId: "",
    viewMode: "query" as MainViewMode,
    soqlSidebarWidth: 320,
    tabs: [],
    activeTabObjectName: ""
  };
  snapshot.uiState[APP_SELECTED_SOURCE_ID_KEY] = safeState.selectedSourceId || "";
  snapshot.uiState[APP_VIEW_MODE_KEY] = safeState.viewMode || "query";
  snapshot.uiState[APP_SIDEBAR_WIDTH_KEY] = Number(safeState.soqlSidebarWidth || 320);
  snapshot.uiState[APP_ACTIVE_TAB_KEY] = safeState.activeTabObjectName || "";
  snapshot.queryTabs = safeState.tabs.map(toQueryTabStateDto);
  snapshot.queryResults = safeState.tabs.map(toQueryResultSetDto);
  snapshot.queryRowDrafts = safeState.tabs.map(toQueryRowDraftDto);
}

/// 将 console store 切片写入结构化快照。
function applySoqlStoreSlice(snapshot: WorkspaceSnapshotDto, state?: SoqlStoreSlice) {
  const safeState = state || { tabs: [], activeTabId: "" };
  snapshot.consoleTabs = safeState.tabs.map((tab) => toConsoleTabStateDto(tab));
  snapshot.uiState["console.activeTabId"] = safeState.activeTabId || "";
}

/// 将 terminal store 切片写入结构化快照。
function applyTerminalStoreSlice(snapshot: WorkspaceSnapshotDto, state?: TerminalStoreSlice) {
  const safeState = state || { tabs: [], tabOrder: [], activeTabId: "" };
  snapshot.terminalTabs = safeState.tabs.map((tab) => ({
    tabId: tab.id,
    name: tab.name,
    inputDraft: tab.inputDraft,
    outputsJson: Array.isArray(tab.outputs) ? tab.outputs : []
  }));
  snapshot.uiState[TERMINAL_TAB_ORDER_KEY] = safeState.tabOrder || [];
  snapshot.uiState[TERMINAL_ACTIVE_TAB_KEY] = safeState.activeTabId || "";
}

/// 将 JSON Formatter 切片写入结构化快照。
function applyJsonFormatterSlice(snapshot: WorkspaceSnapshotDto, state?: JsonFormatterStoreSlice) {
  const safeState = state || { tabs: [], tabOrder: [], activeTabId: "" };
  replaceToolTabs(snapshot, "jsonFormatter", safeState.tabs.map((tab) => ({
    tabId: tab.id,
    toolKind: "jsonFormatter",
    name: tab.name,
    payloadJson: {
      inputText: tab.inputText,
      viewerCollapsed: tab.viewerCollapsed,
      viewerRevision: tab.viewerRevision
    }
  })));
  snapshot.uiState[JSON_FORMATTER_TAB_ORDER_KEY] = safeState.tabOrder || [];
  snapshot.uiState[JSON_FORMATTER_ACTIVE_TAB_KEY] = safeState.activeTabId || "";
}

/// 将 JSON Diff 切片写入结构化快照。
function applyJsonDiffSlice(snapshot: WorkspaceSnapshotDto, state?: JsonDiffStoreSlice) {
  const safeState = state || { tabs: [], tabOrder: [], activeTabId: "" };
  replaceToolTabs(snapshot, "jsonDiff", safeState.tabs.map((tab) => ({
    tabId: tab.id,
    toolKind: "jsonDiff",
    name: tab.name,
    payloadJson: {
      leftText: tab.leftText,
      rightText: tab.rightText
    }
  })));
  snapshot.uiState[JSON_DIFF_TAB_ORDER_KEY] = safeState.tabOrder || [];
  snapshot.uiState[JSON_DIFF_ACTIVE_TAB_KEY] = safeState.activeTabId || "";
}

/// 将 Text Diff 切片写入结构化快照。
function applyTextDiffSlice(snapshot: WorkspaceSnapshotDto, state?: TextDiffStoreSlice) {
  const safeState = state || { tabs: [], tabOrder: [], activeTabId: "" };
  replaceToolTabs(snapshot, "textDiff", safeState.tabs.map((tab) => ({
    tabId: tab.id,
    toolKind: "textDiff",
    name: tab.name,
    payloadJson: {
      leftText: tab.leftText,
      rightText: tab.rightText
    }
  })));
  snapshot.uiState[TEXT_DIFF_TAB_ORDER_KEY] = safeState.tabOrder || [];
  snapshot.uiState[TEXT_DIFF_ACTIVE_TAB_KEY] = safeState.activeTabId || "";
}

/// 将二维码工具切片写入结构化快照。
function applyQrCodeToolSlice(snapshot: WorkspaceSnapshotDto, state?: QrCodeToolStoreSlice) {
  const safeState = normalizeQrCodeToolPersistedState(state);
  snapshot.uiState[QR_CODE_INPUT_TEXT_KEY] = safeState.inputText;
  snapshot.uiState[QR_CODE_OPTIONS_KEY] = safeState.options;
  snapshot.uiState[QR_CODE_HISTORY_KEY] = safeState.history;
}

/// 将 Unicode 编码转换工具切片写入结构化快照。
function applyUnicodeConverterToolSlice(snapshot: WorkspaceSnapshotDto, state?: UnicodeConverterToolStoreSlice) {
  const safeState = normalizeUnicodeConverterToolPersistedState(state);
  snapshot.uiState[UNICODE_CONVERTER_INPUT_TEXT_KEY] = safeState.inputText;
  snapshot.uiState[UNICODE_CONVERTER_OUTPUT_TEXT_KEY] = safeState.outputText;
  snapshot.uiState[UNICODE_CONVERTER_OUTPUT_FORMAT_KEY] = safeState.outputFormat;
  snapshot.uiState[UNICODE_CONVERTER_HISTORY_KEY] = safeState.history;
}

/// 从结构化快照恢复 app store 状态。
function restoreAppStoreSlice(snapshot: WorkspaceSnapshotDto): AppStoreSlice {
  const resultByTabId = new Map(snapshot.queryResults.map((item) => [item.tabId, item]));
  const draftByTabId = new Map(snapshot.queryRowDrafts.map((item) => [item.tabId, item]));
  const workspaceOrder = readStringArray(snapshot.uiState[QUERY_WORKSPACE_ORDER_KEY]);
  const queryTabs = snapshot.queryTabs.map((tab) => restoreQueryTab(tab, resultByTabId.get(tab.tabId), draftByTabId.get(tab.tabId)));
  const orderByBindingKey = new Map(
    workspaceOrder
      .filter((item) => item.startsWith("data:"))
      .map((item, index) => [item.slice("data:".length), index])
  );
  queryTabs.sort((left, right) => {
    const leftOrder = orderByBindingKey.get(left.bindingKey) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderByBindingKey.get(right.bindingKey) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;
    return left.bindingKey.localeCompare(right.bindingKey);
  });
  return {
    selectedSourceId: String(snapshot.uiState[APP_SELECTED_SOURCE_ID_KEY] || ""),
    viewMode: normalizeViewMode(snapshot.uiState[APP_VIEW_MODE_KEY]),
    soqlSidebarWidth: Number(snapshot.uiState[APP_SIDEBAR_WIDTH_KEY] || 320),
    tabs: queryTabs,
    activeTabObjectName:
      String(snapshot.uiState[APP_ACTIVE_TAB_KEY] || "") || queryTabs[0]?.bindingKey || ""
  };
}

/// 从结构化快照恢复 console store 状态。
function restoreSoqlStoreSlice(snapshot: WorkspaceSnapshotDto): SoqlStoreSlice {
  return {
    tabs: snapshot.consoleTabs.map((tab) => ({
      id: tab.tabId,
      sourceId: tab.sourceId,
      sourceType: tab.sourceType,
      sourceName: tab.sourceName,
      sourceColor: tab.sourceColor,
      name: tab.name,
      soqlDraft: tab.soqlDraft,
      selectedSoqlText: tab.selectedSoqlText,
      result: tab.resultJson || { totalSize: 0, records: [] },
      loading: false,
      notice: (tab.noticeJson as Notice | null) || null,
      logs: Array.isArray(tab.logsJson) ? (tab.logsJson as TabLog[]) : [],
      selectedRecordIds: Array.isArray(tab.selectedRecordIdsJson) ? tab.selectedRecordIdsJson : [],
      showBottomPanel: tab.showBottomPanel === true,
      aiConversationId: tab.aiConversationId || "",
      aiPromptDraft: tab.aiPromptDraft || "",
      aiMessages: Array.isArray(tab.aiMessagesJson) ? (tab.aiMessagesJson as SoqlExecutorTab["aiMessages"]) : [],
      aiLoading: false,
      aiMode: tab.aiMode === true,
      aiStreamRequestId: ""
    })),
    activeTabId: String(snapshot.uiState["console.activeTabId"] || snapshot.consoleTabs[0]?.tabId || "")
  };
}

/// 从结构化快照恢复 terminal store 状态。
function restoreTerminalStoreSlice(snapshot: WorkspaceSnapshotDto): TerminalStoreSlice {
  return {
    tabs: snapshot.terminalTabs.map((tab) => ({
      id: tab.tabId,
      name: tab.name,
      inputDraft: tab.inputDraft,
      outputs: Array.isArray(tab.outputsJson) ? (tab.outputsJson as TerminalTab["outputs"]) : []
    })),
    tabOrder: readStringArray(snapshot.uiState[TERMINAL_TAB_ORDER_KEY]),
    activeTabId: String(snapshot.uiState[TERMINAL_ACTIVE_TAB_KEY] || snapshot.terminalTabs[0]?.tabId || "")
  };
}

/// 从结构化快照恢复 JSON Formatter store 状态。
function restoreJsonFormatterSlice(snapshot: WorkspaceSnapshotDto): JsonFormatterStoreSlice {
  const tabs = snapshot.toolTabs
    .filter((tab) => tab.toolKind === "jsonFormatter")
    .map((tab) => ({
      id: tab.tabId,
      name: tab.name,
      inputText: String(tab.payloadJson?.inputText || ""),
      viewerCollapsed: tab.payloadJson?.viewerCollapsed === true,
      viewerRevision: Number(tab.payloadJson?.viewerRevision || 0)
    }));
  return {
    tabs,
    tabOrder: readStringArray(snapshot.uiState[JSON_FORMATTER_TAB_ORDER_KEY]),
    activeTabId: String(snapshot.uiState[JSON_FORMATTER_ACTIVE_TAB_KEY] || tabs[0]?.id || "")
  };
}

/// 从结构化快照恢复 JSON Diff store 状态。
function restoreJsonDiffSlice(snapshot: WorkspaceSnapshotDto): JsonDiffStoreSlice {
  const tabs = snapshot.toolTabs
    .filter((tab) => tab.toolKind === "jsonDiff")
    .map((tab) => ({
      id: tab.tabId,
      name: tab.name,
      leftText: String(tab.payloadJson?.leftText || ""),
      rightText: String(tab.payloadJson?.rightText || "")
    }));
  return {
    tabs,
    tabOrder: readStringArray(snapshot.uiState[JSON_DIFF_TAB_ORDER_KEY]),
    activeTabId: String(snapshot.uiState[JSON_DIFF_ACTIVE_TAB_KEY] || tabs[0]?.id || "")
  };
}

/// 从结构化快照恢复 Text Diff store 状态。
function restoreTextDiffSlice(snapshot: WorkspaceSnapshotDto): TextDiffStoreSlice {
  const tabs = snapshot.toolTabs
    .filter((tab) => tab.toolKind === "textDiff")
    .map((tab) => ({
      id: tab.tabId,
      name: tab.name,
      leftText: String(tab.payloadJson?.leftText || ""),
      rightText: String(tab.payloadJson?.rightText || "")
    }));
  return {
    tabs,
    tabOrder: readStringArray(snapshot.uiState[TEXT_DIFF_TAB_ORDER_KEY]),
    activeTabId: String(snapshot.uiState[TEXT_DIFF_ACTIVE_TAB_KEY] || tabs[0]?.id || "")
  };
}

/// 从结构化快照恢复二维码工具状态。
function restoreQrCodeToolSlice(snapshot: WorkspaceSnapshotDto): QrCodeToolStoreSlice {
  return normalizeQrCodeToolPersistedState({
    inputText: snapshot.uiState[QR_CODE_INPUT_TEXT_KEY],
    options: snapshot.uiState[QR_CODE_OPTIONS_KEY],
    history: snapshot.uiState[QR_CODE_HISTORY_KEY]
  });
}

/// 从结构化快照恢复 Unicode 编码转换工具状态。
function restoreUnicodeConverterToolSlice(snapshot: WorkspaceSnapshotDto): UnicodeConverterToolStoreSlice {
  return normalizeUnicodeConverterToolPersistedState({
    inputText: snapshot.uiState[UNICODE_CONVERTER_INPUT_TEXT_KEY],
    outputText: snapshot.uiState[UNICODE_CONVERTER_OUTPUT_TEXT_KEY],
    outputFormat: snapshot.uiState[UNICODE_CONVERTER_OUTPUT_FORMAT_KEY],
    history: snapshot.uiState[UNICODE_CONVERTER_HISTORY_KEY]
  });
}

/// 将 Query Tab 转为结构化 DTO。
function toQueryTabStateDto(tab: TabState): QueryTabStateDto {
  return {
    tabId: tab.bindingKey,
    bindingKey: tab.bindingKey,
    sourceId: tab.sourceId,
    sourceType: tab.sourceType,
    sourceName: tab.sourceName,
    sourceColor: tab.sourceColor,
    objectName: tab.objectName,
    label: tab.label,
    describeJson: tab.describe,
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
    columnVisibility: tab.columnVisibility,
    noticeJson: tab.notice
  };
}

/// 将 Query 结果集转为 DTO。
function toQueryResultSetDto(tab: TabState): QueryResultSetDto {
  const hasResult = (tab.result?.totalSize || 0) > 0 || (tab.result?.records?.length || 0) > 0;
  return {
    resultSetId: `${tab.bindingKey}:result`,
    tabId: tab.bindingKey,
    resultStatus: hasResult ? "fresh" : "invalid",
    totalSize: tab.result?.totalSize || 0,
    recordsJson: Array.isArray(tab.result?.records) ? tab.result.records : []
  };
}

/// 将 Query 草稿转为 DTO。
function toQueryRowDraftDto(tab: TabState): QueryRowDraftDto {
  return {
    tabId: tab.bindingKey,
    selectedRecordIdsJson: Array.isArray(tab.selectedRecordIds) ? tab.selectedRecordIds : [],
    pendingDeleteRecordIdsJson: Array.isArray(tab.pendingDeleteRecordIds) ? tab.pendingDeleteRecordIds : [],
    dirtyCellKeysJson: Array.isArray(tab.dirtyCellKeys) ? tab.dirtyCellKeys : [],
    baselineRecordsJson: tab.baselineRecords || {}
  };
}

/// 将 Console Tab 转为 DTO。
function toConsoleTabStateDto(tab: SoqlExecutorTab): ConsoleTabStateDto {
  return {
    tabId: tab.id,
    sourceId: tab.sourceId,
    sourceType: tab.sourceType,
    sourceName: tab.sourceName,
    sourceColor: tab.sourceColor,
    name: tab.name,
    soqlDraft: tab.soqlDraft,
    selectedSoqlText: tab.selectedSoqlText,
    resultJson: tab.result,
    noticeJson: tab.notice,
    logsJson: tab.logs,
    selectedRecordIdsJson: tab.selectedRecordIds,
    showBottomPanel: tab.showBottomPanel,
    aiConversationId: tab.aiConversationId,
    aiPromptDraft: tab.aiPromptDraft,
    aiMessagesJson: tab.aiMessages,
    aiMode: tab.aiMode
  };
}

/// 根据结构化 DTO 恢复完整 Query Tab。
function restoreQueryTab(
  tab: QueryTabStateDto,
  resultSet?: QueryResultSetDto,
  draft?: QueryRowDraftDto
): TabState {
  return {
    bindingKey: tab.bindingKey,
    sourceId: tab.sourceId,
    sourceType: tab.sourceType,
    sourceName: tab.sourceName,
    sourceColor: tab.sourceColor,
    objectName: tab.objectName,
    label: tab.label,
    describe: (tab.describeJson as TabState["describe"]) || null,
    result: {
      totalSize: resultSet?.totalSize || 0,
      records: Array.isArray(resultSet?.recordsJson) ? resultSet?.recordsJson : []
    },
    whereClause: tab.whereClause,
    limit: Number(tab.limit || 200),
    sortField: tab.sortField,
    sortDirection: tab.sortDirection === "ASC" ? "ASC" : "DESC",
    sortClause: tab.sortClause,
    selectedRecordIds: Array.isArray(draft?.selectedRecordIdsJson) ? draft?.selectedRecordIdsJson : [],
    pendingDeleteRecordIds: Array.isArray(draft?.pendingDeleteRecordIdsJson) ? draft?.pendingDeleteRecordIdsJson : [],
    currentSoql: tab.currentSoql,
    soqlDraft: tab.soqlDraft,
    showQueryBar: tab.showQueryBar !== false,
    showDrawer: tab.showDrawer === true,
    drawerView:
      tab.drawerView === "mysql-ddl" || tab.drawerView === "mysql-fields" || tab.drawerView === "salesforce"
        ? tab.drawerView
        : "salesforce",
    showLogs: tab.showLogs === true,
    logs: [],
    columnVisibility: tab.columnVisibility || {},
    dirtyCellKeys: Array.isArray(draft?.dirtyCellKeysJson) ? draft?.dirtyCellKeysJson : [],
    baselineRecords: (draft?.baselineRecordsJson as TabState["baselineRecords"]) || {},
    notice: (tab.noticeJson as Notice | null) || null,
    loading: false
  };
}

/// 重建统一 `snapshot.tabs` 列表。
function rebuildWorkspaceTabs(snapshot: WorkspaceSnapshotDto) {
  const workspaceTabs: WorkspaceTabDto[] = [];
  const queryOrder = readStringArray(snapshot.uiState[QUERY_WORKSPACE_ORDER_KEY]);
  const queryTabMap = new Map(snapshot.queryTabs.map((tab) => [buildDataWorkspaceTabId(tab.bindingKey), tab]));
  const consoleTabMap = new Map(snapshot.consoleTabs.map((tab) => [buildConsoleWorkspaceTabId(tab.tabId), tab]));
  const seenIds = new Set<string>();

  const pushWorkspaceTab = (tabId: string, tabKind: string, title: string, sourceId: string | undefined, isActive: boolean) => {
    if (seenIds.has(tabId)) return;
    seenIds.add(tabId);
    workspaceTabs.push({
      tabId,
      tabKind,
      title,
      sourceId,
      sortOrder: workspaceTabs.length + 1,
      isActive: isActive ? 1 : 0,
      payloadJson: {}
    });
  };

  const activeQueryBindingKey = String(snapshot.uiState[APP_ACTIVE_TAB_KEY] || "");
  const activeConsoleTabId = String(snapshot.uiState["console.activeTabId"] || "");
  queryOrder.forEach((workspaceTabId) => {
    const queryTab = queryTabMap.get(workspaceTabId);
    if (queryTab) {
      pushWorkspaceTab(
        workspaceTabId,
        "query",
        queryTab.label || queryTab.objectName,
        queryTab.sourceId,
        activeQueryBindingKey === queryTab.bindingKey
      );
      return;
    }
    const consoleTab = consoleTabMap.get(workspaceTabId);
    if (consoleTab) {
      pushWorkspaceTab(
        workspaceTabId,
        "console",
        consoleTab.name,
        consoleTab.sourceId,
        activeConsoleTabId === consoleTab.tabId
      );
    }
  });

  snapshot.queryTabs.forEach((tab) => {
    pushWorkspaceTab(
      buildDataWorkspaceTabId(tab.bindingKey),
      "query",
      tab.label || tab.objectName,
      tab.sourceId,
      activeQueryBindingKey === tab.bindingKey
    );
  });
  snapshot.consoleTabs.forEach((tab) => {
    pushWorkspaceTab(
      buildConsoleWorkspaceTabId(tab.tabId),
      "console",
      tab.name,
      tab.sourceId,
      activeConsoleTabId === tab.tabId
    );
  });

  const terminalOrder = readStringArray(snapshot.uiState[TERMINAL_TAB_ORDER_KEY]);
  snapshot.terminalTabs
    .slice()
    .sort((left, right) => orderCompare(terminalOrder, left.tabId, right.tabId))
    .forEach((tab) => {
      pushWorkspaceTab(
        tab.tabId,
        "terminal",
        tab.name,
        undefined,
        String(snapshot.uiState[TERMINAL_ACTIVE_TAB_KEY] || "") === tab.tabId
      );
    });

  for (const toolKind of ["jsonFormatter", "jsonDiff", "textDiff"]) {
    const { orderKey, activeKey } = resolveToolUiKeys(toolKind);
    const order = readStringArray(snapshot.uiState[orderKey]);
    snapshot.toolTabs
      .filter((tab) => tab.toolKind === toolKind)
      .sort((left, right) => orderCompare(order, left.tabId, right.tabId))
      .forEach((tab) => {
        pushWorkspaceTab(
          tab.tabId,
          toolKind,
          tab.name,
          undefined,
          String(snapshot.uiState[activeKey] || "") === tab.tabId
        );
      });
  }

  snapshot.tabs = workspaceTabs;
}

/// 根据工具类型返回对应的 UI 状态键。
function resolveToolUiKeys(toolKind: string) {
  if (toolKind === "jsonFormatter") {
    return { orderKey: JSON_FORMATTER_TAB_ORDER_KEY, activeKey: JSON_FORMATTER_ACTIVE_TAB_KEY };
  }
  if (toolKind === "jsonDiff") {
    return { orderKey: JSON_DIFF_TAB_ORDER_KEY, activeKey: JSON_DIFF_ACTIVE_TAB_KEY };
  }
  return { orderKey: TEXT_DIFF_TAB_ORDER_KEY, activeKey: TEXT_DIFF_ACTIVE_TAB_KEY };
}

/// 替换某个工具类型下的全部工具标签。
function replaceToolTabs(snapshot: WorkspaceSnapshotDto, toolKind: string, nextTabs: ToolTabStateDto[]) {
  snapshot.toolTabs = [
    ...snapshot.toolTabs.filter((tab) => tab.toolKind !== toolKind),
    ...nextTabs
  ];
}

/// 读取字符串数组。
function readStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.map((item) => String(item || "")).filter((item) => item !== "") : [];
}

/// 归一化主视图模式。
function normalizeViewMode(value: unknown): MainViewMode {
  if (value === "settings" || value === "terminal" || value === "tools") {
    return value;
  }
  return "query";
}

/// 根据排序数组比较两个 ID。
function orderCompare(order: string[], leftId: string, rightId: string) {
  const leftIndex = order.indexOf(leftId);
  const rightIndex = order.indexOf(rightId);
  if (leftIndex >= 0 || rightIndex >= 0) {
    if (leftIndex < 0) return 1;
    if (rightIndex < 0) return -1;
    return leftIndex - rightIndex;
  }
  return leftId.localeCompare(rightId);
}

/// 深拷贝工作区快照。
function cloneWorkspaceSnapshot(snapshot: WorkspaceSnapshotDto): WorkspaceSnapshotDto {
  return JSON.parse(JSON.stringify(snapshot)) as WorkspaceSnapshotDto;
}
