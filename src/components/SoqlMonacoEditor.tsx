import { CodeMirrorQueryEditor, type CodeMirrorQueryEditorProps } from "./codemirror/CodeMirrorQueryEditor";

// SOQL 编辑器参数：基于 CodeMirror 6 查询编辑器，固定 language=soql。
type SoqlMonacoEditorProps = Omit<CodeMirrorQueryEditorProps, "language"> & {
  wordWrapColumn?: number;
};

// SOQL 编辑器：使用 CodeMirror 6 + 自研 statement-scoped 补全引擎，首帧即时可交互。
export function SoqlMonacoEditor({ wordWrapColumn: _wordWrapColumn, ...props }: SoqlMonacoEditorProps) {
  return <CodeMirrorQueryEditor language="soql" {...props} />;
}

export type { SoqlMonacoEditorProps };
