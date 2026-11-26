import test from "node:test";
import assert from "node:assert/strict";
import {
  buildGroupObjectChildren,
  buildMySqlRootChildren,
  buildObjectSubFolderChildren,
  buildSalesforceRootChildren,
  buildSourceRootNodes
} from "../../src/features/main/QueryPanel/logic/sourceTreeProviders.ts";
import type { QueryTreeProviderContext } from "../../src/features/main/QueryPanel/types/tree.ts";
import type { ObjectDdl, ObjectField, SalesforceObject, SalesforceSource } from "../../src/types/index.ts";

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

test("buildObjectSubFolderChildren: 应生成 columns、keys、indexes 三类目录及对应计数", () => {
  const fields: ObjectField[] = [
    {
      name: "ARTICLE_ID",
      label: "ARTICLE_ID",
      dataType: "varchar",
      nillable: false,
      createable: true,
      updateable: true,
      filterable: true,
      metadata: { columnKey: "PRI", columnType: "varchar(32)" }
    },
    {
      name: "ARTICLE_NAME",
      label: "ARTICLE_NAME",
      dataType: "varchar",
      nillable: true,
      createable: true,
      updateable: true,
      filterable: true,
      metadata: { columnKey: "", columnType: "varchar(512)" }
    }
  ];
  const ddl: ObjectDdl = {
    createTableDdl: "CREATE TABLE `articles` (...)",
    indexDdls: ["CREATE INDEX `idx_articles_name` ON `articles` (`ARTICLE_NAME`) USING BTREE;"],
    constraintDdls: ["ALTER TABLE `articles` ADD CONSTRAINT `uk_articles_name` UNIQUE (`ARTICLE_NAME`);"]
  };

  const folders = buildObjectSubFolderChildren(
    "mysql-1",
    "mysql",
    "articles",
    ["columns", "keys", "indexes"],
    fields,
    ddl
  );

  assert.deepEqual(
    folders.map((entry) => ({
      label: entry.folderNode.kind === "object-folder" ? entry.folderNode.label : "",
      count: entry.folderNode.kind === "object-folder" ? entry.folderNode.count : -1,
      childLabels: entry.children.map((c) => c.label)
    })),
    [
      {
        label: "columns",
        count: 2,
        childLabels: ["ARTICLE_ID (varchar(32))", "ARTICLE_NAME (varchar(512))"]
      },
      {
        label: "keys",
        count: 2,
        childLabels: ["PRIMARY", "uk_articles_name"]
      },
      {
        label: "indexes",
        count: 2,
        childLabels: ["PRIMARY", "idx_articles_name"]
      }
    ]
  );
});

test("buildGroupObjectChildren: 应保留非空表注释并忽略空白注释", () => {
  const nodes = buildGroupObjectChildren("mysql-1", "mysql", [
    { name: "articles", label: "articles", comment: "  文章表  ", queryable: true, createable: true, updateable: true, deletable: true },
    { name: "cars", label: "cars", comment: "   ", queryable: true, createable: true, updateable: true, deletable: true },
    { name: "drivers", label: "drivers", queryable: true, createable: true, updateable: true, deletable: true }
  ]);

  assert.deepEqual(
    nodes.map((item) => ({
      name: item.kind === "object" ? item.objectName : "",
      comment: item.kind === "object" ? item.comment : undefined
    })),
    [
      { name: "articles", comment: "文章表" },
      { name: "cars", comment: undefined },
      { name: "drivers", comment: undefined }
    ]
  );
});
