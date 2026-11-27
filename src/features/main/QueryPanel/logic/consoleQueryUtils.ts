import type { ObjectDescribe, QueryResult, TabLog } from "../../../../types";

// 构建控制台执行日志条目（按驱动查询语言动态标记 SQL / SOQL）。
export function buildSoqlLog(
  success: boolean,
  request: string,
  summary: string,
  errorMessage?: string,
  action: "SQL" | "SOQL" = "SOQL"
): TabLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action,
    success,
    request,
    summary,
    errorMessage
  };
}

// 提取主查询对象：用于优先匹配字段 label/type。
export function extractPrimaryObjectName(soql: string): string {
  const objectNames = extractFromObjectNames(soql);
  return objectNames[0] || "";
}

// 从 SOQL/SQL 中提取所有 FROM 后对象/表名（包含子查询），用于按需加载字段元数据。
export function extractFromObjectNames(soql: string): string[] {
  const objectNames: string[] = [];
  const regex = /\bfrom\s+`?([A-Za-z_][\w]*)`?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(soql)) !== null) {
    objectNames.push(match[1]);
  }
  return Array.from(new Set(objectNames));
}

// 判断语句是否为会改变库表结构的 DDL 语句，用于执行成功后自动刷新工作区元数据。
export function isSchemaChangingDdl(sql: string): boolean {
  const stripped = sql
    .replace(/^\s*(?:--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .trim();
  return /^(create|alter|drop|truncate|rename)\b/i.test(stripped);
}

// 执行器字段 metadata 解析：优先复用 describe 原始 metadata，其次按结果样本推断类型。
export function resolveFieldMetadataForExecutor(
  fieldName: string,
  primaryObjectName: string,
  objectDescribeMap: Record<string, ObjectDescribe>,
  records: Record<string, unknown>[]
): Record<string, unknown> | null {
  const exactField = resolveObjectFieldMetadataByName(fieldName, primaryObjectName, objectDescribeMap);
  if (exactField) {
    return {
      ...(exactField.metadata || {}),
      type: exactField.dataType || (exactField.metadata?.type as string) || ""
    };
  }

  if (fieldName.includes(".")) {
    const suffixFieldName = fieldName.split(".").pop() || "";
    const suffixField = resolveObjectFieldMetadataByName(suffixFieldName, primaryObjectName, objectDescribeMap);
    if (suffixField) {
      return {
        ...(suffixField.metadata || {}),
        type: suffixField.dataType || (suffixField.metadata?.type as string) || ""
      };
    }
  }

  const inferredType = inferFieldTypeFromRecords(fieldName, records);
  if (!inferredType) return null;
  return { type: inferredType };
}

// 按字段名从 describe 缓存中解析字段定义（先主对象，再全量兜底）。
function resolveObjectFieldMetadataByName(
  fieldName: string,
  primaryObjectName: string,
  objectDescribeMap: Record<string, ObjectDescribe>
): ObjectDescribe["fields"][number] | null {
  const normalizedFieldName = fieldName.trim().toLowerCase();
  if (!normalizedFieldName) return null;

  const primaryDescribe = primaryObjectName ? objectDescribeMap[primaryObjectName] : undefined;
  if (primaryDescribe) {
    const matched = primaryDescribe.fields.find((field) => field.name.toLowerCase() === normalizedFieldName);
    if (matched) return matched;
  }

  let uniqueMatched: ObjectDescribe["fields"][number] | null = null;
  let matchedCount = 0;
  Object.values(objectDescribeMap).forEach((describe) => {
    const matched = describe.fields.find((field) => field.name.toLowerCase() === normalizedFieldName);
    if (!matched) return;
    matchedCount += 1;
    uniqueMatched = matched;
  });
  if (matchedCount > 1) return null;
  return uniqueMatched;
}

// 基于结果样本推断字段类型：用于 describe 缺失时的展示兜底。
function inferFieldTypeFromRecords(fieldName: string, records: Record<string, unknown>[]): string | null {
  const samples = records
    .map((record) => record[fieldName])
    .filter((value) => value !== null && value !== undefined)
    .slice(0, 20);
  if (samples.length === 0) return null;

  if (samples.every((value) => typeof value === "boolean")) return "boolean";
  if (samples.every((value) => typeof value === "number")) return "double";
  if (samples.every((value) => typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim()))) return "date";
  if (samples.every((value) => typeof value === "string" && /^(\d{4}-\d{2}-\d{2})T/.test(value.trim()))) return "datetime";

  return null;
}

// 抽取可见列：合并所有记录的顶层键，并过滤 Salesforce attributes。
export function extractVisibleColumns(records: Record<string, unknown>[], preserveRawColumns = false): string[] {
  const columnSet = new Set<string>();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => {
      if (key === "attributes") return;
      columnSet.add(key);
    });
  });
  const allColumns = Array.from(columnSet);
  const relationPrefixSet = new Set(
    allColumns
      .filter((key) => key.includes("."))
      .map((key) => key.split(".")[0])
  );
  return allColumns.filter((key) => {
    if (key.endsWith(".records") || key.endsWith(".totalSize") || key.endsWith(".done")) {
      return false;
    }
    if (preserveRawColumns) return true;
    if (!key.includes(".") && relationPrefixSet.has(key)) {
      return false;
    }
    return true;
  });
}

// 主记录展开：主记录 1 行 + 每条子查询记录 1 行。
export function expandRecordForGridRows(record: Record<string, unknown>): Record<string, unknown>[] {
  const baseRow: Record<string, unknown> = {};
  const childQueries: Array<{ relationKey: string; records: Record<string, unknown>[] }> = [];

  Object.entries(record).forEach(([key, value]) => {
    if (key === "attributes") return;

    if (isSalesforceChildQueryNode(value)) {
      const childRows = Array.isArray((value as { records?: unknown[] }).records)
        ? ((value as { records: Record<string, unknown>[] }).records || [])
        : [];
      childQueries.push({ relationKey: key, records: childRows });
      return;
    }

    flattenNodeToColumns(value, key, baseRow);
  });

  const rows: Record<string, unknown>[] = [];
  childQueries.forEach(({ relationKey, records }) => {
    records.forEach((childRecord, index) => {
      const childRow = index === 0 ? { ...baseRow } : ({} as Record<string, unknown>);
      flattenNodeToColumns(childRecord, relationKey, childRow);
      rows.push(childRow);
    });
  });

  if (rows.length === 0) {
    rows.push(baseRow);
  }
  return rows;
}

// 递归展开嵌套节点。
function flattenNodeToColumns(node: unknown, prefix: string, output: Record<string, unknown>) {
  if (node === null || node === undefined || typeof node !== "object") {
    if (prefix) output[prefix] = node;
    return;
  }

  if (Array.isArray(node)) {
    if (!prefix) return;
    output[prefix] = JSON.stringify(node);
    return;
  }

  const entries = Object.entries(node as Record<string, unknown>).filter(([key]) => key !== "attributes");
  entries.forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    flattenNodeToColumns(value, nextPrefix, output);
  });
}

// 判断节点是否为 Salesforce 一对多子查询结构。
function isSalesforceChildQueryNode(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return Array.isArray(node.records) && typeof node.totalSize === "number";
}

// 归一化查询结果，避免后端异常格式影响 UI。
export function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}

// 日志时间格式化。
export function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}
