import { Suspense, lazy } from "react";
import { MonacoEditorLoadingFallback } from "./MonacoEditorLoadingFallback";
import type { QueryMonacoEditorProps } from "./QueryMonacoEditor";

// 懒加载通用查询编辑器：将 Monaco 相关代码拆出首包。
const LazyQueryMonacoEditor = lazy(async () => {
  const module = await import("./QueryMonacoEditor");
  return {
    default: module.QueryMonacoEditor
  };
});

// SQL 编辑器参数：复用通用查询编辑器参数，固定 language=mysql。
type SqlMonacoEditorProps = Omit<QueryMonacoEditorProps, "language">;

// SQL(MySQL) 编辑器：按需加载 Monaco，减少主包体积。
export function SqlMonacoEditor(props: SqlMonacoEditorProps) {
  return (
    // Suspense：在 Monaco 代码分片加载期间显示占位 UI。
    <Suspense fallback={<MonacoEditorLoadingFallback height={props.height} />}>
      {/* 实际编辑器：固定为 MySQL 语法模式。 */}
      <LazyQueryMonacoEditor language="mysql" {...props} />
    </Suspense>
  );
}

export type { SqlMonacoEditorProps };
