import type { ObjectDescribe, ObjectField, QueryResult, TabState } from "../../../../types/index.ts";

// 记录键计算参数：用于按数据源类型统一 key 生成规则。
export type RecordKeyOptions = {
  // 当前数据源类型（salesforce/mysql）。
  sourceType?: string;
  // MySQL 主键字段名（来自 describe 字段元数据）。
  mysqlPrimaryKeyField?: string;
};

// 解析当前记录的后端定位值：用于更新/删除时生成 recordId。
function resolveRecordLocator(record: Record<string, unknown>, options: RecordKeyOptions = {}): string {
  if (record.Id !== null && record.Id !== undefined && String(record.Id).trim() !== "") {
    return String(record.Id).trim();
  }
  // MySQL 场景优先使用主键字段值作为后端定位条件。
  if ((options.sourceType || "salesforce").toLowerCase() === "mysql" && options.mysqlPrimaryKeyField) {
    const mysqlPrimaryValue = record[options.mysqlPrimaryKeyField];
    if (mysqlPrimaryValue !== null && mysqlPrimaryValue !== undefined && String(mysqlPrimaryValue).trim() !== "") {
      return String(mysqlPrimaryValue).trim();
    }
  }
  return "";
}

// 生成记录稳定身份：仅供前端选择、高亮、dirty 与待删除定位使用。
function buildFallbackRowStableId(record: Record<string, unknown>, rowIndex: number, options: RecordKeyOptions = {}): string {
  if (record.__localId !== null && record.__localId !== undefined && String(record.__localId).trim() !== "") {
    return String(record.__localId).trim();
  }
  const locator = resolveRecordLocator(record, options);
  if (locator) {
    if ((options.sourceType || "salesforce").toLowerCase() === "mysql" && options.mysqlPrimaryKeyField) {
      return `mysql:${options.mysqlPrimaryKeyField}:${locator}`;
    }
    return `record:${locator}`;
  }
  return `row:${rowIndex}`;
}

// 为查询结果补齐稳定行身份：旧行固定 __rowStableId/__baselineKey，新行仅保留 __rowStableId。
export function normalizeRecordsWithStableIds(
  records: Record<string, unknown>[],
  options: RecordKeyOptions = {}
): Record<string, unknown>[] {
  return records.map((record, rowIndex) => {
    const rowStableId = getRecordKey(record, rowIndex, options);
    const isNewRow = Boolean(record.__isNew);
    return {
      ...record,
      __rowStableId: rowStableId,
      ...(isNewRow ? {} : { __baselineKey: rowStableId })
    };
  });
}

// 计算默认字段可见性。
export function buildDefaultVisibility(describe: ObjectDescribe): Record<string, boolean> {
  return describe.fields.reduce((acc, field) => ({ ...acc, [field.name]: true }), {} as Record<string, boolean>);
}

// 根据字段勾选返回可见列。
export function getVisibleColumns(tab: TabState): string[] {
  if (!tab.describe) return [];
  return tab.describe.fields
    .map((field) => field.name)
    .filter((name) => (tab.columnVisibility[name] ?? true) === true);
}

// 根据 SOQL 解析字段可见性。
export function buildVisibilityFromSoql(
  soql: string,
  describe: ObjectDescribe | null,
  fallback: Record<string, boolean>
): Record<string, boolean> {
  if (!describe) return fallback;
  const selected = extractSelectedFields(soql);
  if (selected.length === 0) return fallback;

  const selectedSet = new Set(selected.map((name) => name.toLowerCase()));
  return describe.fields.reduce((acc, field) => {
    acc[field.name] = selectedSet.has(field.name.toLowerCase());
    return acc;
  }, {} as Record<string, boolean>);
}

// 从 SOQL 中抽取字段列表。
function extractSelectedFields(soql: string): string[] {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^select\s+(.+?)\s+from\s+/i);
  if (!match) return [];

  const fieldSegment = match[1].trim();
  if (!fieldSegment || fieldSegment === "*") return [];
  if (/^count\(/i.test(fieldSegment)) return [];

  return fieldSegment
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const withoutAlias = item.split(/\s+/)[0];
      const dotParts = withoutAlias.split(".");
      return dotParts[dotParts.length - 1];
    });
}

// 从 SOQL 中抽取 WHERE 条件。
export function extractWhereClause(soql: string, objectName: string): string | null {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const objectEscaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`\\sfrom\\s+${objectEscaped}\\s*(.*)$`, "i"));
  if (!match) return null;
  const tail = match[1].trim();

  const whereMatch = tail.match(/^where\s+(.+?)(\s+order\s+by\s+|\s+limit\s+|$)/i);
  if (!whereMatch) return "";
  return whereMatch[1].trim();
}

