import type { QueryTreeNode } from "../types/tree.ts";

// 树节点最近一次点击快照：用于把连续两次点击稳定识别为双击。
export type TreeNodeClickState = {
  nodeId: string;
  timestamp: number;
};

// 树节点双击动作：source/group 双击展开，object 双击打开右侧工作区。
export function resolveNodeDoubleClickAction(node: QueryTreeNode): "toggle" | "open" {
  return node.kind === "object" ? "open" : "toggle";
}

type ResolveNodeClickOutcomeInput = {
  previousClickState: TreeNodeClickState | null;
  nodeId: string;
  timestamp: number;
  thresholdMs?: number;
};

// 解析本次点击结果：同一节点在阈值时间内再次点击时判定为双击。
export function resolveNodeClickOutcome(
  previousClickState: TreeNodeClickState | null,
  nodeId: string,
  timestamp: number,
  thresholdMs = 260
): { isDoubleClick: boolean; nextState: TreeNodeClickState | null } {
  if (
    previousClickState
    && previousClickState.nodeId === nodeId
    && timestamp - previousClickState.timestamp <= thresholdMs
  ) {
    return {
      isDoubleClick: true,
      nextState: null
    };
  }

  return {
    isDoubleClick: false,
    nextState: {
      nodeId,
      timestamp
    }
  };
}

type BuildTreeNodeInteractionClassNameInput = {
  // 当前节点是否高亮（激活对象或聚焦数据源）。
  active: boolean;
};

// 构建树节点交互样式：统一禁用文本选择并保持默认箭头光标。
export function buildTreeNodeInteractionClassName({ active }: BuildTreeNodeInteractionClassNameInput): string {
  const stateClassName = active ? "bg-base-200 text-base-content" : "text-base-content/80 hover:bg-base-200/70";
  return `group flex min-h-[30px] cursor-default select-none items-center gap-1.5 rounded px-2 py-[3px] text-[12px] ${stateClassName}`;
}
