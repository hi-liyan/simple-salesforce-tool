import type { ObjectDescribe } from "../../../../types/index.ts";

type ResolveMysqlConsoleVisibleColumnsInput = {
  // 当前控制台中最近一次用于生成结果集的 SQL 文本。
  queryText: string;
  // 当前主表 describe：用于在 SELECT * 时回到表字段默认顺序。
  describe: ObjectDescribe | null | undefined;
  // 当前结果集记录：用于兜底补齐解析不到的结果列。
  records: Record<string, unknown>[];
};

type ParsedSelectItem =
  | {
      // 星号展开：如 `*` / `orders.*`。
      kind: "wildcard";
    }
  | {
      // 可直接映射到结果列名的显式选择项。
      kind: "column";
      // 结果表应展示的列名：优先别名，其次字段名末段。
      displayName: string;
    }
  | {
      // 当前选择项无法静态推断列名，交由结果列兜底补齐。
      kind: "unknown";
    };

// 控制台 MySQL 结果列顺序解析：`SELECT *` 走表默认顺序，显式字段走 SELECT 顺序。
export function resolveMysqlConsoleVisibleColumns({
  queryText,
  describe,
  records
}: ResolveMysqlConsoleVisibleColumnsInput): string[] {
  const hasActualIdField = Boolean(describe?.fields.some((field) => field.name === "Id"));
  const fallbackColumns = collectRecordColumns(records, {
    excludeCompatibilityId: !hasActualIdField
  });
  const parsedItems = parseMysqlSelectItems(queryText);
  if (parsedItems.length === 0) return fallbackColumns;

  const describeFieldNames = (describe?.fields || [])
    .map((field) => field.name)
    .filter((fieldName) => fieldName !== "Id" || hasActualIdField);
  const knownColumnSet = new Set<string>([...fallbackColumns, ...describeFieldNames]);
  const orderedColumns: string[] = [];
  const appendedColumnSet = new Set<string>();

  const pushColumn = (columnName: string) => {
    const normalizedColumnName = String(columnName || "").trim();
    if (!normalizedColumnName) return;
    if (!knownColumnSet.has(normalizedColumnName)) return;
    if (appendedColumnSet.has(normalizedColumnName)) return;
    appendedColumnSet.add(normalizedColumnName);
    orderedColumns.push(normalizedColumnName); // 行内注释：按解析顺序稳定写入，避免后续 Set 打乱顺序。
  };

  parsedItems.forEach((item) => {
    if (item.kind === "wildcard") {
      describeFieldNames.forEach((fieldName) => {
        pushColumn(fieldName); // 行内注释：星号展开时严格复用表字段默认顺序。
      });
      return;
    }
    if (item.kind === "column") {
      pushColumn(item.displayName); // 行内注释：显式字段优先按 SELECT 片段出现顺序展示。
    }
  });

  fallbackColumns.forEach((columnName) => {
    pushColumn(columnName); // 行内注释：补齐表达式列/未识别别名，避免结果列丢失。
  });

  return orderedColumns.length > 0 ? orderedColumns : fallbackColumns;
}

// 收集结果集中的实际列顺序：按首个出现位置稳定合并所有记录顶层键。
function collectRecordColumns(
  records: Record<string, unknown>[],
  options: { excludeCompatibilityId: boolean }
): string[] {
  const columns: string[] = [];
  const seenColumnSet = new Set<string>();

  records.forEach((record) => {
    Object.keys(record).forEach((columnName) => {
      if (columnName === "attributes") return;
      if (options.excludeCompatibilityId && columnName === "Id") return;
      if (seenColumnSet.has(columnName)) return;
      seenColumnSet.add(columnName);
      columns.push(columnName);
    });
  });

  return columns;
}

// 解析主查询级 SELECT 列表：忽略括号中的子查询与字符串字面量。
function parseMysqlSelectItems(queryText: string): ParsedSelectItem[] {
  const normalizedQueryText = String(queryText || "").trim();
  if (!normalizedQueryText) return [];
  const selectIndex = findTopLevelKeywordIndex(normalizedQueryText, "select");
  if (selectIndex !== 0) return [];
  const fromIndex = findTopLevelKeywordIndex(normalizedQueryText, "from", "select".length);
  if (fromIndex < 0) return [];

  const selectSegment = normalizedQueryText
    .slice("select".length, fromIndex)
    .trim();
  if (!selectSegment) return [];

  return splitTopLevelCommaSegments(selectSegment)
    .map((segment) => parseMysqlSelectItem(segment))
    .filter((item): item is ParsedSelectItem => item !== null);
}

