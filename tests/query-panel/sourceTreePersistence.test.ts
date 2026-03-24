import test from "node:test";
import assert from "node:assert/strict";
import {
  buildInitialOpenState,
  collectRestorableSourceIds,
  normalizePersistedSourceTreeUiState,
  resolveSourceIdFromTreeNodeId,
  sanitizePersistedSourceTreeUiState
} from "../../src/features/main/QueryPanel/logic/sourceTreePersistence.ts";
import type { SalesforceSource } from "../../src/types/index.ts";

// 构造最小数据源：仅保留树状态恢复测试所需字段。
function createSource(partial: Partial<SalesforceSource>): SalesforceSource {
  return {
    id: partial.id || "sf-1",
    name: partial.name || "默认数据源",
    sourceType: partial.sourceType || "salesforce",
    sortOrder: partial.sortOrder ?? 0,
    color: partial.color || "",
    orgId: partial.orgId || "",
    loginUrl: partial.loginUrl || "",
    instanceUrl: partial.instanceUrl || "",
    username: partial.username || "",
    isDefault: partial.isDefault ?? false
  } as SalesforceSource;
}

test("normalizePersistedSourceTreeUiState: 应过滤非法 expandedNodeIds 并去重", () => {
  const next = normalizePersistedSourceTreeUiState({
    selectedNodeId: "source:sf-1",
    focusedSourceId: "sf-1",
    expandedNodeIds: ["source:sf-1", "", "source:sf-1", 1 as never]
  });

  assert.deepEqual(next, {
    selectedNodeId: "source:sf-1",
    focusedSourceId: "sf-1",
    expandedNodeIds: ["source:sf-1"]
  });
});

test("resolveSourceIdFromTreeNodeId: 应解析 source/group/object 节点所属数据源", () => {
  assert.equal(resolveSourceIdFromTreeNodeId("source:sf-1"), "sf-1");
  assert.equal(resolveSourceIdFromTreeNodeId("group:mysql-1:tables"), "mysql-1");
  assert.equal(resolveSourceIdFromTreeNodeId("object:sf-2:Account"), "sf-2");
  assert.equal(resolveSourceIdFromTreeNodeId("invalid"), "");
});

test("sanitizePersistedSourceTreeUiState: 应过滤失效节点并回退到排序后的首个 source", () => {
  const sources = [
    createSource({ id: "z-last", name: "最后", sortOrder: 20 }),
    createSource({ id: "a-first", name: "最前", sortOrder: 10 })
  ];

  const next = sanitizePersistedSourceTreeUiState(
    {
      selectedNodeId: "object:missing:Account",
      focusedSourceId: "missing",
      expandedNodeIds: ["source:missing", "group:a-first:tables"]
    },
    sources
  );

  assert.deepEqual(next, {
    selectedNodeId: "source:a-first",
    focusedSourceId: "a-first",
    expandedNodeIds: ["group:a-first:tables"]
  });
});

test("buildInitialOpenState: 应将展开节点列表转换为 Arborist 初始映射", () => {
  assert.deepEqual(buildInitialOpenState(["source:sf-1", "group:mysql-1:tables"]), {
    "source:sf-1": true,
    "group:mysql-1:tables": true
  });
});

test("collectRestorableSourceIds: 应汇总展开、高亮、聚焦关联的数据源", () => {
  const sources = [
    createSource({ id: "sf-1", name: "Salesforce" }),
    createSource({ id: "mysql-1", name: "MySQL" })
  ];

  const next = collectRestorableSourceIds(
    {
      selectedNodeId: "object:sf-1:Account",
      focusedSourceId: "mysql-1",
      expandedNodeIds: ["group:mysql-1:tables", "source:sf-1"]
    },
    sources
  );

  assert.deepEqual(next.sort(), ["mysql-1", "sf-1"]);
});
