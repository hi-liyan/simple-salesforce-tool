import type * as Monaco from "monaco-editor";
import type { MonacoLanguageModule, RuntimeCompletions } from "../types.ts";
import { buildSuggestions, dedupeByLowerCase, dedupeSuggestionsByLabel, normalizeObjectFieldsMap, normalizeQuerySpaces } from "../utils.ts";

type SoqlCompletionContext =
  | "fromObject"
  | "selectField"
  | "whereField"
  | "groupByField"
  | "havingField"
  | "orderByField"
  | "orderByModifier"
  | "limitNumber"
  | "offsetNumber"
  | "general";

const SOQL_LANGUAGE_ID = "soql-smart-v3";
const SOQL_EDITOR_THEME_ID = "soql-light";
const SOQL_COMPLETION_DISPOSABLE_KEY = "__soql_completion_disposable_v3__";

const SOQL_KEYWORDS = [
  "SELECT",
  "FROM",
  "WHERE",
  "ORDER BY",
  "GROUP BY",
  "HAVING",
  "LIMIT",
  "OFFSET",
  "ASC",
  "DESC",
  "NULLS FIRST",
  "NULLS LAST",
  "AND",
  "OR",
  "NOT",
  "IN",
  "NOT IN",
  "LIKE",
  "INCLUDES",
  "EXCLUDES",
  "TYPEOF",
  "WHEN",
  "THEN",
  "ELSE",
  "END",
  "WITH",
  "SECURITY_ENFORCED",
  "FOR VIEW",
  "FOR REFERENCE",
  "ALL ROWS",
  "COUNT",
  "SUM",
  "AVG",
  "MIN",
  "MAX"
];
const CLAUSE_KEYWORDS = ["FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET"];
const FILTER_OPERATOR_KEYWORDS = ["AND", "OR", "NOT", "IN", "NOT IN", "LIKE", "INCLUDES", "EXCLUDES"];
const ORDER_MODIFIER_KEYWORDS = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST"];
const AGGREGATE_FUNCTION_KEYWORDS = ["COUNT", "SUM", "AVG", "MIN", "MAX"];
const SOQL_SINGLE_TOKEN_KEYWORDS = Array.from(
  new Set(
    SOQL_KEYWORDS.flatMap((item) =>
      item
        .split(/\s+/)
        .map((token) => token.trim().toUpperCase())
        .filter((token) => token.length > 0)
    )
  )
);
const SOQL_SINGLE_TOKEN_KEYWORD_SET = new Set<string>(SOQL_SINGLE_TOKEN_KEYWORDS);
const SOQL_SINGLE_TOKEN_KEYWORD_SUGGESTIONS = SOQL_SINGLE_TOKEN_KEYWORDS.filter(
  (token) => !SOQL_KEYWORDS.includes(token)
);

const runtimeCompletions: RuntimeCompletions = { fields: [], objects: [], objectFields: {} };
let initialized = false;

// 获取全局缓存的补全注册句柄（用于 HMR 替换旧实例）。
function getGlobalDisposable(): Monaco.IDisposable | null {
  return (globalThis as Record<string, unknown>)[SOQL_COMPLETION_DISPOSABLE_KEY] as Monaco.IDisposable | null;
}

// 写入全局缓存的补全注册句柄。
function setGlobalDisposable(disposable: Monaco.IDisposable) {
  (globalThis as Record<string, unknown>)[SOQL_COMPLETION_DISPOSABLE_KEY] = disposable;
}

// 将引号中的内容替换为空格，避免字符串字面量里的 FROM 干扰主查询识别。
function maskQuotedContent(soql: string): string {
  let masked = "";
  let quoteOpened = false;

  for (let index = 0; index < soql.length; index += 1) {
    const currentChar = soql[index];
    const previousChar = soql[index - 1] || "";
    if (currentChar === "'" && previousChar !== "\\") {
      quoteOpened = !quoteOpened;
      masked += " "; // 引号本身也替换掉，保证后续边界判断简单稳定。
      continue;
    }
    masked += quoteOpened ? " " : currentChar;
  }

  return masked;
}

// 判断指定位置是否为关键字边界，避免把字段名中的 from 误判成子句关键字。
function isKeywordBoundary(source: string, index: number): boolean {
  if (index < 0 || index >= source.length) return true;
  return !/[A-Za-z0-9_]/.test(source[index]);
}

