import type { ConsoleVariableLogicalType, DataSourceDriver } from "../../../../drivers/types.ts";
import type { ConsoleManualVariableEntry } from "../../../../store/useSoqlExecutorStore.ts";
import type { ObjectDescribe, QueryResult } from "../../../../types/index.ts";
import { extractFromObjectNames } from "./consoleQueryUtils.ts";

// 支持的 SQL 条件/子句操作符类型：用于基数与类型约束校验。
export type ConsoleVariableOperator =
  | "="
  | "!="
  | "<>"
  | ">"
  | ">="
  | "<"
  | "<="
  | "LIKE"
  | "NOT LIKE"
  | "IN"
  | "NOT IN"
  | "INCLUDES"
  | "EXCLUDES"
  | "BETWEEN"
  | "LIMIT"
  | "OFFSET"
  | "SET"
  | "UNKNOWN";

// 语句中识别到的单个占位符出现位置及上下文信息。
export type ConsolePlaceholderOccurrence = {
  // 变量名（严格区分大小写）。
  name: string;
  // 占位符 `#{...}` 起始字符下标。
  from: number;
  // 占位符 `#{...}` 结束字符下标。
  to: number;
  // 紧邻的操作符。
  operator: ConsoleVariableOperator;
  // 是否属于集合操作符（IN / NOT IN / INCLUDES / EXCLUDES）。
  isCollectionOperator: boolean;
  // 占位符外层是否已被括号包裹（如 IN (#{ids}) 为 true，IN #{ids} 为 false）。
  hasSurroundingParens: boolean;
  // 操作符左侧关联的列名（如 DRIVER_ID 或 o.DRIVER_ID）。
  leftColumn: string;
};

// 查询上下文中单个变量条目（仅存内存，不持久化）。
export type ConsoleContextVariableEntry = {
  // 变量名（字段名或别名，严格区分大小写）。
  name: string;
  // 归一化逻辑类型。
  logicalType: ConsoleVariableLogicalType;
  // 原始底层类型名称（用于展示）。
  rawType: string;
  // 结果集总行数（含 NULL）。
  rowCount: number;
  // 原始值列表（按行顺序保留）。
  values: unknown[];
  // 非空值列表。
  nonNullValues: unknown[];
  // 来源语句下标（0-based）。
  sourceStatementIndex: number;
  // 来源 SQL 摘要。
  sourceSqlPreview: string;
  // 是否因多条不同语句产出同名字段而存在歧义。
  ambiguous: boolean;
  // 冲突来源描述列表（仅 ambiguous=true 时有意义）。
  conflictSources: string[];
};

// 单次执行变量校验错误详情（含具体修改建议）。
export type ConsoleVariableValidationError = {
  // 出错的变量名。
  variableName: string;
  // 错误原因说明。
  message: string;
  // 可操作的修改建议。
  suggestion: string;
};

// 变量解析与绑定结果。
export type ConsoleVariableBindResult =
  | {
      ok: true;
      // 原始模板 SQL（保留 #{var}，用于审计 raw_sql）。
      rawSql: string;
      // 安全展开后的 SQL（用于 SqlGuard 校验、执行与审计 executed_sql）。
      executedSql: string;
      // 本次使用到的变量明细。
      usedVariables: string[];
    }
  | {
      ok: false;
      rawSql: string;
      errors: ConsoleVariableValidationError[];
    };

const COLLECTION_OPERATORS = new Set<ConsoleVariableOperator>(["IN", "NOT IN", "INCLUDES", "EXCLUDES"]);
const COMPARISON_OPERATORS = new Set<ConsoleVariableOperator>([">", ">=", "<", "<=", "BETWEEN"]);

// 判断是否为集合操作符（允许 1..N 条数据）。
export function isCollectionVariableOperator(op: ConsoleVariableOperator): boolean {
  return COLLECTION_OPERATORS.has(op);
}

