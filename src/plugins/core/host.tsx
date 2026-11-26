import { Suspense, lazy, useEffect, useMemo } from "react";
import { ErrorBoundary } from "../../components/ErrorBoundary.tsx";
import { getPlugin } from "./registry.ts";
import type { PluginContext } from "./types.ts";

type PluginHostProps = {
  // 目标插件 ID。
  pluginId: string;
  // 注入的插件运行时上下文。
  ctx: PluginContext;
  // 可选启动参数。
  launchParams?: Record<string, unknown>;
};

// 插件渲染宿主：统一负责懒加载、生命周期触发与异常边界隔离。
export function PluginHost({ pluginId, ctx, launchParams }: PluginHostProps) {
  const manifest = getPlugin(pluginId);

  const LazyPluginComponent = useMemo(() => {
    if (!manifest) return null;
    return lazy(manifest.component);
  }, [manifest]);

  useEffect(() => {
    if (!manifest) return;
    void manifest.onActivate?.(ctx);
    return () => {
      void manifest.onDeactivate?.(ctx);
    };
  }, [manifest, ctx]);

  if (!manifest || !LazyPluginComponent) {
    return (
      <div className="flex h-full w-full items-center justify-center p-6 text-[13px] text-neutral/60">
        未找到插件：{pluginId}
      </div>
    );
  }

  return (
    <ErrorBoundary>
      <Suspense
        fallback={
          <div className="flex h-full w-full items-center justify-center p-6 text-[13px] text-neutral/60">
            正在加载插件 {manifest.name}...
          </div>
        }
      >
        <LazyPluginComponent ctx={ctx} launchParams={launchParams} />
      </Suspense>
    </ErrorBoundary>
  );
}
