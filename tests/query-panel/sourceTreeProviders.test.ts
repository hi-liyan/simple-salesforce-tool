import test from "node:test";
import assert from "node:assert/strict";
import { buildMySqlRootChildren, buildSalesforceRootChildren, buildSourceRootNodes } from "../../src/features/main/QueryPanel/logic/sourceTreeProviders.ts";
import type { QueryTreeProviderContext } from "../../src/features/main/QueryPanel/types/tree.ts";
import type { SalesforceObject, SalesforceSource } from "../../src/types/index.ts";

// 构造最小数据源对象：覆盖树节点映射所需字段。
function createSource(partial: Partial<SalesforceSource>): SalesforceSource {
  return {
    id: partial.id || "source-1",
    name: partial.name || "Source 1",
    sortOrder: partial.sortOrder ?? 0,
    sourceType: partial.sourceType || "salesforce",
    configJson: partial.configJson || {},
    instanceUrl: partial.instanceUrl || "https://example.com",
    accessToken: partial.accessToken || "token",
    apiVersion: partial.apiVersion || "v61.0",
    createdAt: partial.createdAt || "2026-03-24T00:00:00.000Z",
    updatedAt: partial.updatedAt || "2026-03-24T00:00:00.000Z"
  };
}

// 创建 provider 所需最小上下文。
function createContext(objects: SalesforceObject[] = []): QueryTreeProviderContext {
  return {
    getSourceColor: (source) => String(source.configJson?.color || ""),
    listObjects: async () => objects
  };
}

test("buildSourceRootNodes: 应按 sortOrder 输出全部 source 节点并携带颜色", () => {
  const nodes = buildSourceRootNodes(
    [
      createSource({ id: "mysql-1", name: "MySQL", sortOrder: 2, sourceType: "mysql" }),
      createSource({ id: "sf-1", name: "Salesforce", sortOrder: 1, configJson: { color: "#2563EB" } })
    ],
    createContext()
  );

  assert.deepEqual(
    nodes.map((item) => ({ id: item.id, label: item.label, color: item.sourceColor })),
    [
      { id: "source:sf-1", label: "Salesforce", color: "#2563EB" },
      { id: "source:mysql-1", label: "MySQL", color: "" }
    ]
  );
});

test("buildMySqlRootChildren: 应生成 tables、collations、users、virtual views 分组", async () => {
  const nodes = await buildMySqlRootChildren(createSource({ id: "mysql-1", sourceType: "mysql" }), createContext());
  assert.deepEqual(nodes.map((item) => item.label), ["tables", "collations", "users", "virtual views"]);
  assert.deepEqual(nodes.map((item) => item.groupType), ["tables", "collations", "users", "virtual-views"]);
});

test("buildSalesforceRootChildren: 应将对象映射为 object 节点", async () => {
  const nodes = await buildSalesforceRootChildren(
    createSource({ id: "sf-1", sourceType: "salesforce" }),
    createContext([
      { name: "Account", label: "客户", queryable: true, createable: true, updateable: true, deletable: true },
      { name: "Contact", label: "联系人", queryable: true, createable: true, updateable: true, deletable: true }
    ])
  );

  assert.deepEqual(
    nodes.map((item) => ({ id: item.id, label: item.label, objectName: item.objectName })),
    [
      { id: "object:sf-1:Account", label: "客户", objectName: "Account" },
      { id: "object:sf-1:Contact", label: "联系人", objectName: "Contact" }
    ]
  );
});
