import test from "node:test";
import assert from "node:assert/strict";
import {
  buildTreeNodeInteractionClassName,
  resolveNodeClickOutcome,
  resolveNodeDoubleClickAction
} from "../../src/features/main/QueryPanel/logic/sourceTreeInteractions.ts";
import type { QueryTreeNode } from "../../src/features/main/QueryPanel/types/tree.ts";

// 构造最小 source 节点：覆盖双击行为测试所需字段。
function createSourceNode(): QueryTreeNode {
  return {
    id: "source:sf-1",
    kind: "source",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "Salesforce",
    sourceColor: "",
    label: "Salesforce",
    expandable: true
  };
}

// 构造最小 group 节点：覆盖双击行为测试所需字段。
function createGroupNode(): QueryTreeNode {
  return {
    id: "group:mysql-1:tables",
    kind: "group",
    sourceId: "mysql-1",
    sourceType: "mysql",
    groupType: "tables",
    label: "tables",
    expandable: true
  };
}

// 构造最小 object 节点：覆盖双击行为测试所需字段。
function createObjectNode(sourceType: string, objectName: string): QueryTreeNode {
  return {
    id: `object:${sourceType}:${objectName}`,
    kind: "object",
    sourceId: sourceType === "mysql" ? "mysql-1" : "sf-1",
    sourceType,
    objectName,
    label: objectName,
    queryable: true,
    expandable: false
  };
}

test("resolveNodeDoubleClickAction: source 与 group 应双击展开，object 应双击打开右侧 tab", () => {
  assert.equal(resolveNodeDoubleClickAction(createSourceNode()), "toggle");
  assert.equal(resolveNodeDoubleClickAction(createGroupNode()), "toggle");
  assert.equal(resolveNodeDoubleClickAction(createObjectNode("mysql", "users")), "open");
  assert.equal(resolveNodeDoubleClickAction(createObjectNode("salesforce", "Account")), "open");
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

test("resolveNodeClickOutcome: 同一节点在阈值内再次点击时应判定为双击", () => {
  const firstClick = resolveNodeClickOutcome(null, "object:mysql:users", 1000);
  assert.equal(firstClick.isDoubleClick, false);

  const secondClick = resolveNodeClickOutcome(firstClick.nextState, "object:mysql:users", 1180);
  assert.equal(secondClick.isDoubleClick, true);
  assert.equal(secondClick.nextState, null);
});

test("resolveNodeClickOutcome: 超过阈值或切换节点时不应判定为双击", () => {
  const firstClick = resolveNodeClickOutcome(null, "object:salesforce:Account", 1000);
  const timeoutClick = resolveNodeClickOutcome(firstClick.nextState, "object:salesforce:Account", 1400);
  const otherNodeClick = resolveNodeClickOutcome(firstClick.nextState, "object:salesforce:Contact", 1100);

  assert.equal(timeoutClick.isDoubleClick, false);
  assert.deepEqual(timeoutClick.nextState, { nodeId: "object:salesforce:Account", timestamp: 1400 });
  assert.equal(otherNodeClick.isDoubleClick, false);
  assert.deepEqual(otherNodeClick.nextState, { nodeId: "object:salesforce:Contact", timestamp: 1100 });
});
