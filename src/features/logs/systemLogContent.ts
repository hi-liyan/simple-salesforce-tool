// 系统日志长内容判定阈值：超过后默认以折叠态展示。
export const SYSTEM_LOG_COLLAPSE_CHAR_LIMIT = 180;

// 系统日志长内容判定阈值：超过后默认以折叠态展示。
export const SYSTEM_LOG_COLLAPSE_LINE_LIMIT = 4;

// MySQL 结构化日志 schema：用于区分旧版纯文本 detail 与新版 JSON detail。
export const MYSQL_MUTATION_LOG_SCHEMA = "mysql-mutation-log/v1";

// MySQL 单条变更日志项：对应一条 create/update/delete 的执行摘要。
export type MysqlMutationLogItem = {
  // 操作类型：create/update/delete。
  operationType: string;
  // 同类操作内的顺序索引。
  operationIndex: number | null;
  // 记录定位值：用于快速定位失败记录。
  recordLocator: string;
  // 当前操作影响行数；未知时为 null。
  rowsAffected: number | null;
  // 执行前生成的 SQL 预览文本。
  previewSql: string;
  // 当前操作错误信息；成功时为空字符串。
  error: string;
  // 当前操作是否执行成功。
  success: boolean;
};

// MySQL 结构化日志详情：供系统日志页识别并增强展示。
export type MysqlMutationLogDetail = {
  // schema 版本：用于向后兼容不同 detail 结构。
  schema: typeof MYSQL_MUTATION_LOG_SCHEMA;
  // 执行模式：当前批量提交固定为 transaction，单条操作为 single。
  executionMode: string;
  // 最终结果：success/failed。
  result: string;
  // 顶层操作类型：例如 update/save_records_with_deletes。
  operationType: string;
  // 顶层失败或当前主操作的序号；未知时为 null。
  operationIndex: number | null;
  // 顶层失败或当前主操作的记录定位值。
  recordLocator: string;
  // 顶层失败或当前主操作的影响行数。
  rowsAffected: number | null;
  // 汇总后的执行预览 SQL 文本。
  previewSql: string;
  // 顶层错误信息；成功时为空字符串。
  error: string;
  // 子操作列表：批量提交时会包含逐条记录。
  items: MysqlMutationLogItem[];
};

// 判断任意值是否为对象记录，便于后续安全读取字段。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 归一化字符串字段：缺失时回退为空字符串。
function normalizeString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

// 归一化数值字段：仅保留有限数字。
function normalizeNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

// 解析单条 MySQL 结构化日志项。
function parseMysqlMutationLogItem(value: unknown): MysqlMutationLogItem | null {
  if (!isRecord(value)) return null;
  return {
    operationType: normalizeString(value.operationType),
    operationIndex: normalizeNumber(value.operationIndex),
    recordLocator: normalizeString(value.recordLocator),
    rowsAffected: normalizeNumber(value.rowsAffected),
    previewSql: normalizeString(value.previewSql),
    error: normalizeString(value.error),
    success: value.success === true
  };
}

// 解析结构化系统日志 detail；旧版纯文本 detail 会返回 null。
export function parseSystemLogDetail(detail?: string): MysqlMutationLogDetail | null {
  const normalizedDetail = detail?.trim() || "";
  if (!normalizedDetail.startsWith("{")) return null;

  try {
    const parsed = JSON.parse(normalizedDetail) as unknown;
    if (!isRecord(parsed) || parsed.schema !== MYSQL_MUTATION_LOG_SCHEMA) return null;

    return {
      schema: MYSQL_MUTATION_LOG_SCHEMA,
      executionMode: normalizeString(parsed.executionMode),
      result: normalizeString(parsed.result),
      operationType: normalizeString(parsed.operationType),
      operationIndex: normalizeNumber(parsed.operationIndex),
      recordLocator: normalizeString(parsed.recordLocator),
      rowsAffected: normalizeNumber(parsed.rowsAffected),
      previewSql: normalizeString(parsed.previewSql),
      error: normalizeString(parsed.error),
      items: Array.isArray(parsed.items) ? parsed.items.map(parseMysqlMutationLogItem).filter((item): item is MysqlMutationLogItem => Boolean(item)) : []
    };
  } catch {
    return null;
  }
}

