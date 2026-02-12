import { useEffect, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type SoqlMonacoEditorProps = {
  // 编辑器当前值。
  value: string;
  // 编辑器内容变更回调。
  onChange: (value: string) => void;
  // 编辑器选中文本变化回调：无选中时返回空字符串。
  onSelectionTextChange?: (selectionText: string) => void;
  // 编辑器占位提示。
  placeholder?: string;
  // 编辑器高度。
  height?: string;
  // 可参与补全的字段名。
  fieldNames?: string[];
  // 可参与补全的对象名。
  objectNames?: string[];
  // 对象到字段名列表的映射：用于基于 FROM 对象做上下文补全。
  objectFieldsMap?: Record<string, string[]>;
  // 额外样式类名。
  className?: string;
};

// 语言 ID 使用版本化命名，避免历史 HMR 残留 provider 污染当前补全结果。
const SOQL_LANGUAGE_ID = "soql-smart-v2";
const SOQL_EDITOR_THEME_ID = "soql-light";
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

type RuntimeCompletions = {
  fields: string[];
  objects: string[];
  objectFields: Record<string, string[]>;
};

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

type PlaceholderPosition = {
  left: number;
  top: number;
};

let initialized = false;
const runtimeCompletions: RuntimeCompletions = { fields: [], objects: [], objectFields: {} };
const SOQL_COMPLETION_DISPOSABLE_KEY = "__soql_completion_disposable__";
const CLAUSE_KEYWORDS = ["FROM", "WHERE", "GROUP BY", "HAVING", "ORDER BY", "LIMIT", "OFFSET"];
const FILTER_OPERATOR_KEYWORDS = ["AND", "OR", "NOT", "IN", "NOT IN", "LIKE", "INCLUDES", "EXCLUDES"];
const ORDER_MODIFIER_KEYWORDS = ["ASC", "DESC", "NULLS FIRST", "NULLS LAST"];
const AGGREGATE_FUNCTION_KEYWORDS = ["COUNT", "SUM", "AVG", "MIN", "MAX"];

// 将补全集合更新为去重后的有序列表，供语言服务实时读取。
function updateRuntimeCompletions(fieldNames: string[], objectNames: string[], objectFieldsMap: Record<string, string[]>) {
  runtimeCompletions.fields = dedupeByLowerCase(fieldNames);
  runtimeCompletions.objects = dedupeByLowerCase(objectNames);
  runtimeCompletions.objectFields = normalizeObjectFieldsMap(objectFieldsMap);
}

// SOQL 语言初始化：注册语法高亮、括号规则与补全提供器。
function ensureSoqlLanguage(monaco: typeof Monaco) {
  if (initialized) return;

  // SOQL 编辑器专用主题：移除当前行边框，并使用浅蓝色高亮当前行。
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

  // HMR 场景下会重复执行模块初始化：先释放旧补全提供器，避免候选重复。
  const previousDisposable = getGlobalSoqlCompletionDisposable();
  if (previousDisposable) {
    previousDisposable.dispose();
  }

  const completionDisposable = monaco.languages.registerCompletionItemProvider(SOQL_LANGUAGE_ID, {
    triggerCharacters: [" ", ".", ","],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const fullSoql = model.getValue();
      const prefixSoql = model.getValueInRange({
        startLineNumber: 1,
        startColumn: 1,
        endLineNumber: position.lineNumber,
        endColumn: position.column
      });
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };
      const completionContext = detectCompletionContext(prefixSoql);
      const fromObjectName = extractMainFromObjectName(fullSoql);
      const scopedFields = fromObjectName ? runtimeCompletions.objectFields[fromObjectName.toLowerCase()] || [] : [];
      const fieldCandidates = fromObjectName ? scopedFields : runtimeCompletions.fields;
      // 字段候选：若已识别 FROM 对象，则仅提示该对象字段；否则使用外部字段集合。
      const fieldSuggestions = buildSuggestions(monaco, fieldCandidates, monaco.languages.CompletionItemKind.Field, range);
      // 对象候选：仅在 FROM 子句对象输入时使用，避免 SELECT/WHERE 混入对象名。
      const objectSuggestions = buildSuggestions(monaco, runtimeCompletions.objects, monaco.languages.CompletionItemKind.Class, range);
      const clauseKeywordSuggestions = buildSuggestions(monaco, CLAUSE_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const filterOperatorSuggestions = buildSuggestions(monaco, FILTER_OPERATOR_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const orderModifierSuggestions = buildSuggestions(monaco, ORDER_MODIFIER_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range);
      const aggregateFunctionSuggestions = buildSuggestions(monaco, AGGREGATE_FUNCTION_KEYWORDS, monaco.languages.CompletionItemKind.Function, range);
      const fromKeywordSuggestions = buildSuggestions(monaco, ["FROM"], monaco.languages.CompletionItemKind.Keyword, range);

      const suggestionsByContext: Record<SoqlCompletionContext, Monaco.languages.CompletionItem[]> = {
        fromObject: objectSuggestions,
        selectField: [...fieldSuggestions, ...aggregateFunctionSuggestions, ...fromKeywordSuggestions],
        whereField: [...fieldSuggestions, ...filterOperatorSuggestions, ...clauseKeywordSuggestions],
        groupByField: [...fieldSuggestions, ...buildSuggestions(monaco, ["HAVING", "ORDER BY", "LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range)],
        havingField: [...fieldSuggestions, ...filterOperatorSuggestions, ...buildSuggestions(monaco, ["ORDER BY", "LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range)],
        orderByField: [...fieldSuggestions, ...orderModifierSuggestions, ...buildSuggestions(monaco, ["LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range)],
        orderByModifier: [...orderModifierSuggestions, ...buildSuggestions(monaco, ["LIMIT", "OFFSET"], monaco.languages.CompletionItemKind.Keyword, range)],
        limitNumber: buildSuggestions(monaco, ["OFFSET"], monaco.languages.CompletionItemKind.Keyword, range),
        offsetNumber: [],
        general: [
          ...buildSuggestions(monaco, SOQL_KEYWORDS, monaco.languages.CompletionItemKind.Keyword, range),
          ...fieldSuggestions
        ]
      };

      return { suggestions: dedupeSuggestionsByLabel(suggestionsByContext[completionContext]) };
    }
  });
  setGlobalSoqlCompletionDisposable(completionDisposable);

  initialized = true;
}

// 不区分大小写去重，避免补全列表重复项过多。
function dedupeByLowerCase(items: string[]): string[] {
  const map = new Map<string, string>();
  items.forEach((item) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) {
      map.set(key, trimmed);
    }
  });
  return Array.from(map.values());
}

// 构建 Monaco 补全项集合，统一补全标签、插入内容与范围。
function buildSuggestions(
  monaco: typeof Monaco,
  items: string[],
  kind: Monaco.languages.CompletionItemKind,
  range: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  return items.map((item) => ({
    label: item,
    kind,
    insertText: item,
    range
  }));
}

// 按标签去重补全项，避免同一候选在多规则命中时重复显示。
function dedupeSuggestionsByLabel(items: Monaco.languages.CompletionItem[]): Monaco.languages.CompletionItem[] {
  const labelSet = new Set<string>();
  return items.filter((item) => {
    const label = String(item.label).toLowerCase();
    if (labelSet.has(label)) return false;
    labelSet.add(label);
    return true;
  });
}

// 读取全局缓存的 SOQL 补全注册句柄（用于 HMR 时去重）。
function getGlobalSoqlCompletionDisposable(): Monaco.IDisposable | null {
  return (globalThis as Record<string, unknown>)[SOQL_COMPLETION_DISPOSABLE_KEY] as Monaco.IDisposable | null;
}

// 将 SOQL 补全注册句柄写入全局缓存，便于后续替换旧实例。
function setGlobalSoqlCompletionDisposable(disposable: Monaco.IDisposable) {
  (globalThis as Record<string, unknown>)[SOQL_COMPLETION_DISPOSABLE_KEY] = disposable;
}

// 统一归一化对象字段映射：对象名按小写索引，字段去重后保留原始大小写。
function normalizeObjectFieldsMap(objectFieldsMap: Record<string, string[]>): Record<string, string[]> {
  return Object.entries(objectFieldsMap).reduce(
    (acc, [objectName, fields]) => {
      const trimmedObjectName = objectName.trim();
      if (!trimmedObjectName) return acc;
      acc[trimmedObjectName.toLowerCase()] = dedupeByLowerCase(fields);
      return acc;
    },
    {} as Record<string, string[]>
  );
}

// 提取主查询 FROM 后的对象名，用于将字段补全收敛到目标对象。
function extractMainFromObjectName(soql: string): string | null {
  const match = soql.match(/\bfrom\s+([A-Za-z_][\w]*)/i);
  return match?.[1] || null;
}

// 判断光标是否处于 FROM 子句对象输入位置。
function isTypingFromObject(prefixSoql: string): boolean {
  return /\bfrom\s+[A-Za-z_]*[\w]*$/i.test(prefixSoql);
}

// 判断光标所在的 SOQL 语义上下文，用于精确区分字段/对象/关键字补全。
function detectCompletionContext(prefixSoql: string): SoqlCompletionContext {
  const normalized = normalizeSoqlSpaces(prefixSoql).toUpperCase();
  if (!normalized) return "general";
  if (isTypingFromObject(prefixSoql)) return "fromObject";
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

// 归一化空白字符，减少换行/多空格对上下文判定的干扰。
function normalizeSoqlSpaces(text: string): string {
  return text.replace(/\s+/g, " ").trimEnd();
}

// 基于 Monaco 实际布局计算占位符位置，确保显示在第 1 行文本起始处。
function getPlaceholderPosition(editor: Monaco.editor.IStandaloneCodeEditor): PlaceholderPosition {
  const layoutInfo = editor.getLayoutInfo();
  return {
    left: layoutInfo.contentLeft,
    top: editor.getTopForLineNumber(1) + 2
  };
}

// SOQL 编辑器：基于 Monaco（VSCode 开源编辑器内核）封装，提供高亮与补全。
export function SoqlMonacoEditor({
  value,
  onChange,
  onSelectionTextChange,
  placeholder = "",
  height = "220px",
  fieldNames = [],
  objectNames = [],
  objectFieldsMap = {},
  className = ""
}: SoqlMonacoEditorProps) {
  const monaco = useMonaco();
  // 编辑器实例引用：用于读取布局信息并同步占位符位置。
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // 布局监听句柄：组件卸载时释放，避免重复注册。
  const layoutDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 选区监听句柄：组件卸载时释放，避免重复注册。
  const selectionDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 占位符实际定位：默认值作为 Monaco 尚未挂载时的兜底。
  const [placeholderPosition, setPlaceholderPosition] = useState<PlaceholderPosition>({ left: 48, top: 2 });

  // 将当前选区文本同步到上层：无选区时回传空字符串。
  function emitSelectionText(editor: Monaco.editor.IStandaloneCodeEditor) {
    if (!onSelectionTextChange) return;
    const selection = editor.getSelection();
    if (!selection || selection.isEmpty()) {
      onSelectionTextChange("");
      return;
    }
    const selectionText = editor.getModel()?.getValueInRange(selection) ?? "";
    onSelectionTextChange(selectionText);
  }

  useEffect(() => {
    if (!monaco) return;
    ensureSoqlLanguage(monaco);
    // 每次字段/对象变化时刷新补全候选。
    updateRuntimeCompletions(fieldNames, objectNames, objectFieldsMap);
  }, [monaco, fieldNames, objectNames, objectFieldsMap]);

  useEffect(() => {
    return () => {
      layoutDisposeRef.current?.dispose(); // 组件卸载时释放 Monaco 布局监听。
      selectionDisposeRef.current?.dispose(); // 组件卸载时释放 Monaco 选区监听。
      layoutDisposeRef.current = null;
      selectionDisposeRef.current = null;
      editorRef.current = null;
    };
  }, []);

  return (
    // 编辑器容器：保留边框/背景，和现有界面视觉保持一致。
    <div className={`soql-monaco-editor relative overflow-hidden border border-base-300 bg-base-100 ${className}`}>
      {/* Monaco 编辑器主体。 */}
      <Editor
        value={value}
        language={SOQL_LANGUAGE_ID}
        theme={SOQL_EDITOR_THEME_ID}
        height={height}
        onMount={(editor) => {
          editorRef.current = editor;
          setPlaceholderPosition(getPlaceholderPosition(editor)); // 初次挂载后立即同步占位符位置。
          layoutDisposeRef.current?.dispose();
          layoutDisposeRef.current = editor.onDidLayoutChange(() => {
            setPlaceholderPosition(getPlaceholderPosition(editor)); // 编辑器尺寸变化时保持占位符与行号对齐。
          });
          selectionDisposeRef.current?.dispose();
          selectionDisposeRef.current = editor.onDidChangeCursorSelection(() => {
            emitSelectionText(editor); // 选区变化时同步到上层，供“仅执行选中内容”使用。
          });
          emitSelectionText(editor); // 初次挂载后立即同步一次选区状态。
        }}
        onChange={(nextValue) => {
          // 保证上层拿到稳定字符串，避免 undefined 状态分支。
          onChange(nextValue ?? "");
          if (editorRef.current) {
            emitSelectionText(editorRef.current); // 内容变化时同步选区文本，避免选区失效后状态滞留。
          }
        }}
        options={{
          minimap: { enabled: false },
          wordWrap: "on",
          // 关闭 Monaco 的词汇型建议，避免与自定义 SOQL 补全混合导致“看起来重复”。
          wordBasedSuggestions: "off",
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: false,
          lineNumbers: "on",
          fontSize: 12,
          tabSize: 2,
          automaticLayout: true,
          suggest: {
            showWords: false,
            showSnippets: false
          },
          scrollbar: {
            verticalScrollbarSize: 8,
            horizontalScrollbarSize: 8
          }
        }}
      />
      {/* 占位提示：仅在内容为空时展示，避免遮挡真实内容。 */}
      {!value && placeholder ? (
        <span
          className="pointer-events-none absolute text-[12px] text-neutral/40"
          style={{ left: placeholderPosition.left, top: placeholderPosition.top }}
        >
          {placeholder}
        </span>
      ) : null}
    </div>
  );
}
