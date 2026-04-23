// Salesforce 数据源信息。
export type DataSourceType = "salesforce" | "mysql";

// 通用数据源信息（M1 阶段以 Salesforce 字段兼容为主）。
export type SalesforceSource = {
  id: string;
  name: string;
  // 数据源序号：用于稳定排序与拖拽重排。
  sortOrder: number;
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
  // 对象/表名称。
  name: string;
  // 对象标签；MySQL 场景下保留兼容字段。
  label: string;
  // MySQL 表注释；Salesforce 场景为空。
  comment?: string;
  // 是否可查询。
  queryable: boolean;
  // 是否可新增。
  createable: boolean;
  // 是否可更新。
  updateable: boolean;
  // 是否可删除。
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

// 记录批量保存负载：同时包含新增、更新与删除（同事务提交）。
export type RecordSaveWithDeletePayload = {
  sourceId: string;
  objectName: string;
  creates: Record<string, unknown>[];
  updates: RecordUpdatePayload[];
  deletes: string[];
};

// MySQL 单元格草稿值：显式区分“省略字段”“写入 NULL”“写入具体值”。
export type MysqlCellDraftValue =
  | {
      __mysqlDraft: true;
      kind: "omit";
    }
  | {
      __mysqlDraft: true;
      kind: "null";
    }
  | {
      __mysqlDraft: true;
      kind: "value";
      value: unknown;
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

// 生成对象 Tab 的稳定唯一键：用于隔离“同名对象 + 不同数据源”。
export function buildObjectTabBindingKey(sourceId: string, objectName: string): string {
  return `${sourceId}::${objectName}`;
}

// Tab 级数据源绑定快照：供对象 Tab、控制台 Tab 复用统一来源上下文。
export type SourceBindingMeta = {
  // 当前 Tab 绑定的数据源 ID。
  sourceId: string;
  // 当前 Tab 绑定的数据源类型。
  sourceType: string;
  // 当前 Tab 绑定的数据源名称。
  sourceName: string;
  // 当前 Tab 绑定的数据源颜色。
  sourceColor: string;
};

// 单个对象 Tab 的运行时状态。
export type TabState = SourceBindingMeta & {
  // 对象 Tab 的稳定唯一键（sourceId + objectName）。
  bindingKey: string;
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

// 终端会话信息：用于 Tab 悬浮显示 PID 与命令行。
export type TerminalSessionInfo = {
  shellName: string;
  shellVersion: string;
  pid: number;
  commandLine: string;
};

// 终端输出事件负载：后端 PTY 输出分片事件。
export type TerminalOutputEvent = {
  tabId: string;
  data: string;
};

// 终端关闭事件负载：进程退出后通知前端更新状态。
export type TerminalClosedEvent = {
  tabId: string;
  exitCode: number | null;
};

// 终端 Shell 选项：由后端动态探测并提供给设置页选择。
export type TerminalShellOption = {
  label: string;
  command: string;
  shellName: string;
  shellVersion: string;
};

// 终端命令项：用于左侧命令库展示与执行。
export type TerminalCommandItem = {
  id: string;
  name: string;
  command: string;
  description: string;
  createdAt: string;
  updatedAt: string;
};

// 终端命令组：全局存储（与数据源无关）。
export type TerminalCommandGroup = {
  id: string;
  name: string;
  commands: TerminalCommandItem[];
  createdAt: string;
  updatedAt: string;
};

// 终端命令写入载荷：用于创建和更新命令。
export type TerminalCommandUpsertPayload = {
  groupId: string;
  name: string;
  command: string;
  description: string;
};

// 终端命令组写入载荷：用于创建和重命名命令组。
export type TerminalCommandGroupUpsertPayload = {
  name: string;
};

// 终端命令排序载荷：按组内最新顺序提交命令 ID 列表。
export type TerminalCommandReorderPayload = {
  groupId: string;
  commandIds: string[];
};
