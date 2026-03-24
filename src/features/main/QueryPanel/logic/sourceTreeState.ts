import type { SourceTreeState } from "../types/tree.ts";

// 聚焦指定数据源：仅更新树内的当前焦点，不代表全局查询上下文。
export function focusSourceNode(state: SourceTreeState, sourceId: string): SourceTreeState {
  return {
    ...state,
    focusedSourceId: sourceId
  };
}

// 展开/折叠节点：统一复用到 source/group 两层节点。
export function toggleExpandedNode(expandedNodeIds: string[], nodeId: string): string[] {
  return expandedNodeIds.includes(nodeId)
    ? expandedNodeIds.filter((item) => item !== nodeId)
    : [...expandedNodeIds, nodeId];
}

// 开始刷新单个数据源：清理旧错误并标记刷新态。
export function beginRefreshingSource(state: SourceTreeState, sourceId: string): SourceTreeState {
  return {
    ...state,
    sourceRefreshingById: {
      ...state.sourceRefreshingById,
      [sourceId]: true
    },
    sourceErrorById: {
      ...state.sourceErrorById,
      [sourceId]: ""
    }
  };
}

// 结束刷新单个数据源：根据结果写回错误信息。
export function finishRefreshingSource(state: SourceTreeState, sourceId: string, errorMessage = ""): SourceTreeState {
  return {
    ...state,
    sourceRefreshingById: {
      ...state.sourceRefreshingById,
      [sourceId]: false
    },
    sourceErrorById: {
      ...state.sourceErrorById,
      [sourceId]: errorMessage
    }
  };
}