// 提取顶层 FROM 后的对象名：忽略子查询、括号和字符串字面量。
export function extractMainFromObjectName(soql: string): string | null {
  const maskedSoql = maskQuotedContent(soql);
  let bracketDepth = 0;

  for (let index = 0; index < maskedSoql.length; index += 1) {
    const currentChar = maskedSoql[index];
    if (currentChar === "(") {
      bracketDepth += 1;
      continue;
    }
    if (currentChar === ")") {
      bracketDepth = Math.max(0, bracketDepth - 1);
      continue;
    }
    if (bracketDepth !== 0) {
      continue; // 子查询内部的 FROM 不作为主查询对象来源。
    }

    const fromKeyword = maskedSoql.slice(index, index + 4).toLowerCase();
    if (fromKeyword !== "from") {
      continue;
    }
    if (!isKeywordBoundary(maskedSoql, index - 1) || !isKeywordBoundary(maskedSoql, index + 4)) {
      continue;
    }

    let objectStart = index + 4;
    while (objectStart < maskedSoql.length && /\s/.test(maskedSoql[objectStart])) {
      objectStart += 1; // 跳过 FROM 与对象名之间的空白。
    }
    const objectNameMatch = maskedSoql.slice(objectStart).match(/^[A-Za-z_][\w]*/);
    if (!objectNameMatch) {
      return null;
    }
    return objectNameMatch[0];
  }

  return null;
}

// 判断是否正在输入 FROM 对象名。
function isTypingFromObject(prefixQuery: string): boolean {
  return /\bfrom\s+[A-Za-z_]*[\w]*$/i.test(prefixQuery);
}

// 判定光标所处 SOQL 语义上下文。
function detectCompletionContext(prefixQuery: string): SoqlCompletionContext {
  const normalized = normalizeQuerySpaces(prefixQuery).toUpperCase();
  if (!normalized) return "general";
  if (isTypingFromObject(prefixQuery)) return "fromObject";
  if (/\bLIMIT\s+\d*\s*$/i.test(normalized)) return "limitNumber";
  if (/\bOFFSET\s+\d*\s*$/i.test(normalized)) return "offsetNumber";

  const selectIndex = normalized.lastIndexOf("SELECT ");
  const fromIndex = normalized.lastIndexOf(" FROM ");
  if (selectIndex >= 0 && fromIndex === -1) return "selectField";

  const orderByIndex = normalized.lastIndexOf(" ORDER BY ");
  const havingIndex = normalized.lastIndexOf(" HAVING ");
  const groupByIndex = normalized.lastIndexOf(" GROUP BY ");
  const whereIndex = normalized.lastIndexOf(" WHERE ");
  const limitIndex = normalized.lastIndexOf(" LIMIT ");
  const offsetIndex = normalized.lastIndexOf(" OFFSET ");
  const lastIndex = Math.max(orderByIndex, havingIndex, groupByIndex, whereIndex, limitIndex, offsetIndex);

  if (lastIndex === orderByIndex) {
    if (/\bORDER\s+BY\s+[^,]+?\s+$/i.test(normalized) || /\b(ASC|DESC)\s+$/i.test(normalized)) {
      return "orderByModifier";
    }
    return "orderByField";
  }
  if (lastIndex === havingIndex) return "havingField";
  if (lastIndex === groupByIndex) return "groupByField";
  if (lastIndex === whereIndex) return "whereField";
  if (lastIndex === limitIndex) return "limitNumber";
  if (lastIndex === offsetIndex) return "offsetNumber";
  return "general";
}

// 刷新运行时补全数据。
function updateRuntimeCompletions(runtime: RuntimeCompletions) {
  runtimeCompletions.fields = dedupeByLowerCase(runtime.fields);
  runtimeCompletions.objects = dedupeByLowerCase(runtime.objects);
  runtimeCompletions.objectFields = normalizeObjectFieldsMap(runtime.objectFields);
}