// 提取可读的操作标签：例如 update#1。
function buildOperationLabel(operationType: string, operationIndex: number | null): string {
  const normalizedType = operationType.trim() || "unknown";
  return operationIndex === null ? normalizedType : `${normalizedType}#${operationIndex}`;
}

// 提取结构化失败文本：失败日志优先展示操作序号、定位值与错误原因。
export function extractSystemLogStructuredFailureText(detail?: string): string {
  const parsed = parseSystemLogDetail(detail);
  if (!parsed || parsed.result !== "failed") return "";

  const failedItem = parsed.items.find((item) => item.success === false && item.error.trim().length > 0);
  const operationType = failedItem?.operationType || parsed.operationType;
  const operationIndex = failedItem?.operationIndex ?? parsed.operationIndex;
  const recordLocator = failedItem?.recordLocator || parsed.recordLocator;
  const error = failedItem?.error || parsed.error;
  const parts = [buildOperationLabel(operationType, operationIndex)];

  // 补充 record_locator，便于和后端报错里的定位条件对齐。
  if (recordLocator) parts.push(`record_locator=${recordLocator}`);
  if (error) parts.push(error);
  return parts.join(" | ");
}

// 读取结构化日志中的预览 SQL 条目；旧版 detail 返回空数组。
export function getSystemLogPreviewSqlItems(detail?: string): MysqlMutationLogItem[] {
  const parsed = parseSystemLogDetail(detail);
  if (!parsed) return [];
  if (parsed.items.length > 0) {
    return parsed.items.filter((item) => item.previewSql.trim().length > 0);
  }
  if (parsed.previewSql.trim().length === 0) return [];
  return [
    {
      operationType: parsed.operationType,
      operationIndex: parsed.operationIndex,
      recordLocator: parsed.recordLocator,
      rowsAffected: parsed.rowsAffected,
      previewSql: parsed.previewSql,
      error: parsed.error,
      success: parsed.result === "success"
    }
  ];
}

// 生成结构化 detail 的可读正文：兼顾折叠展示与旧版纯文本回退。
function buildMysqlStructuredLogContent(detail: MysqlMutationLogDetail): string {
  const lines: string[] = [
    `执行模式: ${detail.executionMode || "transaction"}`,
    `执行结果: ${detail.result || "unknown"}`
  ];

  const failureText = extractSystemLogStructuredFailureText(JSON.stringify(detail));
  if (failureText) {
    lines.push(`失败定位: ${failureText}`);
  }

  if (detail.rowsAffected !== null) {
    lines.push(`受影响行数: ${detail.rowsAffected}`);
  }

  if (detail.previewSql.trim().length > 0) {
    lines.push(`执行预览 SQL:\n${detail.previewSql}`);
  }

  return lines.join("\n");
}

// 组合日志主信息与详情：供折叠判定与展示复用。
export function buildSystemLogContent(message: string, detail?: string): string {
  const normalizedMessage = message.trim();
  const parsedDetail = parseSystemLogDetail(detail);
  const normalizedDetail = parsedDetail ? buildMysqlStructuredLogContent(parsedDetail) : detail?.trim() || "";

  // 仅有 message 时直接返回，避免多余换行。
  if (!normalizedDetail) return normalizedMessage;
  // 同时存在 message 与 detail 时使用双换行分隔，提升可读性。
  return `${normalizedMessage}\n\n详情:\n${normalizedDetail}`;
}

// 判断日志内容是否需要默认折叠。
export function shouldCollapseSystemLogContent(message: string, detail?: string): boolean {
  const content = buildSystemLogContent(message, detail);
  // 使用换行数和字符数双重约束，兼顾长文本与多行堆栈日志。
  const lineCount = content.split(/\r?\n/).length;
  return content.length > SYSTEM_LOG_COLLAPSE_CHAR_LIMIT || lineCount > SYSTEM_LOG_COLLAPSE_LINE_LIMIT;
}
