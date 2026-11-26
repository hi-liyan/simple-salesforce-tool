import type { Completion, CompletionContext, CompletionResult } from "@codemirror/autocomplete";

// 查询编辑器支持的语言标识。
export type QueryLanguage = "soql" | "mysql";

export type SqlCompletionMetadata = {
  // 当前查询语言（mysql / soql）。
  language: QueryLanguage;
  // 表/对象名列表。
  objects: string[];
  // 回退字段名列表。
  fields: string[];
  // 表/对象名（小写）到字段列表的映射。
  objectFields: Record<string, string[]>;
};

const MYSQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "ON",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "ASC",
  "DESC",
  "LIMIT",
  "OFFSET",
  "UNION",
  "UNION ALL",
  "WITH",
  "AS",
  "DISTINCT",
  "CASE",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "EXPLAIN",
  "INSERT INTO",
  "VALUES",
  "UPDATE",
  "SET",
  "DELETE FROM",
  "CREATE TABLE",
  "ALTER TABLE",
  "DROP TABLE"
];

const MYSQL_FUNCTIONS = [
  "COUNT()",
  "SUM()",
  "AVG()",
  "MIN()",
  "MAX()",
  "COALESCE()",
  "IFNULL()",
  "NULLIF()",
  "CONCAT()",
  "SUBSTRING()",
  "TRIM()",
  "NOW()",
  "CURDATE()",
  "DATE_FORMAT()",
  "DATE_ADD()",
  "DATE_SUB()",
  "JSON_EXTRACT()"
];

const SOQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "INCLUDES",
  "EXCLUDES",
  "ORDER BY",
  "ASC",
  "DESC",
  "NULLS FIRST",
  "NULLS LAST",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "COUNT()",
  "TODAY",
  "YESTERDAY",
  "TOMORROW",
  "THIS_WEEK",
  "LAST_WEEK",
  "THIS_MONTH",
  "LAST_MONTH",
  "THIS_YEAR",
  "LAST_YEAR"
];

const KEYWORD_STOP_SET = new Set(
  [...MYSQL_KEYWORDS, ...SOQL_KEYWORDS]
    .flatMap((kw) => kw.split(/\s+/))
    .map((token) => token.replace(/[()]/g, "").toUpperCase())
    .filter(Boolean)
);

// 单条 SQL/SOQL 语句及其在文档中的字符起止范围。
export type SqlStatementRange = {
  // 语句序号（0-based）。
  index: number;
  // 语句有效文本（已去除首尾空白）。
  sql: string;
  // 有效文本在文档中的起始字符偏移（含）。
  from: number;
  // 有效文本在文档中的结束字符偏移（不含）。
  to: number;
};

// 判断片段是否包含有效可执行文本（排除纯空白与纯注释）。
function hasExecutableSqlToken(segment: string): boolean {
  let i = 0;
  while (i < segment.length) {
    const ch = segment[i];
    const next = segment[i + 1] ?? "";
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if ((ch === "-" && next === "-") || ch === "#") {
      while (i < segment.length && segment[i] !== "\n") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < segment.length && !(segment[i] === "*" && segment[i + 1] === "/")) i += 1;
      i += 2;
      continue;
    }
    return true;
  }
  return false;
}

