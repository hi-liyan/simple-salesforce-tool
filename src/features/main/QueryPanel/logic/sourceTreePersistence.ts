import type { SalesforceSource } from "../../../../types/index.ts";

// 左树可持久化的最小 UI 状态：仅保存高亮、聚焦与展开信息。
export type PersistedSourceTreeUiState = {
  // 当前高亮的节点 ID。
  selectedNodeId: string;
  // 当前聚焦的数据源 ID。
  focusedSourceId: string;
  // 当前已展开的节点 ID 列表。
  expandedNodeIds: string[];
};

// 归一化持久化快照：过滤脏数据并去重，确保后续恢复逻辑稳定。
export function normalizePersistedSourceTreeUiState(
  state?: Partial<PersistedSourceTreeUiState> | null
): PersistedSourceTreeUiState {
  const expandedNodeIds = Array.isArray(state?.expandedNodeIds)
    ? Array.from(new Set(state.expandedNodeIds.filter((item): item is string => typeof item === "string" && item.length > 0)))
    : [];

  return {
    selectedNodeId: typeof state?.selectedNodeId === "string" ? state.selectedNodeId : "",
    focusedSourceId: typeof state?.focusedSourceId === "string" ? state.focusedSourceId : "",
    expandedNodeIds
  };
}

// 构建树默认高亮：优先沿用显式选中节点，其次回退到聚焦 source 根节点。
export function buildSelectedNodeId(selectedNodeId: string, focusedSourceId: string): string {
  if (selectedNodeId) return selectedNodeId;
  return focusedSourceId ? `source:${focusedSourceId}` : "";
}

// 解析节点归属的数据源 ID：供恢复高亮与展开状态时复用。
export function resolveSourceIdFromTreeNodeId(nodeId: string): string {
  if (!nodeId) return "";
  if (nodeId.startsWith("source:")) {
    return nodeId.slice("source:".length);
  }

  const segments = nodeId.split(":");
  if (segments.length < 3) return "";
  if (segments[0] !== "group" && segments[0] !== "object") return "";
  return segments[1] || "";
}

// 统一按左树显示顺序挑选首个 source，避免 fallback 与 UI 排序不一致。
export function getFirstSortedSourceId(sources: SalesforceSource[]): string {
  return [...sources]
    .sort((a, b) => {
      const sortDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
      if (sortDiff !== 0) return sortDiff;
      return a.name.localeCompare(b.name, "zh-CN");
    })[0]?.id || "";
}

// 根据持久化快照与当前数据源列表裁剪无效节点，并补齐稳定 fallback。
export function sanitizePersistedSourceTreeUiState(
  state: PersistedSourceTreeUiState,
  sources: SalesforceSource[],
  preferredSourceId = ""
): PersistedSourceTreeUiState {
  const normalizedState = normalizePersistedSourceTreeUiState(state);
  const sourceIdSet = new Set(sources.map((source) => source.id));
  const fallbackSourceId = preferredSourceId && sourceIdSet.has(preferredSourceId)
    ? preferredSourceId
    : getFirstSortedSourceId(sources);

  const focusedSourceId = sourceIdSet.has(normalizedState.focusedSourceId)
    ? normalizedState.focusedSourceId
    : fallbackSourceId;
  const selectedNodeSourceId = resolveSourceIdFromTreeNodeId(normalizedState.selectedNodeId);
  const selectedNodeId = selectedNodeSourceId && sourceIdSet.has(selectedNodeSourceId)
    ? normalizedState.selectedNodeId
    : buildSelectedNodeId("", focusedSourceId);

  return {
    selectedNodeId,
    focusedSourceId,
    expandedNodeIds: normalizedState.expandedNodeIds.filter((nodeId) => {
      const sourceId = resolveSourceIdFromTreeNodeId(nodeId);
      return Boolean(sourceId) && sourceIdSet.has(sourceId);
    })
  };
}

// 生成 Arborist 初始展开映射：仅在树首次挂载时注入。
export function buildInitialOpenState(expandedNodeIds: string[]): Record<string, boolean> {
  return expandedNodeIds.reduce<Record<string, boolean>>((acc, nodeId) => {
    if (!nodeId) return acc;
    acc[nodeId] = true;
    return acc;
  }, {});
}

// 汇总恢复树展示所需预加载的数据源：展开节点、高亮节点、聚焦节点都应尝试恢复。
export function collectRestorableSourceIds(
  state: PersistedSourceTreeUiState,
  sources: SalesforceSource[]
): string[] {
  const sourceIdSet = new Set(sources.map((source) => source.id));
  const sourceIds = new Set<string>();

  if (state.focusedSourceId && sourceIdSet.has(state.focusedSourceId)) {
    sourceIds.add(state.focusedSourceId);
  }

  const selectedNodeSourceId = resolveSourceIdFromTreeNodeId(state.selectedNodeId);
  if (selectedNodeSourceId && sourceIdSet.has(selectedNodeSourceId)) {
    sourceIds.add(selectedNodeSourceId);
  }

  state.expandedNodeIds.forEach((nodeId) => {
    const sourceId = resolveSourceIdFromTreeNodeId(nodeId);
    if (!sourceId || !sourceIdSet.has(sourceId)) return;
    sourceIds.add(sourceId);
  });

  return [...sourceIds];
}
