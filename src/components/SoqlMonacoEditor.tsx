import { QueryMonacoEditor, type QueryMonacoEditorProps } from "./QueryMonacoEditor";

// SOQL 编辑器参数：复用通用查询编辑器参数，固定 language=soql。
type SoqlMonacoEditorProps = Omit<QueryMonacoEditorProps, "language">;

// SOQL 编辑器：对外保持原有组件名，内部委托到通用多语言编辑器。
export function SoqlMonacoEditor(props: SoqlMonacoEditorProps) {
  return <QueryMonacoEditor language="soql" {...props} />;
}

export type { SoqlMonacoEditorProps };
