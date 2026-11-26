import type { SalesforceSource } from "../../../../types/index.ts";

type ResolveConsoleTargetSourceInput = {
  // 全部数据源：用于根据聚焦/选中 ID 解析完整来源上下文。
  sources: SalesforceSource[];
  // 当前激活工作区 Tab 所属的数据源 ID（最高优先级）。
  activeWorkspaceSourceId?: string;
  // 当前树内聚焦数据源 ID。
  focusedSourceId: string;
  // 当前页面兼容层 selectedSourceId。
  selectedSourceId: string;
};

// 解析“查询控制台”按钮应绑定的数据源：
// 优先级：1. 当前激活工作区 Tab 所属数据源 -> 2. 树内聚焦源 -> 3. selectedSourceId -> 4. 首个可用源。
export function resolveConsoleTargetSource({
  sources,
  activeWorkspaceSourceId,
  focusedSourceId,
  selectedSourceId
}: ResolveConsoleTargetSourceInput): SalesforceSource | null {
  if (sources.length === 0) return null;
  const candidateIds = [activeWorkspaceSourceId || "", focusedSourceId, selectedSourceId].filter(Boolean);
  for (const id of candidateIds) {
    const matched = sources.find((source) => source.id === id);
    if (matched) return matched;
  }
  return sources[0] || null;
}