// 构建标准查询语句：按 sourceType 生成 SQL 或 SOQL。
export function buildQueryStatement(
  sourceType: string,
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  limit: number,
  sortClause: string
): string {
  const normalizedType = (sourceType || "salesforce").toLowerCase();
  if (normalizedType === "mysql") {
    return buildQuerySql(objectName, selectedFields, whereClause, sortClause, limit);
  }
  return buildQuerySoql(objectName, selectedFields, whereClause, sortField, sortDirection, sortClause, limit);
}

// 构建标准 SOQL 查询语句。
function buildQuerySoql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  sortClause: string,
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  // SELECT 字段逐行展开：生成“真实换行”的多行 SOQL，避免编辑器内只有单行内容。
  const selectFieldsSegment = fields.map((field, index) => `  ${field}${index < fields.length - 1 ? "," : ""}`).join("\n");
  const whereSegment = whereClause.trim() ? `\nWHERE ${whereClause.trim()}` : "";
  // Salesforce 排序优先使用手动输入 sortClause；为空时回退旧版 sortField + sortDirection。
  const normalizedSortClause = sortClause.trim().replace(/^order\s+by\s+/i, "");
  const orderBySegment = normalizedSortClause
    ? `\nORDER BY ${normalizedSortClause}`
    : sortField.trim()
      ? `\nORDER BY ${sortField} ${sortDirection}`
      : "";
  return `SELECT\n${selectFieldsSegment}\nFROM ${objectName}${whereSegment}${orderBySegment}\nLIMIT ${limit}`;
}

// 构建标准 SQL 查询语句（MySQL）。
function buildQuerySql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortClause: string,
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  // SELECT 字段逐行展开：统一多行风格，便于用户快速审阅。
  const selectFieldsSegment = fields.map((field, index) => `  ${field}${index < fields.length - 1 ? "," : ""}`).join("\n");
  const whereSegment = whereClause.trim() ? `\nWHERE ${whereClause.trim()}` : "";
  // MySQL 排序支持手动表达式输入，允许多字段/函数排序。
  const normalizedSortClause = sortClause.trim().replace(/^order\s+by\s+/i, "");
  const orderBySegment = normalizedSortClause ? `\nORDER BY ${normalizedSortClause}` : "";
  return `SELECT\n${selectFieldsSegment}\nFROM ${objectName}${whereSegment}${orderBySegment}\nLIMIT ${limit}`;
}

// 判断字段是否可排序：依据后端返回的字段元数据 `sortable`。
function isFieldSortable(field: ObjectField): boolean {
  return field.metadata?.sortable === true;
}

// 提取对象的可排序字段列表。
export function getSortableFieldNames(describe: ObjectDescribe): string[] {
  return describe.fields.filter((field) => isFieldSortable(field)).map((field) => field.name);
}

// 按优先级挑选默认排序字段；若无可排序字段则返回空字符串（不排序）。
export function pickDefaultSortField(sortableFieldNames: string[]): string {
  const priority = ["LastModifiedDate", "CreatedDate", "Name", "Id"];
  const preferred = priority.find((fieldName) => sortableFieldNames.includes(fieldName));
  if (preferred) return preferred;
  return sortableFieldNames[0] || "";
}

// 判断 Tab 是否存在未提交的变更。
export function hasPendingChanges(tab: TabState): boolean {
  const hasNewRows = tab.result.records.some((record) => Boolean(record.__isNew));
  return hasNewRows || tab.dirtyCellKeys.length > 0 || tab.pendingDeleteRecordIds.length > 0;
}

// 提取 MySQL 主键字段名：优先使用 columnKey=PRI 的字段。
export function getMysqlPrimaryKeyField(describe: ObjectDescribe | null | undefined): string {
  if (!describe) return "";
  const mysqlPrimaryField = describe.fields.find((field) => String(field.metadata?.columnKey || "").toUpperCase() === "PRI");
  return mysqlPrimaryField?.name || "";
}

// 基线记录：用于比较单元格是否发生变化。
export function buildBaselineRecords(
  records: Record<string, unknown>[],
  options: RecordKeyOptions = {}
): Record<string, Record<string, unknown>> {
  const baseline: Record<string, Record<string, unknown>> = {};
  records.forEach((record, index) => {
    baseline[getRecordKey(record, index, options)] = { ...record };
  });
  return baseline;
}

// 获取记录稳定键：优先使用已缓存的 rowStableId/baselineKey，缺失时再按定位值生成。
export function getRecordKey(record: Record<string, unknown>, rowIndex: number, options: RecordKeyOptions = {}): string {
  const rowStableId = record.__rowStableId;
  if (rowStableId !== null && rowStableId !== undefined && String(rowStableId).trim() !== "") {
    return String(rowStableId).trim();
  }
  const baselineKey = record.__baselineKey;
  if (baselineKey !== null && baselineKey !== undefined && String(baselineKey).trim() !== "") {
    return String(baselineKey).trim();
  }
  return buildFallbackRowStableId(record, rowIndex, options);
}

// 归一化查询结果。
export function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}
