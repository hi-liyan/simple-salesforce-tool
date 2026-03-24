import test from "node:test";
import assert from "node:assert/strict";
import { getSourceColor, withSourceColor } from "../../src/features/main/QueryPanel/logic/sourceColor.ts";
import type { SalesforceSource, SourceUpsertPayload } from "../../src/types/index.ts";

// 构造最小数据源对象：仅保留颜色逻辑需要的字段。
function createSource(configJson: Record<string, unknown>): SalesforceSource {
  return {
    id: "source-1",
    name: "Source 1",
    sortOrder: 1,
    sourceType: "salesforce",
    configJson,
    instanceUrl: "https://example.com",
    accessToken: "token",
    apiVersion: "v61.0",
    createdAt: "2026-03-24T00:00:00.000Z",
    updatedAt: "2026-03-24T00:00:00.000Z"
  };
}

test("getSourceColor: 应仅返回用户手动配置的合法颜色值", () => {
  assert.equal(getSourceColor(createSource({ color: "#4F46E5" })), "#4F46E5");
  assert.equal(getSourceColor(createSource({ color: "not-a-color" })), "");
  assert.equal(getSourceColor(createSource({})), "");
});

test("withSourceColor: 应将合法颜色写入 payload.configJson 并保留其他配置", () => {
  const payload: SourceUpsertPayload = {
    name: "Source 1",
    sourceType: "mysql",
    configJson: { host: "127.0.0.1", port: 3306 },
    instanceUrl: "mysql://127.0.0.1:3306/test",
    accessToken: "",
    apiVersion: "mysql"
  };

  assert.deepEqual(withSourceColor(payload, "#DC2626").configJson, {
    host: "127.0.0.1",
    port: 3306,
    color: "#DC2626"
  });
});

test("withSourceColor: 空颜色应移除 color 字段而不生成默认色", () => {
  const payload: SourceUpsertPayload = {
    name: "Source 1",
    sourceType: "salesforce",
    configJson: { color: "#2563EB", region: "prod" },
    instanceUrl: "https://example.com",
    accessToken: "token",
    apiVersion: "v61.0"
  };

  assert.deepEqual(withSourceColor(payload, "").configJson, {
    region: "prod"
  });
});
