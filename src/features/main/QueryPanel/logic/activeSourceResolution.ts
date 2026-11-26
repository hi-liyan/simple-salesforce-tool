import type { SalesforceSource } from "../../../../types/index.ts";
import type { QueryWorkspaceTabItem } from "../types.ts";

type ResolveWorkingSourceInput = {
  // 全部可用数据源。
  sources: SalesforceSource[];
  // 当前激活的工作区 Tab（data 或 console）。
  activeWorkspaceTab?: QueryWorkspaceTabItem | null;
  // 左侧数据源树当前聚焦的数据源 ID。
  focusedSourceId?: string;
  // 全局记录的当前选中数据源 ID。
  selectedSourceId?: string;
};

// 解析当前工作数据源：
// 优先级：1. 当前激活工作区 Tab 绑定的数据源 -> 2. 左侧树聚焦数据源 -> 3. 全局 selectedSourceId -> 4. 列表首个数据源。
export function resolveWorkingSource({
  sources,
  activeWorkspaceTab,
  focusedSourceId,
  selectedSourceId
}: ResolveWorkingSourceInput): SalesforceSource | null {
  if (sources.length === 0) return null;

  const candidateIds = [
    activeWorkspaceTab?.sourceId || "",
    focusedSourceId || "",
    selectedSourceId || ""
  ].filter(Boolean);

  for (const id of candidateIds) {
    const matched = sources.find((item) => item.id === id);
    if (matched) return matched;
  }

  return sources[0] || null;
}
