import type * as Monaco from "monaco-editor";
import type { MonacoLanguageModule, RuntimeCompletions } from "../types";
import { buildSuggestions, dedupeByLowerCase, dedupeSuggestionsByLabel, normalizeObjectFieldsMap, normalizeQuerySpaces } from "../utils";

type MysqlCompletionContext = "table" | "field" | "orderModifier" | "number" | "general";

const MYSQL_LANGUAGE_ID = "mysql-smart-v1";
const MYSQL_EDITOR_THEME_ID = "mysql-light";
const MYSQL_COMPLETION_DISPOSABLE_KEY = "__mysql_completion_disposable_v1__";

const MYSQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "GROUP BY",
  "HAVING",
  "ORDER BY",
  "LIMIT",
  "OFFSET",
  "JOIN",
  "LEFT JOIN",
  "RIGHT JOIN",
  "INNER JOIN",
  "ON",
  "AND",
  "OR",
  "NOT",
  "IN",
  "LIKE",
  "BETWEEN",
  "IS NULL",
  "IS NOT NULL",
  "ASC",
  "DESC",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX",
  "NOW",
  "CURDATE",
  "DATE_FORMAT",
  "DATE_ADD",
  "DATE_SUB",
  "IFNULL",
  "COALESCE"
];
const ORDER_MODIFIER_KEYWORDS = ["ASC", "DESC"];
const MYSQL_SINGLE_TOKEN_KEYWORDS = Array.from(
  new Set(
    MYSQL_KEYWORDS.flatMap((item) =>
      item
        .split(/\s+/)
        .map((token) => token.trim().toUpperCase())
        .filter((token) => token.length > 0)
    )
  )
);
const MYSQL_SINGLE_TOKEN_KEYWORD_SET = new Set<string>(MYSQL_SINGLE_TOKEN_KEYWORDS);

const runtimeCompletions: RuntimeCompletions = { fields: [], objects: [], objectFields: {} };
let initialized = false;

// 获取全局缓存的补全注册句柄（用于 HMR 替换旧实例）。
function getGlobalDisposable(): Monaco.IDisposable | null {
  return (globalThis as Record<string, unknown>)[MYSQL_COMPLETION_DISPOSABLE_KEY] as Monaco.IDisposable | null;
}

// 写入全局缓存的补全注册句柄。
function setGlobalDisposable(disposable: Monaco.IDisposable) {
  (globalThis as Record<string, unknown>)[MYSQL_COMPLETION_DISPOSABLE_KEY] = disposable;
}

// 提取主查询、CTE 及 JOIN 中的表名与别名映射（支持 `WITH cte AS (...)`、`FROM users u`、`JOIN orders AS o`）。
function extractTableAliasMap(query: string): Record<string, string> {
  const aliasMap: Record<string, string> = {};
  const cteRegex = /\b(?:with|,)\s+`?([A-Za-z_][\w$]*)`?\s+as\s*\(/gi;
  let cteMatch: RegExpExecArray | null;
  while ((cteMatch = cteRegex.exec(query)) !== null) {
    const cteName = cteMatch[1]?.toLowerCase();
    if (cteName) aliasMap[cteName] = cteName;
  }
  const regex = /\b(?:from|join)\s+`?([A-Za-z_][\w$]*)`?(?:\s+(?:as\s+)?`?([A-Za-z_][\w$]*)`?)?/gi;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(query)) !== null) {
    const tableName = match[1];
    if (!tableName) continue;
    const lowerTable = tableName.toLowerCase();
    aliasMap[lowerTable] = lowerTable;
    const maybeAlias = match[2];
    if (maybeAlias && !MYSQL_SINGLE_TOKEN_KEYWORD_SET.has(maybeAlias.toUpperCase())) {
      aliasMap[maybeAlias.toLowerCase()] = lowerTable;
    }
  }
  return aliasMap;
}