// 词法扫描 SQL/SOQL 中的 `#{varName}` 占位符，跳过字符串字面量与注释，并解析前置操作符上下文。
export function scanSqlPlaceholders(sql: string): ConsolePlaceholderOccurrence[] {
  const occurrences: ConsolePlaceholderOccurrence[] = [];
  const length = sql.length;
  let i = 0;

  while (i < length) {
    const ch = sql[i];
    const next = sql[i + 1] ?? "";

    // 行内注释：跳过单引号字符串字面量（支持 '' 和 \' 转义）。
    if (ch === "'") {
      i += 1;
      while (i < length) {
        if (sql[i] === "\\" && i + 1 < length) {
          i += 2;
          continue;
        }
        if (sql[i] === "'") {
          if (sql[i + 1] === "'") {
            i += 2;
            continue;
          }
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // 行内注释：跳过双引号字符串/标识符与反引号标识符。
    if (ch === '"' || ch === "`") {
      const quote = ch;
      i += 1;
      while (i < length) {
        if (sql[i] === "\\" && i + 1 < length) {
          i += 2;
          continue;
        }
        if (sql[i] === quote) {
          i += 1;
          break;
        }
        i += 1;
      }
      continue;
    }

    // 行内注释：跳过 `-- ...` 单行注释。
    if (ch === "-" && next === "-") {
      i += 2;
      while (i < length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    // 行内注释：跳过 `/* ... */` 多行注释。
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < length && !(sql[i] === "*" && sql[i + 1] === "/")) {
        i += 1;
      }
      i = Math.min(length, i + 2);
      continue;
    }

    // 行内注释：MySQL `#` 单行注释，但需排除 `#{...}` 占位符前缀！
    if (ch === "#" && next !== "{") {
      i += 1;
      while (i < length && sql[i] !== "\n") {
        i += 1;
      }
      continue;
    }

    // 匹配 `#{varName}` 占位符。
    if (ch === "#" && next === "{") {
      const closeIndex = sql.indexOf("}", i + 2);
      if (closeIndex !== -1) {
        const inner = sql.slice(i + 2, closeIndex).trim();
        if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(inner)) {
          const context = extractOperatorContextBefore(sql, i, closeIndex + 1);
          occurrences.push({
            name: inner,
            from: i,
            to: closeIndex + 1,
            operator: context.operator,
            isCollectionOperator: isCollectionVariableOperator(context.operator),
            hasSurroundingParens: context.hasSurroundingParens,
            leftColumn: context.leftColumn
          });
          i = closeIndex + 1;
          continue;
        }
      }
    }

    i += 1;
  }

  return occurrences;
}

// 从占位符左侧文本回溯提取操作符、外层括号与左列名。
function extractOperatorContextBefore(
  sql: string,
  placeholderFrom: number,
  placeholderTo: number
): { operator: ConsoleVariableOperator; hasSurroundingParens: boolean; leftColumn: string } {
  const beforeRaw = sql.slice(0, placeholderFrom);
  const afterRaw = sql.slice(placeholderTo);
  const beforeTrimmed = beforeRaw.trimEnd();
  const afterTrimmed = afterRaw.trimStart();

  // 检查是否被紧邻的 `(` 和 `)` 包裹，例如 `IN (#{did})`。
  const hasLeftParen = beforeTrimmed.endsWith("(");
  const hasRightParen = afterTrimmed.startsWith(")");
  const hasSurroundingParens = hasLeftParen && hasRightParen;

  const inspectBefore = hasSurroundingParens
    ? beforeTrimmed.slice(0, -1).trimEnd()
    : beforeTrimmed;

  // 行内注释：按优先级从多词关键字到符号操作符依次匹配。
  const multiWordMatch = inspectBefore.match(/\b(NOT\s+IN|NOT\s+LIKE|IN|LIKE|INCLUDES|EXCLUDES|BETWEEN|LIMIT|OFFSET)\s*$/i);
  if (multiWordMatch) {
    const rawOp = multiWordMatch[1].replace(/\s+/g, " ").toUpperCase() as ConsoleVariableOperator;
    const prefixBeforeOp = inspectBefore.slice(0, multiWordMatch.index).trimEnd();
    const leftColumn = extractTrailingColumnName(prefixBeforeOp);
    return { operator: rawOp, hasSurroundingParens, leftColumn };
  }

  // 检查 `BETWEEN ... AND #{b}` 的右边界场景。
  const betweenAndMatch = inspectBefore.match(/\bBETWEEN\s+[^;\n]+?\s+AND\s*$/i);
  if (betweenAndMatch) {
    const prefixBeforeBetween = inspectBefore.slice(0, betweenAndMatch.index).trimEnd();
    return {
      operator: "BETWEEN",
      hasSurroundingParens,
      leftColumn: extractTrailingColumnName(prefixBeforeBetween)
    };
  }

  // 匹配符号操作符：`!=`、`<>`、`>=`、`<=`、`=`、`>`、`<`。
  const symbolMatch = inspectBefore.match(/(!=|<>|>=|<=|=|>|<)\s*$/);
  if (symbolMatch) {
    const rawOp = symbolMatch[1] as ConsoleVariableOperator;
    const prefixBeforeOp = inspectBefore.slice(0, symbolMatch.index).trimEnd();
    // 识别 `UPDATE ... SET col = #{val}` 场景。
    const isUpdateSet = /\bSET\s+(?:[\w.`]+\s*,\s*)*[\w.`]+$/i.test(prefixBeforeOp);
    const leftColumn = extractTrailingColumnName(prefixBeforeOp);
    return {
      operator: isUpdateSet && rawOp === "=" ? "SET" : rawOp,
      hasSurroundingParens,
      leftColumn
    };
  }

  return { operator: "UNKNOWN", hasSurroundingParens, leftColumn: "" };
}

// 从操作符左侧提取紧邻的列名（支持 `table.col` 或反引号包裹）。
function extractTrailingColumnName(prefix: string): string {
  const match = prefix.match(/(`?[A-Za-z_][\w]*`?(?:\.`?[A-Za-z_][\w]*`?)?)\s*$/);
  if (!match) return "";
  return match[1].replace(/`/g, "");
}

// 判断语句是否为可向查询上下文注入变量的 SELECT/WITH 查询。
export function isContextProducingQuery(sql: string): boolean {
  const stripped = sql
    .replace(/^\s*(?:--[^\n]*\n|#[^\n]*\n|\/\*[\s\S]*?\*\/\s*)*/g, "")
    .trim();
  return /^(select|with)\b/i.test(stripped);
}

// 根据 SQL 与元数据推导占位符的期望逻辑类型。
export function inferExpectedVariableType(
  occurrence: ConsolePlaceholderOccurrence,
  sql: string,
  objectDescribeMap: Record<string, ObjectDescribe>,
  driver: DataSourceDriver
): ConsoleVariableLogicalType {
  if (occurrence.operator === "LIMIT" || occurrence.operator === "OFFSET") {
    return "number";
  }
  if (occurrence.operator === "LIKE" || occurrence.operator === "NOT LIKE") {
    return "string";
  }
  if (!occurrence.leftColumn) return "unknown";

  const colParts = occurrence.leftColumn.split(".");
  const fieldName = (colParts[colParts.length - 1] || "").toLowerCase();
  if (!fieldName) return "unknown";

  const fromObjects = extractFromObjectNames(sql);
  for (const objName of fromObjects) {
    const describe =
      objectDescribeMap[objName] ||
      Object.entries(objectDescribeMap).find(([k]) => k.toLowerCase() === objName.toLowerCase())?.[1];
    if (!describe) continue;
    const field = describe.fields.find((item) => item.name.toLowerCase() === fieldName);
    if (field) {
      const rawType = String(
        field.metadata?.columnType || field.metadata?.mysqlDataType || field.dataType || field.metadata?.type || ""
      );
      if (driver.normalizeConsoleFieldType) {
        return driver.normalizeConsoleFieldType(rawType);
      }
      return fallbackNormalizeFieldType(rawType);
    }
  }

  return "unknown";
}

// 通用底层字段类型归一化兜底。
function fallbackNormalizeFieldType(rawType: string): ConsoleVariableLogicalType {
  const base = rawType.trim().toLowerCase().split(/[\s(]/)[0];
  if (!base) return "unknown";
  if (base === "null") return "null";
  if (base === "boolean" || base === "bool") return "boolean";
  if (base === "date") return "date";
  if (base === "datetime" || base === "timestamp") return "datetime";
  if (["tinyint", "smallint", "mediumint", "int", "integer", "bigint", "decimal", "numeric", "float", "double", "real", "number", "currency", "percent"].includes(base)) {
    return "number";
  }
  return "string";
}

// 基于结果样本推断逻辑类型（用于无 columnTypes 与 describe 时的兜底）。
function inferLogicalTypeFromValues(nonNullValues: unknown[]): ConsoleVariableLogicalType {
  if (nonNullValues.length === 0) return "unknown";
  const sample = nonNullValues.slice(0, 20);
  if (sample.every((v) => typeof v === "boolean")) return "boolean";
  if (sample.every((v) => typeof v === "number" && Number.isFinite(v))) return "number";
  if (sample.every((v) => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v.trim()))) return "date";
  if (
    sample.every(
      (v) =>
        typeof v === "string" &&
        /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}/.test(v.trim())
    )
  ) {
    return "datetime";
  }
  return "string";
}

// 从 SELECT 查询结果中提取可注入上下文的变量列表（别名优先，结果集列名即字段/别名）。
export function extractContextVariablesFromResult(input: {
  sql: string;
  statementIndex: number;
  result: QueryResult;
  objectDescribeMap: Record<string, ObjectDescribe>;
  driver: DataSourceDriver;
}): ConsoleContextVariableEntry[] {
  const { sql, statementIndex, result, objectDescribeMap, driver } = input;
  if (!isContextProducingQuery(sql)) return [];

  const records = result.records || [];
  const columnNameSet = new Set<string>();

  // 优先从 columnTypes 提取列顺序，再补充 records 键名（排除 Salesforce attributes）。
  if (result.columnTypes) {
    Object.keys(result.columnTypes).forEach((key) => {
      if (key && key !== "attributes") columnNameSet.add(key);
    });
  }
  records.forEach((rec) => {
    Object.keys(rec).forEach((key) => {
      if (key && key !== "attributes") columnNameSet.add(key);
    });
  });

  const sqlPreview = sql.replace(/\s+/g, " ").trim().slice(0, 60);
  const fromObjects = extractFromObjectNames(sql);
  const entries: ConsoleContextVariableEntry[] = [];

  columnNameSet.forEach((colName) => {
    // 行内注释：仅收集合法标识符形态的列名/别名，避免 COUNT(*) 等无法作为 #{var} 的列名污染上下文。
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(colName)) return;

    const values = records.map((rec) => rec[colName]);
    const nonNullValues = values.filter((v) => v !== null && v !== undefined);

    let rawType = result.columnTypes?.[colName]?.trim() || "";
    if (!rawType && fromObjects.length > 0) {
      for (const objName of fromObjects) {
        const describe =
          objectDescribeMap[objName] ||
          Object.entries(objectDescribeMap).find(([k]) => k.toLowerCase() === objName.toLowerCase())?.[1];
        const field = describe?.fields.find((f) => f.name.toLowerCase() === colName.toLowerCase());
        if (field) {
          rawType = String(field.metadata?.columnType || field.dataType || field.metadata?.type || "");
          break;
        }
      }
    }

    let logicalType: ConsoleVariableLogicalType = rawType
      ? driver.normalizeConsoleFieldType
        ? driver.normalizeConsoleFieldType(rawType)
        : fallbackNormalizeFieldType(rawType)
      : "unknown";

    if (logicalType === "unknown") {
      logicalType = inferLogicalTypeFromValues(nonNullValues);
    }

    entries.push({
      name: colName,
      logicalType,
      rawType: rawType || logicalType,
      rowCount: records.length,
      values,
      nonNullValues,
      sourceStatementIndex: statementIndex,
      sourceSqlPreview: sqlPreview,
      ambiguous: false,
      conflictSources: [`语句 #${statementIndex + 1}`]
    });
  });

  return entries;
}

