import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTreeNodeInteractionClassName,
  resolveNodeClickOutcome,
  resolveNodeDoubleClickAction
} from "../../src/features/main/QueryPanel/logic/sourceTreeInteractions.ts";
import type { QueryTreeNode } from "../../src/features/main/QueryPanel/types/tree.ts";

// 创建最小 source 节点：用于验证双击动作分发。
function createSourceNode(): QueryTreeNode {
  return {
    id: "source:sf-1",
    kind: "source",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "Org A",
    sourceColor: "#3b82f6",
    label: "Org A",
    expandable: true
  };
}

// 创建最小 group 节点：用于验证双击仍保持展开语义。
function createGroupNode(): QueryTreeNode {
  return {
    id: "group:sf-1:tables",
    kind: "group",
    sourceId: "sf-1",
    sourceType: "mysql",
    groupType: "tables",
    label: "tables",
    expandable: true
  };
}

// 创建最小 object 节点：用于验证双击打开对象工作区。
function createObjectNode(): QueryTreeNode {
  return {
    id: "object:sf-1:Account",
    kind: "object",
    sourceId: "sf-1",
    sourceType: "salesforce",
    objectName: "Account",
    label: "Account",
    queryable: true,
    expandable: false
  };
}

test("resolveNodeDoubleClickAction: source 双击应触发刷新", () => {
  assert.equal(resolveNodeDoubleClickAction(createSourceNode()), "refresh");
});

test("resolveNodeDoubleClickAction: group 双击应保持展开切换", () => {
  assert.equal(resolveNodeDoubleClickAction(createGroupNode()), "toggle");
});

test("resolveNodeDoubleClickAction: object 双击应打开对象工作区", () => {
  assert.equal(resolveNodeDoubleClickAction(createObjectNode()), "open");
});

test("buildTreeNodeInteractionClassName: 树节点应禁用文本选择并使用默认箭头光标", () => {
  const className = buildTreeNodeInteractionClassName({
    selected: false,
    active: false
  });

  assert.match(className, /\bselect-none\b/);
  assert.match(className, /\bcursor-default\b/);
  assert.match(className, /\bw-full\b/);
});

test("buildTreeNodeInteractionClassName: 选中节点应显示浅蓝色整行高亮", () => {
  const className = buildTreeNodeInteractionClassName({
    selected: true,
    active: false
  });

  assert.match(className, /\bbg-sky-100\b/);
  assert.match(className, /\btext-sky-950\b/);
});

test("resolveNodeClickOutcome: 同一节点连续点击应判定为双击", () => {
  const firstClick = resolveNodeClickOutcome(null, "source:sf-1", 1000, 260);
  assert.equal(firstClick.isDoubleClick, false);
  assert.deepEqual(firstClick.nextState, {
    nodeId: "source:sf-1",
    timestamp: 1000
  });

  const secondClick = resolveNodeClickOutcome(firstClick.nextState, "source:sf-1", 1200, 260);
  assert.equal(secondClick.isDoubleClick, true);
  assert.equal(secondClick.nextState, null);
});

test("resolveNodeClickOutcome: 超过阈值或切换节点时不应判定为双击", () => {
  const firstClick = resolveNodeClickOutcome(null, "object:sf-1:Account", 1000, 260);
  const timeoutClick = resolveNodeClickOutcome(firstClick.nextState, "object:sf-1:Account", 1400, 260);
  const otherNodeClick = resolveNodeClickOutcome(firstClick.nextState, "object:sf-1:Contact", 1100, 260);

  assert.equal(timeoutClick.isDoubleClick, false);
  assert.deepEqual(timeoutClick.nextState, { nodeId: "object:sf-1:Account", timestamp: 1400 });
  assert.equal(otherNodeClick.isDoubleClick, false);
  assert.deepEqual(otherNodeClick.nextState, { nodeId: "object:sf-1:Contact", timestamp: 1100 });
});
