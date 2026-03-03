import { QueryMonacoEditor, type QueryMonacoEditorProps } from "./QueryMonacoEditor";

// SQL 编辑器参数：复用通用查询编辑器参数，固定 language=mysql。
type SqlMonacoEditorProps = Omit<QueryMonacoEditorProps, "language">;

// SQL(MySQL) 编辑器：与 SOQL 编辑器独立导出，便于后续扩展更多语言。
export function SqlMonacoEditor(props: SqlMonacoEditorProps) {
  return <QueryMonacoEditor language="mysql" {...props} />;
}

export type { SqlMonacoEditorProps };