// 合并上下文变量：同一语句重跑时覆盖旧值；不同语句产出同名字段时标记歧义冲突。
export function mergeConsoleContextVariables(
  current: Record<string, ConsoleContextVariableEntry>,
  incoming: ConsoleContextVariableEntry[],
  statementIndex: number
): Record<string, ConsoleContextVariableEntry> {
  const next: Record<string, ConsoleContextVariableEntry> = {};

  // 第一步：保留非当前语句产出的已有变量（并清理已移除语句的冲突引用）。
  Object.entries(current).forEach(([key, entry]) => {
    if (entry.sourceStatementIndex !== statementIndex) {
      next[key] = entry;
    }
  });

  // 第二步：合并新语句产出的变量，严格区分大小写。
  incoming.forEach((item) => {
    const existing = next[item.name];
    if (!existing) {
      next[item.name] = item;
      return;
    }
    const mergedConflicts = Array.from(
      new Set([...existing.conflictSources, `语句 #${statementIndex + 1}`])
    );
    next[item.name] = {
      ...existing,
      ambiguous: true,
      conflictSources: mergedConflicts
    };
  });

  return next;
}

// 校验手工输入值或上下文值与目标类型/操作符是否兼容，并返回归一化值。
function validateScalarValueForConstraint(input: {
  varName: string;
  rawValue: unknown;
  actualType: ConsoleVariableLogicalType;
  expectedType: ConsoleVariableLogicalType;
  operator: ConsoleVariableOperator;
}): { ok: true; finalType: ConsoleVariableLogicalType; value: unknown } | { ok: false; error: ConsoleVariableValidationError } {
  const { varName, rawValue, actualType, expectedType, operator } = input;

  if (rawValue === null || rawValue === undefined || actualType === "null") {
    return {
      ok: false,
      error: {
        variableName: varName,
        message: `变量 #{${varName}} 的值为 NULL，不能直接用于条件 \`${operator}\`。`,
        suggestion: `在 SQL 中判断空值请改用 \`IS NULL\` / \`IS NOT NULL\`，或确保前置查询返回非空值。`
      }
    };
  }

  // LIMIT / OFFSET 强制非负整数。
  if (operator === "LIMIT" || operator === "OFFSET") {
    const text = String(rawValue).trim();
    if (!/^\d+$/.test(text)) {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `\`${operator}\` 后面的变量 #{${varName}} 必须是非负整数，当前值为 "${text}"（类型：${actualType}）。`,
          suggestion: `请将 #{${varName}} 修改为非负整数（如 10 或 100）。`
        }
      };
    }
    return { ok: true, finalType: "number", value: Number(text) };
  }

  // LIKE / NOT LIKE 强制字符串。
  if (operator === "LIKE" || operator === "NOT LIKE") {
    if (actualType !== "string" && actualType !== "unknown") {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `\`${operator}\` 条件后的变量 #{${varName}} 必须是字符串类型，当前类型为 ${actualType}。`,
          suggestion: `请确保 #{${varName}} 为文本模式（如 '%abc%'），或将类型切换为 String。`
        }
      };
    }
    return { ok: true, finalType: "string", value: String(rawValue) };
  }

  // 范围比较符禁止布尔类型。
  if (COMPARISON_OPERATORS.has(operator) && actualType === "boolean") {
    return {
      ok: false,
      error: {
        variableName: varName,
        message: `比较条件 \`${operator}\` 不支持布尔类型变量 #{${varName}}。`,
        suggestion: `请改用等值条件 \`=\` 或提供数值/日期类型变量。`
      }
    };
  }

  // 目标类型决定最终校验：优先采用左列期望类型，其次采用变量自身类型。
  const targetType: ConsoleVariableLogicalType =
    expectedType !== "unknown" ? expectedType : actualType !== "unknown" ? actualType : "string";

  if (targetType === "number") {
    const text = String(rawValue).trim();
    if (!/^-?\d+(?:\.\d+)?$/.test(text)) {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `变量 #{${varName}} 期望为数值（number）类型，但当前值 "${text}"（类型：${actualType}）无法作为合法数字。`,
          suggestion: `请检查前置查询字段或输入值是否为纯数字，或确认左侧列类型是否匹配。`
        }
      };
    }
    return { ok: true, finalType: "number", value: text };
  }

  if (targetType === "boolean") {
    const text = String(rawValue).trim().toLowerCase();
    if (!["true", "false", "1", "0"].includes(text)) {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `变量 #{${varName}} 期望为布尔（boolean）类型，当前值 "${String(rawValue)}" 不合法。`,
          suggestion: `请输入 true / false 或 1 / 0。`
        }
      };
    }
    return { ok: true, finalType: "boolean", value: text === "true" || text === "1" };
  }

  if (targetType === "date") {
    const text = String(rawValue).trim();
    if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `变量 #{${varName}} 期望为日期（date, YYYY-MM-DD）类型，当前值 "${text}" 格式不匹配。`,
          suggestion: `请使用 YYYY-MM-DD 格式（例如 2026-11-27）。`
        }
      };
    }
    return { ok: true, finalType: "date", value: text };
  }

  if (targetType === "datetime") {
    const text = String(rawValue).trim();
    if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(text)) {
      return {
        ok: false,
        error: {
          variableName: varName,
          message: `变量 #{${varName}} 期望为日期时间（datetime）类型，当前值 "${text}" 格式不匹配。`,
          suggestion: `请使用标准日期时间格式（例如 2026-11-27 10:30:00 或 ISO8601）。`
        }
      };
    }
    return { ok: true, finalType: "datetime", value: text };
  }

  return { ok: true, finalType: "string", value: String(rawValue) };
}

