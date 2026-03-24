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
  // 当前节点是否被树正式选中。
  selected: boolean;
  // 当前节点是否处于兼容态高亮语义（例如当前激活对象）。
  active: boolean;
};

// 构建树节点交互样式：统一禁用文本选择并保持默认箭头光标。
export function buildTreeNodeInteractionClassName({ selected, active }: BuildTreeNodeInteractionClassNameInput): string {
  const stateClassName = selected
    // 选中态仅保留 1px 浅蓝边框，避免额外阴影让描边看起来偏厚。
    ? "border border-sky-200 bg-sky-100 text-sky-950 hover:border-sky-200 hover:bg-sky-100"
    : active
      ? "border border-transparent text-base-content hover:bg-base-200/70"
      : "border border-transparent text-base-content/80 hover:bg-base-200/70";
  return `group box-border w-full cursor-default select-none rounded transition-colors ${stateClassName}`;
}
