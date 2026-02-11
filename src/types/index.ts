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
  action: "QUERY" | "SOQL" | "DELETE" | "UPSERT";
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
  currentSoql: string;
  soqlDraft: string;
  showDrawer: boolean;
  showLogs: boolean;
  logs: TabLog[];
  columnVisibility: Record<string, boolean>;
  dirtyCellKeys: string[];
  baselineRecords: Record<string, Record<string, unknown>>;
  notice: Notice | null;
  loading: boolean;
};
