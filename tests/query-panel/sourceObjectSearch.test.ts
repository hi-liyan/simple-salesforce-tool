import test from "node:test";
import assert from "node:assert/strict";
import type { SalesforceObject, SalesforceSource } from "../../src/types/index.ts";
import { searchSourceObjects } from "../../src/features/main/QueryPanel/logic/sourceObjectSearch.ts";

// 构造最小数据源：仅覆盖搜索逻辑测试需要的字段。
function createSource(partial: Partial<SalesforceSource> = {}): SalesforceSource {
  return {
    id: partial.id || "sf-1",
    name: partial.name || "默认数据源",
    sortOrder: partial.sortOrder || 0,
    sourceType: partial.sourceType || "salesforce",
    configJson: partial.configJson || {},
    instanceUrl: partial.instanceUrl || "https://example.my.salesforce.com",
    accessToken: partial.accessToken || "",
    apiVersion: partial.apiVersion || "v61.0",
    createdAt: partial.createdAt || "",
    updatedAt: partial.updatedAt || ""
  };
}

// 构造最小对象：仅覆盖搜索排序和展示字段。
function createObject(partial: Partial<SalesforceObject>): SalesforceObject {
  return {
    name: partial.name || "Account",
    label: partial.label || partial.name || "Account",
    comment: partial.comment,
    queryable: partial.queryable ?? true,
    createable: partial.createable ?? false,
    updateable: partial.updateable ?? false,
    deletable: partial.deletable ?? false
  };
}

test("名称前缀命中应优先于标签命中", () => {
  const source = createSource();
  const results = searchSourceObjects({
    keyword: "acc",
    source,
    objects: [
      createObject({ name: "CustomerProfile", label: "Account Profile" }),
      createObject({ name: "Account", label: "客户" }),
      createObject({ name: "Contact", label: "Account Contact" })
    ]
  });

  assert.equal(results[0]?.objectName, "Account");
});

test("应支持按 MySQL 表注释搜索", () => {
  const source = createSource({ id: "mysql-1", name: "订单库", sourceType: "mysql", apiVersion: "mysql" });
  const results = searchSourceObjects({
    keyword: "订单",
    source,
    objects: [
      createObject({ name: "users", label: "users", comment: "用户表" }),
      createObject({ name: "orders", label: "orders", comment: "订单主表" })
    ]
  });

  assert.equal(results[0]?.objectName, "orders");
  assert.equal(results[0]?.secondaryText, "订单主表");
});

test("空关键字不应返回结果", () => {
  const source = createSource();
  const results = searchSourceObjects({
    keyword: "   ",
    source,
    objects: [createObject({ name: "Account" })]
  });

  assert.deepEqual(results, []);
});
