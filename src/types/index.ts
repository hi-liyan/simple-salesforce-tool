// Salesforce 数据源信息。
export type SalesforceSource = {
  id: string;
  name: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
  createdAt: string;
  updatedAt: string;
};

// Salesforce 对象元数据列表项。
export type SalesforceObject = {
  name: string;
  label: string;
  queryable: boolean;
  createable: boolean;
  updateable: boolean;
  deletable: boolean;
};

// 对象字段元数据。
export type ObjectField = {
  name: string;
  label: string;
  dataType: string;
  nillable: boolean;
  updateable: boolean;
  createable: boolean;
  metadata: Record<string, unknown>;
};

// 对象描述信息（字段列表等）。
export type ObjectDescribe = {
  name: string;
  label: string;
  fields: ObjectField[];
};

// SOQL 查询结果。
export type QueryResult = {
  totalSize: number;
  records: Record<string, unknown>[];
};

// 数据源新增/更新负载。
export type SourceUpsertPayload = {
  name: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
};

// 记录新增负载。
export type RecordMutationPayload = {
  sourceId: string;
  objectName: string;
  values: Record<string, unknown>;
};

// 记录更新负载。
export type RecordUpdatePayload = {
  recordId: string;
  values: Record<string, unknown>;
};

// 记录批量保存负载：同时包含新增与更新。
export type RecordSavePayload = {
  sourceId: string;
  objectName: string;
  creates: Record<string, unknown>[];
  updates: RecordUpdatePayload[];
};

// 页面提示消息。
export type Notice = {
  type: "error" | "success";
  message: string;
};

// Tab 内日志条目。
export type TabLog = {
  id: string;
  timestamp: string;
  action: "QUERY" | "SOQL" | "DELETE" | "UPSERT" | "DISCARD";
  success: boolean;
  request: string;
  summary: string;
  errorMessage?: string;
};

// 单个对象 Tab 的运行时状态。
export type TabState = {
  objectName: string;
  label: string;
  describe: ObjectDescribe | null;
  result: QueryResult;
  whereClause: string;
  limit: number;
  sortField: string;
  sortDirection: "ASC" | "DESC";
  selectedRecordIds: string[];
  // 待删除记录 Id 列表：点击“删除勾选”后仅做标记，执行更新时才真正提交删除。
  pendingDeleteRecordIds: string[];
  currentSoql: string;
  soqlDraft: string;
  showQueryBar: boolean;
  showDrawer: boolean;
  showLogs: boolean;
  logs: TabLog[];
  columnVisibility: Record<string, boolean>;
  dirtyCellKeys: string[];
  baselineRecords: Record<string, Record<string, unknown>>;
  notice: Notice | null;
  loading: boolean;
};

// 系统日志条目（后端 SQLite 持久化）。
export type SystemLogEntry = {
  id: number;
  createdAt: string;
  level: string;
  category: string;
  action: string;
  sourceId?: string;
  target?: string;
  success: boolean;
  message: string;
  detail?: string;
};

// 系统日志分页结果。
export type SystemLogPage = {
  items: SystemLogEntry[];
  page: number;
  pageSize: number;
  total: number;
};

// CLI 路径候选探测结果。
export type CliPathProbe = {
  path: string;
  ok: boolean;
  version: string | null;
  detail: string;
};

// CLI 路径设置与自动探测信息。
export type CliPathSettings = {
  customCliPath: string | null;
  resolvedCliPath: string | null;
  resolvedCliVersion: string | null;
  probes: CliPathProbe[];
};

// CLI 路径检测状态：用于展示可用性、版本与更新信息。
export type CliPathStatus = {
  path: string | null;
  ok: boolean;
  version: string | null;
  hasUpdate: boolean | null;
  latestVersion: string | null;
  detail: string;
};

// LLM 设置视图（apiKey 仅返回掩码信息）。
export type LlmSettings = {
  provider: string;
  baseUrl: string;
  model: string;
  apiKeyConfigured: boolean;
  apiKeyMasked: string;
  timeoutMs: number;
};

// 保存 LLM 设置负载（apiKey 可选覆盖）。
export type LlmSettingsSavePayload = {
  baseUrl: string;
  model: string;
  apiKey?: string;
  timeoutMs?: number;
};

// 多轮 SOQL 对话请求参数。
export type SoqlConversationRequest = {
  sourceId: string;
  conversationId?: string;
  userMessage: string;
  contextObjectHint?: string;
  streamRequestId?: string;
};

// 多轮 SOQL 对话返回结果。
export type SoqlConversationResponse = {
  conversationId: string;
  mode: "answer" | "generate" | "clarify";
  status: "clarify" | "ready";
  questions: string[];
  soql?: string;
  objectName?: string;
  fieldNames: string[];
  reason: string;
  answer?: string;
};