// 按顶层逗号拆分 SELECT 片段：避免函数参数中的逗号把列顺序拆坏。
function splitTopLevelCommaSegments(segment: string): string[] {
  const items: string[] = [];
  let currentSegment = "";
  let depth = 0;
  let stringQuote: "'" | "\"" | "" = "";

  for (let index = 0; index < segment.length; index += 1) {
    const currentChar = segment[index];
    const previousChar = index > 0 ? segment[index - 1] : "";
    if (stringQuote) {
      currentSegment += currentChar;
      if (currentChar === stringQuote && previousChar !== "\\") {
        stringQuote = "";
      }
      continue;
    }
    if ((currentChar === "'" || currentChar === "\"") && previousChar !== "\\") {
      stringQuote = currentChar;
      currentSegment += currentChar;
      continue;
    }
    if (currentChar === "(") {
      depth += 1;
      currentSegment += currentChar;
      continue;
    }
    if (currentChar === ")") {
      depth = Math.max(0, depth - 1);
      currentSegment += currentChar;
      continue;
    }
    if (currentChar === "," && depth === 0) {
      const normalizedSegment = currentSegment.trim();
      if (normalizedSegment) {
        items.push(normalizedSegment);
      }
      currentSegment = "";
      continue;
    }
    currentSegment += currentChar;
  }

  const tailSegment = currentSegment.trim();
  if (tailSegment) {
    items.push(tailSegment);
  }
  return items;
}

// 解析单个 SELECT 片段：优先识别 `*`、别名和简单字段名。
function parseMysqlSelectItem(rawSegment: string): ParsedSelectItem | null {
  const normalizedSegment = rawSegment.trim();
  if (!normalizedSegment) return null;

  const wildcardTarget = stripMysqlQuotes(normalizedSegment);
  if (wildcardTarget === "*" || /^[A-Za-z_][\w$]*\.\*$/.test(wildcardTarget)) {
    return { kind: "wildcard" };
  }

  const alias = extractMysqlSelectAlias(normalizedSegment);
  if (alias) {
    return {
      kind: "column",
      displayName: alias
    };
  }

  const fieldName = extractSimpleMysqlFieldName(normalizedSegment);
  if (fieldName) {
    return {
      kind: "column",
      displayName: fieldName
    };
  }

  return { kind: "unknown" };
}

// 提取 SELECT 结果别名：支持 `AS alias` 与 `expr alias` 两种常见写法。
function extractMysqlSelectAlias(rawSegment: string): string {
  const normalizedSegment = rawSegment.replace(/\s+/g, " ").trim();
  const asAliasMatch = normalizedSegment.match(/^(.*)\s+as\s+(`?[A-Za-z_][\w$]*`?)$/i);
  if (asAliasMatch?.[2]) {
    return stripMysqlQuotes(asAliasMatch[2]);
  }

  const directAliasMatch = normalizedSegment.match(/^(.*[)\]`A-Za-z0-9_$])\s+(`?[A-Za-z_][\w$]*`?)$/);
  if (!directAliasMatch?.[2]) return "";
  const expressionPart = directAliasMatch[1]?.trim() || "";
  if (extractSimpleMysqlFieldName(expressionPart)) {
    return "";
  }
  return stripMysqlQuotes(directAliasMatch[2]);
}

// 提取简单字段名：只接受 `field` / `table.field` 这类直连标识符。
function extractSimpleMysqlFieldName(rawSegment: string): string {
  const normalizedSegment = stripMysqlQuotes(rawSegment);
  if (!/^[A-Za-z_][\w$]*(\.[A-Za-z_][\w$]*)*$/.test(normalizedSegment)) {
    return "";
  }
  const parts = normalizedSegment.split(".");
  return parts[parts.length - 1] || "";
}

// 去掉 MySQL 反引号，便于统一识别简单标识符。
function stripMysqlQuotes(rawSegment: string): string {
  return String(rawSegment || "").replace(/`/g, "").trim();
}

// 判断当前位置是否命中完整关键字：避免把字段名片段误判成 SQL 子句。
function isKeywordMatched(queryText: string, startIndex: number, keyword: string): boolean {
  const lowerQueryText = queryText.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  if (!lowerQueryText.startsWith(lowerKeyword, startIndex)) return false;
  const beforeChar = startIndex > 0 ? queryText[startIndex - 1] : " ";
  const afterChar = queryText[startIndex + keyword.length] || " ";
  return !/[a-z0-9_]/i.test(beforeChar) && !/[a-z0-9_]/i.test(afterChar);
}

// 查找顶层关键字：忽略括号内子查询和字符串字面量中的同名片段。
function findTopLevelKeywordIndex(queryText: string, keyword: string, fromIndex = 0): number {
  let depth = 0;
  let stringQuote: "'" | "\"" | "" = "";

  for (let index = Math.max(0, fromIndex); index < queryText.length; index += 1) {
    const currentChar = queryText[index];
    const previousChar = index > 0 ? queryText[index - 1] : "";
    if (stringQuote) {
      if (currentChar === stringQuote && previousChar !== "\\") {
        stringQuote = "";
      }
      continue;
    }
    if ((currentChar === "'" || currentChar === "\"") && previousChar !== "\\") {
      stringQuote = currentChar;
      continue;
    }
    if (currentChar === "(") {
      depth += 1;
      continue;
    }
    if (currentChar === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && isKeywordMatched(queryText, index, keyword)) {
      return index;
    }
  }

  return -1;
}
