import test from "node:test";
import assert from "node:assert/strict";
import { resolveQueryTreeBadgeMeta, resolveQueryTreeVisualKind } from "../../src/features/main/QueryPanel/logic/queryTreeVisuals.ts";
import type { QueryTreeNode } from "../../src/features/main/QueryPanel/types/tree.ts";

// 构造最小树节点：仅覆盖视觉映射测试所需字段。
function createNode(partial: Partial<QueryTreeNode>): QueryTreeNode {
  if (partial.kind === "group") {
    return {
      id: partial.id || "group:mysql-1:tables",
      kind: "group",
      sourceId: partial.sourceId || "mysql-1",
      sourceType: partial.sourceType || "mysql",
      groupType: partial.groupType || "tables",
      label: partial.label || "tables",
      expandable: partial.expandable ?? true
    };
  }

  if (partial.kind === "object") {
    return {
      id: partial.id || "object:sf-1:Account",
      kind: "object",
      sourceId: partial.sourceId || "sf-1",
      sourceType: partial.sourceType || "salesforce",
      objectName: partial.objectName || "Account",
      label: partial.label || "Account",
      queryable: partial.queryable ?? true,
      expandable: partial.expandable ?? false
    };
  }

  return {
    id: partial.id || "source:sf-1",
    kind: "source",
    sourceId: partial.sourceId || "sf-1",
    sourceType: partial.sourceType || "salesforce",
    sourceName: partial.sourceName || "Salesforce",
    sourceColor: partial.sourceColor || "",
    label: partial.label || "Salesforce",
    expandable: true
  };
}

test("resolveQueryTreeVisualKind: 应为 Salesforce 与 MySQL 数据源返回不同的极简图标类型", () => {
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "source", sourceType: "salesforce" })), "source-salesforce");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "source", sourceType: "mysql" })), "source-mysql");
});

test("resolveQueryTreeVisualKind: 应为 MySQL 分组返回稳定的树节点图标类型", () => {
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "group", groupType: "tables" })), "group-tables");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "group", groupType: "collations" })), "group-collations");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "group", groupType: "users" })), "group-users");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "group", groupType: "virtual-views" })), "group-views");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "group", groupType: "unknown" })), "group-generic");
});

test("resolveQueryTreeVisualKind: 应区分可查询与只读对象", () => {
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "object", queryable: true })), "object-queryable");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "object", queryable: false })), "object-readonly");
  assert.equal(resolveQueryTreeVisualKind(createNode({ kind: "object", sourceType: "mysql" })), "object-mysql-table");
});

test("resolveQueryTreeBadgeMeta: 应返回稳定的小徽标文案与色调", () => {
  assert.deepEqual(resolveQueryTreeBadgeMeta("source-salesforce"), { text: "SF", tone: "green" });
  assert.deepEqual(resolveQueryTreeBadgeMeta("source-mysql"), { text: "MY", tone: "blue" });
  assert.deepEqual(resolveQueryTreeBadgeMeta("group-tables"), { text: "TB", tone: "amber" });
  assert.deepEqual(resolveQueryTreeBadgeMeta("group-views"), { text: "VW", tone: "orange" });
  assert.deepEqual(resolveQueryTreeBadgeMeta("object-mysql-table"), { text: "T", tone: "amber" });
  assert.deepEqual(resolveQueryTreeBadgeMeta("object-readonly"), { text: "NQ", tone: "muted" });
});
