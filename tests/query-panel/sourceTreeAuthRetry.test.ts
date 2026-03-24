import test from "node:test";
import assert from "node:assert/strict";
import { buildSalesforceRootChildren } from "../../src/features/main/QueryPanel/logic/sourceTreeProviders.ts";
import type { QueryTreeProviderContext } from "../../src/features/main/QueryPanel/types/tree.ts";
import type { SalesforceObject, SalesforceSource } from "../../src/types/index.ts";

// 构造最小 Salesforce 数据源：覆盖 provider 重试测试所需字段。
function createSalesforceSource(partial: Partial<SalesforceSource> = {}): SalesforceSource {
  return {
    id: partial.id || "sf-1",
    name: partial.name || "Salesforce",
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

// 创建带认证重试包装器的上下文：用于验证 Salesforce provider 会通过 wrapper 拉取对象。
function createContext(listObjects: (sourceId: string) => Promise<SalesforceObject[]>): QueryTreeProviderContext {
  return {
    getSourceColor: () => "",
    listObjects,
    withSalesforceSourceReauth: async (_source, action) => action()
  };
}

test("salesforce provider: 展开加载遇到认证重试包装器时应通过 wrapper 拉取对象", async () => {
  let wrapperCalled = 0;
  let listCalled = 0;
  const source = createSalesforceSource();
  const context = createContext(async () => {
    listCalled += 1;
    return [{ name: "Account", label: "客户", queryable: true, createable: true, updateable: true, deletable: true }];
  });

  context.withSalesforceSourceReauth = async (currentSource, action) => {
    wrapperCalled += 1;
    assert.equal(currentSource.id, source.id);
    return action();
  };

  const nodes = await buildSalesforceRootChildren(source, context);

  assert.equal(wrapperCalled, 1);
  assert.equal(listCalled, 1);
  assert.equal(nodes[0]?.id, "object:sf-1:Account");
});
