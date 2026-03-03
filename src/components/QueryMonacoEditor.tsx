import { useEffect, useRef, useState } from "react";
import Editor, { useMonaco } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { getMonacoLanguageModule } from "./monaco/languages";
import type { QueryLanguage } from "./monaco/types";
import { getPlaceholderPosition, type PlaceholderPosition } from "./monaco/utils";

type QueryMonacoEditorProps = {
  // 编辑器语言类型（soql/mysql）。
  language: QueryLanguage;
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
  // 可参与补全的对象/表名。
  objectNames?: string[];
  // 对象/表到字段名列表的映射：用于基于 FROM 对象做上下文补全。
  objectFieldsMap?: Record<string, string[]>;
  // 自动换行模式：默认按视口宽度换行，可按调用方场景覆盖。
  wordWrapMode?: "off" | "on" | "wordWrapColumn" | "bounded";
  // 自动换行列宽：当使用 wordWrapColumn/bounded 时生效。
  wordWrapColumn?: number;
  // 额外样式类名。
  className?: string;
};

// 多语言查询编辑器：按 language 加载独立语言模块。
export function QueryMonacoEditor({
  language,
  value,
  onChange,
  onSelectionTextChange,
  placeholder = "",
  height = "220px",
  fieldNames = [],
  objectNames = [],
  objectFieldsMap = {},
  wordWrapMode = "on",
  wordWrapColumn = 80,
  className = ""
}: QueryMonacoEditorProps) {
  const monaco = useMonaco();
  // 编辑器实例引用：用于读取布局信息并同步占位符位置。
  const editorRef = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  // 布局监听句柄：组件卸载时释放，避免重复注册。
  const layoutDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 选区监听句柄：组件卸载时释放，避免重复注册。
  const selectionDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 内容变更监听句柄：用于输入时主动触发补全弹层。
  const contentDisposeRef = useRef<Monaco.IDisposable | null>(null);
  // 占位符实际定位：默认值作为 Monaco 尚未挂载时的兜底。
  const [placeholderPosition, setPlaceholderPosition] = useState<PlaceholderPosition>({ left: 48, top: 2 });

  // 当前语言模块：承载语法高亮、补全注册和运行时更新能力。
  const languageModule = getMonacoLanguageModule(language);

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
    languageModule.ensureRegistered(monaco);
    // 每次字段/对象变化时刷新补全候选。
    languageModule.updateRuntimeCompletions({
      fields: fieldNames,
      objects: objectNames,
      objectFields: objectFieldsMap
    });
  }, [monaco, languageModule, fieldNames, objectNames, objectFieldsMap]);

  useEffect(() => {
    return () => {
      layoutDisposeRef.current?.dispose(); // 组件卸载时释放 Monaco 布局监听。
      selectionDisposeRef.current?.dispose(); // 组件卸载时释放 Monaco 选区监听。
      contentDisposeRef.current?.dispose(); // 组件卸载时释放内容变更监听。
      layoutDisposeRef.current = null;
      selectionDisposeRef.current = null;
      contentDisposeRef.current = null;
      editorRef.current = null;
    };
  }, []);

  return (
    // 编辑器容器：保留边框/背景，和现有界面视觉保持一致。
    <div className={`soql-monaco-editor relative overflow-hidden border border-base-300 bg-base-100 ${className}`}>
      {/* Monaco 编辑器主体。 */}
      <Editor
        value={value}
        language={languageModule.languageId}
        theme={languageModule.themeId}
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
          contentDisposeRef.current?.dispose();
          contentDisposeRef.current = editor.onDidChangeModelContent((event) => {
            // 输入字母/数字/下划线时主动触发建议，确保前缀场景（如 SELE）稳定弹出关键字。
            const lastChange = event.changes[event.changes.length - 1];
            const insertedText = lastChange?.text || "";
            if (!insertedText) return;
            if (!/[A-Za-z0-9_]/.test(insertedText)) return;
            editor.trigger("query-monaco-editor", "editor.action.triggerSuggest", {});
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
          wordWrap: wordWrapMode,
          wordWrapColumn,
          // 关闭 Monaco 的词汇型建议，避免与自定义补全混合导致候选重复。
          wordBasedSuggestions: "off",
          // 明确开启实时建议，避免依赖 Monaco 默认值在不同版本表现不一致。
          quickSuggestions: {
            other: true,
            comments: false,
            strings: false
          },
          // 将提示延迟降为 0，减少输入关键字前缀时的体感延迟。
          quickSuggestionsDelay: 0,
          // 开启触发字符建议（如空格、点号），确保 provider 可稳定触发。
          suggestOnTriggerCharacters: true,
          renderLineHighlight: "all",
          renderLineHighlightOnlyWhenFocus: false,
          lineNumbers: "on",
          fontSize: 16,
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

export type { QueryMonacoEditorProps };
