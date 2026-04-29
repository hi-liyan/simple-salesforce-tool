import test from "node:test";
import assert from "node:assert/strict";
import type { SalesforceSource, SourceSecretView } from "../../src/types/index.ts";
import { hydrateSettingsSourcesWithSecrets } from "../../src/features/main/SettingsPanel/sourceSecrets.ts";

// 构造最小数据源对象：仅保留设置页补 secret 逻辑需要的字段。
function createSource(partial: Partial<SalesforceSource>): SalesforceSource {
  return {
    id: partial.id || "source-1",
    name: partial.name || "Source 1",
    sortOrder: partial.sortOrder || 1,
    sourceType: partial.sourceType || "salesforce",
    configJson: partial.configJson || {},
    instanceUrl: partial.instanceUrl || "https://example.my.salesforce.com",
    accessToken: partial.accessToken || "",
    apiVersion: partial.apiVersion || "v61.0",
    createdAt: partial.createdAt || "2026-04-28T00:00:00.000Z",
    updatedAt: partial.updatedAt || "2026-04-28T00:00:00.000Z"
  };
}

test("hydrateSettingsSourcesWithSecrets: 应仅为设置页列表补充 Salesforce accessToken 明文", async () => {
  const sources = [
    createSource({ id: "sf-1", sourceType: "salesforce", accessToken: "" }),
    createSource({
      id: "mysql-1",
      sourceType: "mysql",
      instanceUrl: "mysql://127.0.0.1:3306/demo",
      apiVersion: "mysql",
      accessToken: ""
    }),
    createSource({ id: "cli-1", sourceType: "salesforce", accessToken: "" })
  ];

  const requestedSourceIds: string[] = [];
  const result = await hydrateSettingsSourcesWithSecrets(sources, async (sourceId): Promise<SourceSecretView> => {
    requestedSourceIds.push(sourceId);
    return {
      sourceId,
      accessToken: `${sourceId}-token`,
      password: ""
    };
  });

  assert.deepEqual(requestedSourceIds, ["sf-1", "cli-1"]);
  assert.equal(result[0]?.accessToken, "sf-1-token");
  assert.equal(result[1]?.accessToken, "");
  assert.equal(result[2]?.accessToken, "cli-1-token");
});

test("hydrateSettingsSourcesWithSecrets: 读取 secret 失败时应保留原列表项", async () => {
  const sources = [createSource({ id: "sf-1", sourceType: "salesforce", accessToken: "" })];

  const result = await hydrateSettingsSourcesWithSecrets(sources, async () => {
    throw new Error("secret read failed");
  });

  assert.equal(result[0]?.accessToken, "");
  assert.equal(result[0]?.id, "sf-1");
});
