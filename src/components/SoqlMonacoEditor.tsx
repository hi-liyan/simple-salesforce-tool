import { useEffect, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";

type SoqlMonacoEditorProps = {
  // 编辑器当前值。
  value: string;
  // 编辑器内容变更回调。
  onChange: (value: string) => void;
  // 编辑器占位提示。
  placeholder?: string;
  // 编辑器高度。
  height?: string;
  // 可参与补全的字段名。
  fieldNames?: string[];
  // 可参与补全的对象名。
  objectNames?: string[];
  // 额外样式类名。
  className?: string;
};

const SOQL_LANGUAGE_ID = "soql";
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
};

type PlaceholderPosition = {
  left: number;
  top: number;
};

let initialized = false;
const runtimeCompletions: RuntimeCompletions = { fields: [], objects: [] };

// 将补全集合更新为去重后的有序列表，供语言服务实时读取。
function updateRuntimeCompletions(fieldNames: string[], objectNames: string[]) {
  runtimeCompletions.fields = dedupeByLowerCase(fieldNames);
  runtimeCompletions.objects = dedupeByLowerCase(objectNames);
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

  monaco.languages.registerCompletionItemProvider(SOQL_LANGUAGE_ID, {
    triggerCharacters: [" ", ".", ","],
    provideCompletionItems: (model, position) => {
      const word = model.getWordUntilPosition(position);
      const range = {
        startLineNumber: position.lineNumber,
        endLineNumber: position.lineNumber,
        startColumn: word.startColumn,
        endColumn: word.endColumn
      };

      // 根据关键字、字段与对象生成补全候选。
      const suggestions = [
        ...SOQL_KEYWORDS.map((keyword) => ({
          label: keyword,
          kind: monaco.languages.CompletionItemKind.Keyword,
          insertText: keyword,
          range
        })),
        ...runtimeCompletions.fields.map((fieldName) => ({
          label: fieldName,
          kind: monaco.languages.CompletionItemKind.Field,
          insertText: fieldName,
          range
        })),
        ...runtimeCompletions.objects.map((objectName) => ({
          label: objectName,
          kind: monaco.languages.CompletionItemKind.Class,
          insertText: objectName,
          range
        }))
      ];

      return { suggestions };
    }
  });

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
  placeholder = "",
  height = "220px",
  fieldNames = [],
  objectNames = [],
  className = ""
}: SoqlMonacoEditorProps) {
  const monaco = useMonaco();
  // 编辑器实例引用：用于读取布局信息并同步占位符位置。
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // 布局监听句柄：组件卸载时释放，避免重复注册。
  const layoutDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 占位符实际定位：默认值作为 Monaco 尚未挂载时的兜底。
  const [placeholderPosition, setPlaceholderPosition] = useState<PlaceholderPosition>({ left: 48, top: 2 });

  useEffect(() => {
    if (!monaco) return;
    ensureSoqlLanguage(monaco);
    // 每次字段/对象变化时刷新补全候选。
    updateRuntimeCompletions(fieldNames, objectNames);
  }, [monaco, fieldNames, objectNames]);

  useEffect(() => {
    return () => {
      layoutDisposeRef.current?.dispose(); // 组件卸载时释放 Monaco 布局监听。
      layoutDisposeRef.current = null;
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
        }}
        onChange={(nextValue) => {
          // 保证上层拿到稳定字符串，避免 undefined 状态分支。
          onChange(nextValue ?? "");
        }}
        options={{
          minimap: { enabled: false },
          wordWrap: "on",
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: false,
          lineNumbers: "on",
          fontSize: 12,
          tabSize: 2,
          automaticLayout: true,
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