// 解析光标前是否处于 `alias.` 或 `table.` 限定符上下文。
function extractQualifierBeforeCursor(prefixQuery: string): string | null {
  const match = prefixQuery.match(/`?([A-Za-z_][\w$]*)`?\.\w*$/);
  return match?.[1]?.toLowerCase() || null;
}

// 判断是否正在输入表名（FROM/JOIN 后）。
function isTypingTable(prefixQuery: string): boolean {
  return /\b(from|join)\s+`?[A-Za-z_]*[\w$]*$/i.test(prefixQuery);
}

// 判断是否处于 ORDER BY 修饰符输入位置。
function isTypingOrderModifier(prefixQuery: string): boolean {
  return /\border\s+by\s+[^,]+\s+$/i.test(prefixQuery) || /\b(asc|desc)\s+$/i.test(prefixQuery);
}

// 判断是否处于 LIMIT/OFFSET 数值输入位置。
function isTypingNumberContext(prefixQuery: string): boolean {
  const normalized = normalizeQuerySpaces(prefixQuery);
  return /\b(limit|offset)\s+\d*$/i.test(normalized);
}

// 判定 SQL 补全上下文。
function detectCompletionContext(prefixQuery: string): MysqlCompletionContext {
  if (isTypingTable(prefixQuery)) return "table";
  if (isTypingOrderModifier(prefixQuery)) return "orderModifier";
  if (isTypingNumberContext(prefixQuery)) return "number";

  const normalized = normalizeQuerySpaces(prefixQuery).toUpperCase();
  if (/\b(SELECT|WHERE|HAVING|GROUP BY|ORDER BY|ON)\b/.test(normalized)) {
    return "field";
  }
  return "general";
}

// 刷新运行时补全数据。
function updateRuntimeCompletions(runtime: RuntimeCompletions) {
  runtimeCompletions.fields = dedupeByLowerCase(runtime.fields);
  runtimeCompletions.objects = dedupeByLowerCase(runtime.objects);
  runtimeCompletions.objectFields = normalizeObjectFieldsMap(runtime.objectFields);
}

// 注册 MySQL 语法高亮、配色和补全能力。
function ensureMysqlLanguage(monaco: typeof Monaco) {
  if (initialized) return;

  monaco.editor.defineTheme(MYSQL_EDITOR_THEME_ID, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBorder": "#00000000",
      "editor.lineHighlightBackground": "#f1f7ff"
    }
  });

  monaco.languages.register({ id: MYSQL_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(MYSQL_LANGUAGE_ID, {
    ignoreCase: true,
    keywords: MYSQL_KEYWORDS.map((item) => item.toLowerCase()),
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w$]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/`[^`]*`/, "identifier"],
        [/\d+/, "number"],
        [/'.*?'/, "string"],
        [/".*?"/, "string"],
        [/[(),.]/, "delimiter"],
        [/!=|<=|>=|=|<|>/, "operator"],
        [/\s+/, "white"]
      ]
    }
  });

  monaco.languages.setLanguageConfiguration(MYSQL_LANGUAGE_ID, {
    brackets: [["(", ")"]],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: "`", close: "`" }
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: "'", close: "'" },
      { open: '"', close: '"' },
      { open: "`", close: "`" }
    ]
  });

  const previousDisposable = getGlobalDisposable();
  if (previousDisposable) {
    previousDisposable.dispose();
  }

  const completionDisposable = monaco.languages.registerCompletionItemProvider(MYSQL_LANGUAGE_ID, {
    triggerCharacters: [" ", ".", ",", "`"],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      // 光标停在关键字词尾时，不用该词做过滤，避免关键字候选被收窄。
      const keywordTokenActive = MYSQL_SINGLE_TOKEN_KEYWORD_SET.has((word.word || "").toUpperCase());
      const fullQuery = model.getValue();
      const prefixQuery = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: keywordTokenActive ? position.column : word.startColumn,
        endColumn: keywordTokenActive ? position.column : word.endColumn
      };

      const completionContext = detectCompletionContext(prefixQuery);
      const aliasMap = extractTableAliasMap(fullQuery);
      const qualifier = extractQualifierBeforeCursor(prefixQuery);
      const qualifiedTable = qualifier ? aliasMap[qualifier] || qualifier : null;

      let fieldCandidates: string[];
      if (qualifiedTable && runtimeCompletions.objectFields[qualifiedTable]) {
        fieldCandidates = runtimeCompletions.objectFields[qualifiedTable];
      } else {
        const referencedTables = Array.from(new Set(Object.values(aliasMap)));
        const scopedFields = referencedTables.flatMap((table) => runtimeCompletions.objectFields[table] || []);
        fieldCandidates = scopedFields.length > 0 ? dedupeByLowerCase(scopedFields) : runtimeCompletions.fields;
      }

      const keywordSuggestions = buildSuggestions(monaco, MYSQL_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const tableSuggestions = buildSuggestions(monaco, runtimeCompletions.objects, monaco.languages.CompletionItemKind.Class, range);
      const fieldSuggestions = buildSuggestions(monaco, fieldCandidates, monaco.languages.CompletionItemKind.Field, range);
      const orderModifierSuggestions = buildSuggestions(monaco, ORDER_MODIFIER_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);

      if (qualifiedTable) {
        return { suggestions: dedupeSuggestionsByLabel(fieldSuggestions) };
      }

      const suggestionsByContext: Record<MysqlCompletionContext, Monaco.languages.CompletionItem[]> = {
        // FROM/JOIN 场景保留关键字回退，避免表列表为空时无候选。
        table: [...tableSuggestions, ...keywordSuggestions],
        field: [...fieldSuggestions, ...keywordSuggestions],
        orderModifier: [...orderModifierSuggestions, ...buildSuggestions(monaco, ["LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range)],
        // 数值上下文允许继续补全关键字，便于快速衔接后续子句。
        number: [...buildSuggestions(monaco, ["OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions],
        general: [...keywordSuggestions, ...fieldSuggestions, ...tableSuggestions]
      };

      return { suggestions: dedupeSuggestionsByLabel(suggestionsByContext[completionContext]) };
    }
  });

  const hoverDisposable = monaco.languages.registerHoverProvider(MYSQL_LANGUAGE_ID, {
    provideHover: (model, position) => {
      const word = model.getWordAtPosition(position);
      if (!word) return null;
      const lowerWord = word.word.toLowerCase();
      const aliasMap = extractTableAliasMap(model.getValue());
      const resolvedTable = aliasMap[lowerWord] || lowerWord;
      const fields = runtimeCompletions.objectFields[resolvedTable];
      if (!fields || fields.length === 0) return null;
      const preview = fields.slice(0, 16).join(", ");
      const suffix = fields.length > 16 ? ` ... (+${fields.length - 16})` : "";
      return {
        contents: [
          { value: `**表 \`${resolvedTable}\`** (${fields.length} 个字段)` },
          { value: `\`${preview}${suffix}\`` }
        ]
      };
    }
  });

  const formattingDisposable = monaco.languages.registerDocumentFormattingEditProvider(MYSQL_LANGUAGE_ID, {
    provideDocumentFormattingEdits: (model) => {
      const formatted = formatBasicSql(model.getValue());
      return [
        {
          range: model.getFullModelRange(),
          text: formatted
        }
      ];
    }
  });

  setGlobalDisposable({
    dispose: () => {
      completionDisposable.dispose();
      hoverDisposable.dispose();
      formattingDisposable.dispose();
    }
  });
  initialized = true;
}

// 轻量 SQL 格式化：将核心子句关键字大写并按主子句换行缩进。
export function formatBasicSql(sql: string): string {
  const normalized = sql.trim();
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

// 导出 MySQL 语言模块。
export const mysqlLanguageModule: MonacoLanguageModule = {
  languageId: MYSQL_LANGUAGE_ID,
  themeId: MYSQL_EDITOR_THEME_ID,
  ensureRegistered: ensureMysqlLanguage,
  updateRuntimeCompletions
};
