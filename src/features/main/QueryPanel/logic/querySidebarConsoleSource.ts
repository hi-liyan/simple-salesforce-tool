import type { SalesforceSource } from "../../../../types/index.ts";

type ResolveConsoleTargetSourceInput = {
  // 全部数据源：用于根据聚焦/选中 ID 解析完整来源上下文。
  sources: SalesforceSource[];
  // 当前树内聚焦数据源 ID。
  focusedSourceId: string;
  // 当前页面兼容层 selectedSourceId。
  selectedSourceId: string;
};

// 解析“查询控制台”按钮应绑定的数据源：优先使用树内聚焦源，缺失时回退到 selectedSourceId。
export function resolveConsoleTargetSource({
  sources,
  focusedSourceId,
  selectedSourceId
}: ResolveConsoleTargetSourceInput): SalesforceSource | null {
  const targetSourceId = focusedSourceId || selectedSourceId;
  if (!targetSourceId) return null;
  return sources.find((source) => source.id === targetSourceId) || null;
}
