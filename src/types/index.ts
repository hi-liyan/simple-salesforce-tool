// Salesforce 数据源信息。
export type DataSourceType = "salesforce" | "mysql";

// 通用数据源信息（M1 阶段以 Salesforce 字段兼容为主）。
export type SalesforceSource = {
  id: string;
  name: string;
  // 数据源类型：用于后续按类型路由不同 provider。
  sourceType: DataSourceType | string;
  // 通用配置 JSON：为未来关系型数据库扩展预留。
  configJson: Record<string, unknown>;
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

// 子关系元数据：用于子查询 relationshipName 推导。
export type ObjectChildRelationship = {
  childSobject: string;
  field: string;
  relationshipName: string;
  deprecatedAndHidden: boolean;
};

// 对象描述信息（字段列表等）。
export type ObjectDescribe = {
  name: string;
  label: string;
  fields: ObjectField[];
  childRelationships: ObjectChildRelationship[];
};

// 当前登录用户上下文（用于按 Salesforce 用户时区处理 datetime）。
export type CurrentUserContext = {
  timezoneSidKey: string | null;
  localeSidKey: string | null;
};

// SOQL 查询结果。
export type QueryResult = {
  totalSize: number;
  records: Record<string, unknown>[];
};

// 对象 DDL 信息（关系型数据源专用）。
export type ObjectDdl = {
  createTableDdl: string;
  indexDdls: string[];
  constraintDdls: string[];
};

// Query 右侧抽屉视图类型：按数据源区分 DDL、字段以及 Salesforce 复合抽屉。
export type QueryDrawerView = "salesforce" | "mysql-ddl" | "mysql-fields";

// 数据源新增/更新负载。
export type SourceUpsertPayload = {
  name: string;
  // 数据源类型：M1 默认 salesforce。
  sourceType?: DataSourceType | string;
  // 通用配置 JSON：M1 阶段默认空对象。
  configJson?: Record<string, unknown>;
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
  // MySQL 排序表达式：支持用户手动输入（如 `created_at DESC`）。
  sortClause: string;
  selectedRecordIds: string[];
  // 待删除记录 Id 列表：点击“删除勾选”后仅做标记，执行更新时才真正提交删除。
  pendingDeleteRecordIds: string[];
  currentSoql: string;
  soqlDraft: string;
  showQueryBar: boolean;
  showDrawer: boolean;
  // 抽屉当前视图：MySQL 可在 DDL / 字段间切换，Salesforce 固定为复合抽屉。
  drawerView: QueryDrawerView;
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

// AI 对话上下文：用于给后端提供当前 Tab 辅助信息。
export type AiUiContext = {
  currentTabSoql?: string;
  contextObjectHint?: string;
  selectedFields?: string[];
};

// AI v2 对话请求参数。
export type AiChatTurnV2Request = {
  sourceId: string;
  conversationId?: string;
  message: string;
  streamRequestId?: string;
  uiContext?: AiUiContext;
};

// AI 可执行动作项。
export type AiActionItem = {
  actionType: "APPLY_CURRENT_TAB" | "APPLY_NEW_TAB" | "ASK_MORE";
  label: string;
};

// AI 诊断信息。
export type AiDiagnostics = {
  toolsUsed: string[];
  riskLevel: "low" | "medium" | "high";
  warnings: string[];
};

// AI v2 对话响应结构。
export type AiChatTurnV2Response = {
  conversationId: string;
  state: "answer" | "clarify" | "ready";
  assistantMessage: string;
  questions: string[];
  proposedSoql?: string;
  actions: AiActionItem[];
  diagnostics: AiDiagnostics;
};

// AI 能力清单：用于前端按能力自适应渲染。
export type AiCapabilities = {
  version: string;
  provider: string;
  model: string;
  tools: string[];
};
