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

// SOQL 编辑器参数：复用通用查询编辑器参数，固定 language=soql。
type SoqlMonacoEditorProps = Omit<QueryMonacoEditorProps, "language">;

// SOQL 编辑器：对外保持原组件名，内部改为按需加载 Monaco。
export function SoqlMonacoEditor(props: SoqlMonacoEditorProps) {
  return (
    // Suspense：在 Monaco 代码分片加载期间显示占位 UI。
    <Suspense fallback={<MonacoEditorLoadingFallback height={props.height} />}>
      {/* 实际编辑器：固定为 SOQL 语法模式。 */}
      <LazyQueryMonacoEditor language="soql" {...props} />
    </Suspense>
  );
}

export type { SoqlMonacoEditorProps };