// 扫描整个文档并切分出所有有效 SQL/SOQL 语句及其精确区间（忽略字符串与注释内的分号）。
export function splitSqlStatementsWithRanges(doc: string): SqlStatementRange[] {
  const ranges: SqlStatementRange[] = [];
  let start = 0;
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  const pushSlice = (rawStart: number, rawEnd: number) => {
    const raw = doc.slice(rawStart, rawEnd);
    const leadingSpaces = raw.length - raw.trimStart().length;
    const trailingSpaces = raw.length - raw.trimEnd().length;
    const from = rawStart + leadingSpaces;
    const to = rawEnd - trailingSpaces;
    if (from >= to) return;
    const sql = doc.slice(from, to);
    if (!hasExecutableSqlToken(sql)) return;
    ranges.push({
      index: ranges.length,
      sql,
      from,
      to
    });
  };

  for (let i = 0; i < doc.length; i += 1) {
    const ch = doc[i];
    const next = doc[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if ((ch === "-" && next === "-") || ch === "#") {
      inLineComment = true;
      if (ch === "-") i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === ";") {
      pushSlice(start, i);
      start = i + 1;
    }
  }

  pushSlice(start, doc.length);
  return ranges;
}

// 语句边界切分（dbx 风格 statement-scoped scanning）：只提取光标所在的当前 SQL 语句，避免大文档扫描卡顿。
export function extractStatementAtCursor(doc: string, cursorPos: number): {
  statement: string;
  relativeCursor: number;
  startOffset: number;
} {
  let start = 0;
  let end = doc.length;
  let quote: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;

  for (let i = 0; i < doc.length; i += 1) {
    const ch = doc[i];
    const next = doc[i + 1] ?? "";

    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i += 1;
      }
      continue;
    }
    if (quote) {
      if (ch === "\\") {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "-" && next === "-") {
      inLineComment = true;
      i += 1;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i += 1;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      continue;
    }

    if (ch === ";") {
      if (i < cursorPos) {
        start = i + 1;
      } else {
        end = i;
        break;
      }
    }
  }

  return {
    statement: doc.slice(start, end),
    relativeCursor: Math.max(0, cursorPos - start),
    startOffset: start
  };
}

