import { CodeMirrorQueryEditor, type CodeMirrorQueryEditorProps } from "./codemirror/CodeMirrorQueryEditor";

// SQL 编辑器参数：基于 CodeMirror 6 查询编辑器，固定 language=mysql。
type SqlMonacoEditorProps = Omit<CodeMirrorQueryEditorProps, "language"> & {
  wordWrapColumn?: number;
};

// SQL(MySQL) 编辑器：使用 CodeMirror 6 + 自研 statement-scoped 补全引擎（对齐 dbx 实现）。
export function SqlMonacoEditor({ wordWrapColumn: _wordWrapColumn, ...props }: SqlMonacoEditorProps) {
  return <CodeMirrorQueryEditor language="mysql" {...props} />;
}

export type { SqlMonacoEditorProps };
