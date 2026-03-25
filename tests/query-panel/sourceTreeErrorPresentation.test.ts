import test from "node:test";
import assert from "node:assert/strict";
import { buildQuerySourceErrorPresentation } from "../../src/features/main/QueryPanel/logic/sourceTreeErrorPresentation.ts";

test("buildQuerySourceErrorPresentation: 应将认证类错误收敛为更友好的标题与说明", () => {
  assert.deepEqual(buildQuerySourceErrorPresentation("Error: token expired; please login again"), {
    title: "认证失败",
    detail: "token expired"
  });
});

test("buildQuerySourceErrorPresentation: 应将超长错误说明截断为适合左树展示的摘要", () => {
  const rawMessage = "连接 mysql 数据源失败，目标主机响应超时，当前网络状态不稳定，请检查 VPN、代理与数据库白名单配置是否正确。";
  const presentation = buildQuerySourceErrorPresentation(rawMessage);
  assert.equal(presentation.title, "连接超时");
  assert.equal(presentation.detail.endsWith("..."), true);
  assert.notEqual(presentation.detail, rawMessage);
});