// 注册 SOQL 语法高亮、配色和补全能力。
function ensureSoqlLanguage(monaco: typeof Monaco) {
  if (initialized) return;

  monaco.editor.defineTheme(SOQL_EDITOR_THEME_ID, {
    base: "vs",
    inherit: true,
    rules: [],
    colors: {
      "editor.lineHighlightBorder": "#00000000",
      "editor.lineHighlightBackground": "#eaf4ff"
    }
  });

  monaco.languages.register({ id: SOQL_LANGUAGE_ID });
  monaco.languages.setMonarchTokensProvider(SOQL_LANGUAGE_ID, {
    ignoreCase: true,
    keywords: SOQL_KEYWORDS.map((item) => item.toLowerCase()),
    tokenizer: {
      root: [
        [/[a-zA-Z_][\w.]*/, { cases: { "@keywords": "keyword", "@default": "identifier" } }],
        [/\d+/, "number"],
        [/'.*?'/, "string"],
        [/[(),]/, "delimiter"],
        [/!=|<=|>=|=|<|>/, "operator"],
        [/\s+/, "white"]
      ]
    }
  });

  monaco.languages.setLanguageConfiguration(SOQL_LANGUAGE_ID, {
    brackets: [
      ["(", ")"],
      ["[", "]"]
    ],
    autoClosingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: "'", close: "'" }
    ],
    surroundingPairs: [
      { open: "(", close: ")" },
      { open: "[", close: "]" },
      { open: "'", close: "'" }
    ]
  });

  const previousDisposable = getGlobalDisposable();
  if (previousDisposable) {
    previousDisposable.dispose();
  }

  const completionDisposable = monaco.languages.registerCompletionItemProvider(SOQL_LANGUAGE_ID, {
    triggerCharacters: [" ", ".", ",", ":"],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      // 光标停在关键字词尾时，不用该词做过滤，避免“WHERE 只匹配 where*”。
      const keywordTokenActive = SOQL_SINGLE_TOKEN_KEYWORD_SET.has((word.word || "").toUpperCase());
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
      const fromObjectName = extractMainFromObjectName(fullQuery);
      const scopedFields = fromObjectName ? runtimeCompletions.objectFields[fromObjectName.toLowerCase()] || [] : [];
      const fieldCandidates = fromObjectName ? scopedFields : runtimeCompletions.fields;

      const fieldSuggestions = buildSuggestions(monaco, fieldCandidates, monaco.languages.CompletionItemKind.Field, range);
      const objectSuggestions = buildSuggestions(monaco, runtimeCompletions.objects, monaco.languages.CompletionItemKind.Class, range);
      const keywordSuggestions = buildSuggestions(monaco, SOQL_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      // 追加单词级关键字（如 ORDER / BY），避免多词关键字在前缀过滤时丢失提示。
      const singleTokenKeywordSuggestions = buildSuggestions(
        monaco,
        SOQL_SINGLE_TOKEN_KEYWORD_SUGGESTIONS,
        monaco.languages.CompletionItemKind.Keyword,
        range
      );
      const clauseKeywordSuggestions = buildSuggestions(monaco, CLAUSE_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const filterOperatorSuggestions = buildSuggestions(monaco, FILTER_OPERATOR_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const orderModifierSuggestions = buildSuggestions(monaco, ORDER_MODIFIER_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const aggregateFunctionSuggestions = buildSuggestions(monaco, AGGREGATE_FUNCTION_KEYWORDS, monaco.languages.CompletionItemKind.Function, range);
      const fromKeywordSuggestions = buildSuggestions(monaco, ["FROM"], monaco.languages.CompletionItemKind.Keyword, range);

      const suggestionsByContext: Record<SoqlCompletionContext, Monaco.languages.CompletionItem[]> = {
        // FROM 上下文也保留基础关键字，避免对象列表为空时无候选。
        fromObject: [...objectSuggestions, ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        // SELECT 上下文保留关键字回退，确保关键字始终可提示。
        selectField: [...fieldSuggestions, ...aggregateFunctionSuggestions, ...fromKeywordSuggestions, ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        whereField: [...fieldSuggestions, ...filterOperatorSuggestions, ...clauseKeywordSuggestions, ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        groupByField: [...fieldSuggestions, ...buildSuggestions(monaco, ["HAVING", "ORDER BY", "LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        havingField: [...fieldSuggestions, ...filterOperatorSuggestions, ...buildSuggestions(monaco, ["ORDER BY", "LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        orderByField: [...fieldSuggestions, ...orderModifierSuggestions, ...buildSuggestions(monaco, ["LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        orderByModifier: [...orderModifierSuggestions, ...buildSuggestions(monaco, ["LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        // LIMIT/OFFSET 场景增加关键字回退，便于继续补全下一子句。
        limitNumber: [...buildSuggestions(monaco, ["OFFSET"], monaco.languages.CompletionItemKind.Keyword, range), ...keywordSuggestions, ...singleTokenKeywordSuggestions],
        offsetNumber: [...keywordSuggestions, ...singleTokenKeywordSuggestions],
        general: [...keywordSuggestions, ...singleTokenKeywordSuggestions, ...fieldSuggestions]
      };

      return { suggestions: dedupeSuggestionsByLabel(suggestionsByContext[completionContext]) };
    }
  });

  setGlobalDisposable(completionDisposable);
  initialized = true;
}

// 导出 SOQL 语言模块。
export const soqlLanguageModule: MonacoLanguageModule = {
  languageId: SOQL_LANGUAGE_ID,
  themeId: SOQL_EDITOR_THEME_ID,
  ensureRegistered: ensureSoqlLanguage,
  updateRuntimeCompletions
};