// 拆分手工输入的集合文本（支持换行或英文逗号分隔）。
export function splitManualListValues(rawText: string): string[] {
  return rawText
    .split(/[\r\n,]+/)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

// 解析并安全展开 SQL/SOQL 中的所有 `#{varName}` 占位符，执行唯一性、基数与类型约束校验。
export function resolveAndBindConsoleVariables(input: {
  sql: string;
  contextVariables: Record<string, ConsoleContextVariableEntry>;
  manualVariables: Record<string, ConsoleManualVariableEntry>;
  objectDescribeMap: Record<string, ObjectDescribe>;
  driver: DataSourceDriver;
}): ConsoleVariableBindResult {
  const { sql, contextVariables, manualVariables, objectDescribeMap, driver } = input;
  const occurrences = scanSqlPlaceholders(sql);

  if (occurrences.length === 0) {
    return {
      ok: true,
      rawSql: sql,
      executedSql: sql,
      usedVariables: []
    };
  }

  const errors: ConsoleVariableValidationError[] = [];
  const replacements: Array<{ from: number; to: number; text: string }> = [];
  const usedVariableSet = new Set<string>();
  const formatLiteral = driver.formatConsoleVariableLiteral || ((v) => `'${String(v).replace(/'/g, "\\'")}'`);

  for (const occ of occurrences) {
    usedVariableSet.add(occ.name);
    const expectedType = inferExpectedVariableType(occ, sql, objectDescribeMap, driver);
    const ctxEntry = contextVariables[occ.name];
    const manualEntry = manualVariables[occ.name];
    const useManual = !ctxEntry || Boolean(manualEntry?.overrideContext);

    if (!useManual && ctxEntry) {
      // 1. 唯一性冲突校验。
      if (ctxEntry.ambiguous) {
        errors.push({
          variableName: occ.name,
          message: `变量 #{${occ.name}} 在查询上下文中不唯一（同时来源于 ${ctxEntry.conflictSources.join("、")}）。`,
          suggestion: `请为前置查询中的字段指定唯一别名（例如 SELECT ${occ.name} AS ${occ.name}_alias ...），或在右侧面板点击“覆写”手动指定值。`
        });
        continue;
      }

      // 2. 基数约束校验。
      if (occ.isCollectionOperator) {
        if (ctxEntry.nonNullValues.length === 0) {
          errors.push({
            variableName: occ.name,
            message: `前置查询（语句 #${ctxEntry.sourceStatementIndex + 1}）返回了 ${ctxEntry.rowCount} 条数据（有效非空值 0 条），无法构建有效的 \`${occ.operator}\` 列表。`,
            suggestion: `请检查前置查询条件确保至少返回 1 条非空记录，或在右侧面板覆写该变量。`
          });
          continue;
        }

        const formattedItems: string[] = [];
        let itemFailed = false;
        for (const val of ctxEntry.nonNullValues) {
          const checked = validateScalarValueForConstraint({
            varName: occ.name,
            rawValue: val,
            actualType: ctxEntry.logicalType,
            expectedType,
            operator: occ.operator
          });
          if (!checked.ok) {
            errors.push(checked.error);
            itemFailed = true;
            break;
          }
          formattedItems.push(formatLiteral(checked.value, checked.finalType));
        }
        if (itemFailed) continue;

        const joined = formattedItems.join(", ");
        replacements.push({
          from: occ.from,
          to: occ.to,
          text: occ.hasSurroundingParens ? joined : `(${joined})`
        });
        continue;
      }

      // 标量操作符严格要求 1 条数据。
      if (ctxEntry.rowCount !== 1) {
        errors.push({
          variableName: occ.name,
          message:
            ctxEntry.rowCount === 0
              ? `条件 \`${occ.operator}\` 要求变量 #{${occ.name}} 必须有 1 条数据，但前置查询返回了 0 条。`
              : `条件 \`${occ.operator}\` 仅允许 1 条数据，但上下文中 #{${occ.name}} 包含 ${ctxEntry.rowCount} 条数据。`,
          suggestion:
            ctxEntry.rowCount === 0
              ? `请调整前置查询条件确保返回 1 条结果，或在右侧面板“覆写”手动输入值。`
              : `请将条件 \`${occ.operator} #{${occ.name}}\` 改为 \`IN (#{${occ.name}})\`，或在前置查询末尾加上 \`LIMIT 1\`。`
        });
        continue;
      }

      const checked = validateScalarValueForConstraint({
        varName: occ.name,
        rawValue: ctxEntry.values[0],
        actualType: ctxEntry.logicalType,
        expectedType,
        operator: occ.operator
      });
      if (!checked.ok) {
        errors.push(checked.error);
        continue;
      }
      replacements.push({
        from: occ.from,
        to: occ.to,
        text: formatLiteral(checked.value, checked.finalType)
      });
      continue;
    }

    // 3. 手工输入路径（上下文无此变量，或用户开启了覆写）。
    const rawInput = manualEntry?.value ?? "";
    if (!rawInput.trim()) {
      // 检查是否存在仅大小写差异的上下文变量，给出精准提醒。
      const caseDiffMatch = Object.keys(contextVariables).find(
        (key) => key !== occ.name && key.toLowerCase() === occ.name.toLowerCase()
      );
      errors.push({
        variableName: occ.name,
        message: `缺少变量 #{${occ.name}} 的值，无法执行查询。`,
        suggestion: caseDiffMatch
          ? `变量名严格区分大小写：上下文中存在 \`${caseDiffMatch}\`，请将占位符修改为 #{${caseDiffMatch}}，或在右侧变量面板输入 #{${occ.name}} 的值。`
          : `请在右侧“变量”面板中为 #{${occ.name}} 输入有效值后再执行。`
      });
      continue;
    }

    const typeOverride = manualEntry?.typeOverride;
    const effectiveManualType: ConsoleVariableLogicalType =
      typeOverride && typeOverride !== "auto" && typeOverride !== "list"
        ? typeOverride
        : expectedType !== "unknown"
          ? expectedType
          : inferLogicalTypeFromValues([rawInput.trim()]);

    if (occ.isCollectionOperator) {
      const items = splitManualListValues(rawInput);
      if (items.length === 0) {
        errors.push({
          variableName: occ.name,
          message: `集合条件 \`${occ.operator}\` 的变量 #{${occ.name}} 不能为空列表。`,
          suggestion: `请在右侧输入框中填写至少一个值（支持逗号或换行分隔多个值）。`
        });
        continue;
      }

      const formattedItems: string[] = [];
      let itemFailed = false;
      for (const item of items) {
        const itemActualType =
          typeOverride && typeOverride !== "auto" && typeOverride !== "list"
            ? typeOverride
            : inferLogicalTypeFromValues([item]);
        const checked = validateScalarValueForConstraint({
          varName: occ.name,
          rawValue: item,
          actualType: itemActualType,
          expectedType,
          operator: occ.operator
        });
        if (!checked.ok) {
          errors.push(checked.error);
          itemFailed = true;
          break;
        }
        formattedItems.push(formatLiteral(checked.value, checked.finalType));
      }
      if (itemFailed) continue;

      const joined = formattedItems.join(", ");
      replacements.push({
        from: occ.from,
        to: occ.to,
        text: occ.hasSurroundingParens ? joined : `(${joined})`
      });
      continue;
    }

    const checked = validateScalarValueForConstraint({
      varName: occ.name,
      rawValue: rawInput,
      actualType: effectiveManualType,
      expectedType,
      operator: occ.operator
    });
    if (!checked.ok) {
      errors.push(checked.error);
      continue;
    }
    replacements.push({
      from: occ.from,
      to: occ.to,
      text: formatLiteral(checked.value, checked.finalType)
    });
  }

  if (errors.length > 0) {
    return {
      ok: false,
      rawSql: sql,
      errors
    };
  }

  // 按位置从后向前替换，确保下标不偏移。
  let executedSql = sql;
  const sorted = [...replacements].sort((a, b) => b.from - a.from);
  for (const rep of sorted) {
    executedSql = executedSql.slice(0, rep.from) + rep.text + executedSql.slice(rep.to);
  }

  return {
    ok: true,
    rawSql: sql,
    executedSql,
    usedVariables: Array.from(usedVariableSet)
  };
}
