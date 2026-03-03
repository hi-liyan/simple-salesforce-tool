import { ObjectDescribe, ObjectField, QueryResult, TabState } from "../../../../types";

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

// 基线记录：用于比较单元格是否发生变化。
export function buildBaselineRecords(records: Record<string, unknown>[]): Record<string, Record<string, unknown>> {
  const baseline: Record<string, Record<string, unknown>> = {};
  records.forEach((record, index) => {
    baseline[getRecordKey(record, index)] = { ...record };
  });
  return baseline;
}

// 获取记录主键或临时键。
export function getRecordKey(record: Record<string, unknown>, rowIndex: number): string {
  if (record.__localId) return String(record.__localId);
  if (record.Id) return String(record.Id);
  return `row-${rowIndex}`;
}

// 归一化查询结果。
export function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}
