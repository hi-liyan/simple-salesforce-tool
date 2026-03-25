import test from "node:test";
import assert from "node:assert/strict";
import { resolveConsoleTargetSource } from "../../src/features/main/QueryPanel/logic/querySidebarConsoleSource.ts";
import type { SalesforceSource } from "../../src/types/index.ts";

// 构造最小数据源：覆盖控制台来源解析所需字段。
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

test("resolveConsoleTargetSource: 应优先返回当前聚焦的数据源", () => {
  const sources = [
    createSource({ id: "sf-1", name: "Org A", sourceType: "salesforce" }),
    createSource({ id: "mysql-1", name: "DB A", sourceType: "mysql" })
  ];

  const target = resolveConsoleTargetSource({
    sources,
    focusedSourceId: "mysql-1",
    selectedSourceId: "sf-1"
  });

  assert.equal(target?.id, "mysql-1");
  assert.equal(target?.name, "DB A");
});

test("resolveConsoleTargetSource: 无聚焦数据源时应回退到 selectedSourceId", () => {
  const sources = [
    createSource({ id: "sf-1", name: "Org A", sourceType: "salesforce" }),
    createSource({ id: "mysql-1", name: "DB A", sourceType: "mysql" })
  ];

  const target = resolveConsoleTargetSource({
    sources,
    focusedSourceId: "",
    selectedSourceId: "sf-1"
  });

  assert.equal(target?.id, "sf-1");
  assert.equal(target?.name, "Org A");
});