// 解析文档中尚未执行的 `CREATE TABLE` 语句，将其表名与列名叠加到补全缓存中（对齐 dbx 本地 DDL 叠加能力）。
export function extractLocalCreateTables(doc: string): Record<string, string[]> {
  const result: Record<string, string[]> = {};
  const createTableRegex =
    /\bcreate\s+(?:temporary\s+)?table\s+(?:if\s+not\s+exists\s+)?`?([A-Za-z_][\w$.]*)`?\s*\(([\s\S]*?)\)\s*(?:;|engine\b|comment\b|default\b|$)/gi;

  let match: RegExpExecArray | null;
  while ((match = createTableRegex.exec(doc)) !== null) {
    const rawTable = match[1]?.split(".").pop()?.replace(/`/g, "").toLowerCase();
    const body = match[2] || "";
    if (!rawTable || !body) continue;

    const cols: string[] = [];
    for (const rawLine of body.split(",")) {
      const line = rawLine.trim();
      if (!line) continue;
      if (/^(primary|unique|key|index|constraint|foreign|check|fulltext)\b/i.test(line)) {
        continue;
      }
      const colMatch = line.match(/^`?([A-Za-z_][\w$]*)`?\s+[A-Za-z]/);
      if (colMatch?.[1]) {
        cols.push(colMatch[1]);
      }
    }
    if (cols.length > 0) {
      result[rawTable] = cols;
    }
  }
  return result;
}

// 提取当前语句内的 CTE（WITH cte AS (...)）与 FROM/JOIN 表别名映射。
export function extractStatementAliases(statement: string): Record<string, string> {
  const aliasMap: Record<string, string> = {};

  const cteRegex = /\b(?:with|,)\s+`?([A-Za-z_][\w$]*)`?\s+as\s*\(/gi;
  let cteMatch: RegExpExecArray | null;
  while ((cteMatch = cteRegex.exec(statement)) !== null) {
    const cteName = cteMatch[1]?.toLowerCase();
    if (cteName) aliasMap[cteName] = cteName;
  }

  const tableRegex =
    /\b(?:from|join|update|into)\s+(?:`?[A-Za-z_][\w$]*`?\.)?`?([A-Za-z_][\w$]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w$]*)`?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = tableRegex.exec(statement)) !== null) {
    const tableName = match[1]?.toLowerCase();
    if (!tableName || KEYWORD_STOP_SET.has(tableName.toUpperCase())) continue;
    aliasMap[tableName] = tableName;
    const maybeAlias = match[2]?.toLowerCase();
    if (maybeAlias && !KEYWORD_STOP_SET.has(maybeAlias.toUpperCase())) {
      aliasMap[maybeAlias] = tableName;
    }
  }

  return aliasMap;
}

// 合并远端元数据与本地 CREATE TABLE DDL 列定义。
function mergeTableFields(
  remoteObjectFields: Record<string, string[]>,
  localTables: Record<string, string[]>
): Record<string, string[]> {
  const merged: Record<string, string[]> = {};
  for (const [k, v] of Object.entries(remoteObjectFields)) {
    merged[k.toLowerCase()] = v;
  }
  for (const [table, cols] of Object.entries(localTables)) {
    const existing = merged[table] || [];
    merged[table] = Array.from(new Set([...existing, ...cols]));
  }
  return merged;
}

// 去重补全候选列表（按 label 小写去重）。
function dedupeCompletions(items: Completion[]): Completion[] {
  const seen = new Set<string>();
  const out: Completion[] = [];
  for (const item of items) {
    const key = `${item.type || ""}:${item.label.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

// 计算 CodeMirror 补全结果（核心补全引擎，可独立于 UI 在 Node 中单测）。
export function computeSqlCompletions(
  doc: string,
  cursorPos: number,
  explicit: boolean,
  metadata: SqlCompletionMetadata
): CompletionResult | null {
  const { statement, relativeCursor } = extractStatementAtCursor(doc, cursorPos);
  const prefix = statement.slice(0, relativeCursor);

  // 识别限定符 `alias.` 或 `table.`。
  const qualifierMatch = prefix.match(/`?([A-Za-z_][\w$]*)`?\.\s*(`?[\w$]*)$/);
  const wordMatch = prefix.match(/`?([A-Za-z_][\w$]*)$/);

  // 非显式触发且光标前既不是输入中的标识符、也不是 `.` 或空格后，避免干扰正常换行/符号输入。
  const lastChar = prefix.slice(-1);
  if (!explicit && !wordMatch && lastChar !== "." && lastChar !== " " && lastChar !== ",") {
    return null;
  }

  const fromOffset = qualifierMatch
    ? cursorPos - (qualifierMatch[2]?.length ?? 0)
    : wordMatch
      ? cursorPos - wordMatch[1].length
      : cursorPos;

  const localTables = extractLocalCreateTables(doc);
  const mergedObjectFields = mergeTableFields(metadata.objectFields, localTables);
  const allObjects = Array.from(
    new Set([...metadata.objects, ...Object.keys(localTables)])
  );
  const aliasMap = extractStatementAliases(statement);

  const isSoql = metadata.language === "soql";
  const keywords = isSoql ? SOQL_KEYWORDS : MYSQL_KEYWORDS;
  const keywordOptions: Completion[] = keywords.map((kw) => ({
    label: kw,
    type: "keyword",
    boost: 10
  }));
  const functionOptions: Completion[] = isSoql
    ? []
    : MYSQL_FUNCTIONS.map((fn) => ({
        label: fn,
        type: "function",
        boost: 12
      }));
  const tableOptions: Completion[] = allObjects.map((name) => ({
    label: name,
    type: "class",
    detail: "table",
    boost: 30
  }));

  // 场景 1：`alias.col` 或 `table.col` 限定符补全。
  if (qualifierMatch) {
    const qualifier = qualifierMatch[1].toLowerCase();
    const targetTable = aliasMap[qualifier] || qualifier;
    const cols = mergedObjectFields[targetTable] || [];
    const options: Completion[] = cols.map((col) => ({
      label: col,
      type: "property",
      detail: targetTable,
      boost: 50
    }));
    if (options.length === 0) return null;
    return {
      from: fromOffset,
      options: dedupeCompletions(options),
      validFor: /^[A-Za-z0-9_$]*$/
    };
  }

  // 场景 2：`FROM` / `JOIN` / `UPDATE` / `INTO` / `DESCRIBE` / `EXPLAIN` 后优先提示表名。
  if (/\b(?:from|join|update|into|describe|desc)\s+`?[A-Za-z0-9_$]*$/i.test(prefix)) {
    const cteOptions: Completion[] = Object.keys(aliasMap)
      .filter((alias) => !allObjects.some((o) => o.toLowerCase() === alias))
      .map((alias) => ({ label: alias, type: "class", detail: "alias/cte", boost: 35 }));
    return {
      from: fromOffset,
      options: dedupeCompletions([...tableOptions, ...cteOptions, ...keywordOptions]),
      validFor: /^[A-Za-z0-9_$]*$/
    };
  }

  // 场景 3：`ORDER BY col ` 后提示 ASC / DESC / LIMIT。
  if (/\border\s+by\s+[^,;]+\s+[A-Za-z]*$/i.test(prefix) && !/\b(?:asc|desc)\s+[A-Za-z]*$/i.test(prefix)) {
    return {
      from: fromOffset,
      options: [
        { label: "ASC", type: "keyword", boost: 40 },
        { label: "DESC", type: "keyword", boost: 40 },
        { label: "LIMIT", type: "keyword", boost: 30 }
      ],
      validFor: /^[A-Za-z]*$/
    };
  }

  // 场景 4：`SELECT` / `WHERE` / `ON` / `HAVING` / `GROUP BY` / `ORDER BY` / `SET` 优先提示当前语句涉及表的字段。
  const referencedTables = Array.from(new Set(Object.values(aliasMap)));
  const scopedCols = referencedTables.flatMap((table) =>
    (mergedObjectFields[table] || []).map((col) => ({
      label: col,
      type: "property" as const,
      detail: table,
      boost: 45
    }))
  );
  const fallbackCols: Completion[] =
    scopedCols.length > 0
      ? scopedCols
      : metadata.fields.map((col) => ({
          label: col,
          type: "property" as const,
          boost: 25
        }));

  if (/\b(?:select|where|having|group\s+by|order\s+by|on|set)\b/i.test(prefix)) {
    // 若当前尚未写 FROM 且字段为空，补充表名方便快速输入 `SELECT * FROM ...` 或 `table.col`。
    const extraTables = fallbackCols.length === 0 ? tableOptions : [];
    return {
      from: fromOffset,
      options: dedupeCompletions([...fallbackCols, ...functionOptions, ...keywordOptions, ...extraTables]),
      validFor: /^[A-Za-z0-9_$]*$/
    };
  }

  // 场景 5：语句开头或通用上下文。
  return {
    from: fromOffset,
    options: dedupeCompletions([...keywordOptions, ...functionOptions, ...tableOptions, ...fallbackCols]),
    validFor: /^[A-Za-z0-9_$]*$/
  };
}

// 创建绑定到 CodeMirror autocompletion 的 CompletionSource。
export function createSqlCompletionSource(getMetadata: () => SqlCompletionMetadata) {
  return (context: CompletionContext): CompletionResult | null => {
    return computeSqlCompletions(
      context.state.doc.toString(),
      context.pos,
      context.explicit,
      getMetadata()
    );
  };
}

// 轻量 SQL 格式化：将核心子句关键字大写并按主子句换行缩进。
export function formatBasicSql(sqlText: string): string {
  const normalized = sqlText.trim();
  if (!normalized) return "";
  const clauseKeywords = [
    "SELECT",
    "FROM",
    "LEFT JOIN",
    "RIGHT JOIN",
    "INNER JOIN",
    "JOIN",
    "WHERE",
    "GROUP BY",
    "HAVING",
    "ORDER BY",
    "LIMIT",
    "OFFSET",
    "UNION ALL",
    "UNION"
  ];
  let result = normalized.replace(/\s+/g, " ");
  for (const kw of clauseKeywords) {
    const pattern = new RegExp(`\\b${kw.replace(/\s+/g, "\\s+")}\\b`, "gi");
    result = result.replace(pattern, kw === "SELECT" ? "SELECT" : `\n${kw}`);
  }
  return result.trim();
}

// 提取顶层主查询的 FROM 对象名（忽略括号内子查询及字符串字面量）。
export function extractMainFromObjectName(soql: string): string | null {
  let depth = 0;
  let inSingleQuote = false;
  let escaped = false;
  let topLevel = "";

  for (let i = 0; i < soql.length; i += 1) {
    const ch = soql[i];
    if (inSingleQuote) {
      if (escaped) {
        escaped = false;
      } else if (ch === "\\") {
        escaped = true;
      } else if (ch === "'") {
        inSingleQuote = false;
      }
      topLevel += " ";
      continue;
    }

    if (ch === "'") {
      inSingleQuote = true;
      topLevel += " ";
      continue;
    }

    if (ch === "(") {
      depth += 1;
      topLevel += " ";
      continue;
    }

    if (ch === ")") {
      depth = Math.max(0, depth - 1);
      topLevel += " ";
      continue;
    }

    topLevel += depth === 0 ? ch : " ";
  }

  const match = topLevel.match(/\bfrom\s+([A-Za-z_][\w]*)\b/i);
  return match?.[1] || null;
}
