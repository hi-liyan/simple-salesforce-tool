import test from "node:test";
import assert from "node:assert/strict";
import { resolveQuerySourceRetryPolicy, runQuerySourceRequestWithRetry } from "../../src/features/main/QueryPanel/logic/sourceTreeRetry.ts";
import type { SalesforceSource } from "../../src/types/index.ts";

// 创建最小数据源：覆盖左树重试策略测试需要的字段。
function createSource(partial: Partial<SalesforceSource> = {}): SalesforceSource {
  return {
    id: partial.id || "sf-1",
    name: partial.name || "Source",
    sortOrder: partial.sortOrder ?? 0,
    sourceType: partial.sourceType || "salesforce",
    configJson: partial.configJson || {},
    instanceUrl: partial.instanceUrl || "https://example.com",
    accessToken: partial.accessToken || "token",
    apiVersion: partial.apiVersion || "v61.0",
    createdAt: partial.createdAt || "2026-03-25T00:00:00.000Z",
    updatedAt: partial.updatedAt || "2026-03-25T00:00:00.000Z"
  };
}

test("resolveQuerySourceRetryPolicy: Salesforce 应启用后台重试，MySQL 保持单次请求", () => {
  assert.deepEqual(resolveQuerySourceRetryPolicy(createSource({ sourceType: "salesforce" })), {
    maxRetries: 2,
    delayMs: 450
  });
  assert.deepEqual(resolveQuerySourceRetryPolicy(createSource({ sourceType: "mysql" })), {
    maxRetries: 0,
    delayMs: 0
  });
});

test("runQuerySourceRequestWithRetry: Salesforce 临时失败后应在后台重试并最终成功", async () => {
  let callCount = 0;
  const result = await runQuerySourceRequestWithRetry(createSource({ sourceType: "salesforce" }), async () => {
    callCount += 1;
    if (callCount < 3) {
      throw new Error("token expired");
    }
    return "ok";
  });

  assert.equal(result, "ok");
  assert.equal(callCount, 3);
});

test("runQuerySourceRequestWithRetry: 非 Salesforce 数据源失败时不应重复请求", async () => {
  let callCount = 0;
  await assert.rejects(async () => {
    await runQuerySourceRequestWithRetry(createSource({ sourceType: "mysql" }), async () => {
      callCount += 1;
      throw new Error("mysql timeout");
    });
  });
  assert.equal(callCount, 1);
});
