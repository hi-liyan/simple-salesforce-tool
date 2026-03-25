import test from "node:test";
import assert from "node:assert/strict";
import {
  SYSTEM_LOG_COLLAPSE_CHAR_LIMIT,
  buildSystemLogContent,
  shouldCollapseSystemLogContent
} from "../../src/features/main/SettingsPanel/systemLogContent.ts";

test("buildSystemLogContent: 应在存在 detail 时输出统一的可读内容块", () => {
  assert.equal(buildSystemLogContent("请求失败", "stack line 1"), "请求失败\n\n详情:\nstack line 1");
  assert.equal(buildSystemLogContent("请求成功"), "请求成功");
});

test("shouldCollapseSystemLogContent: 短日志内容不应默认折叠", () => {
  assert.equal(shouldCollapseSystemLogContent("同步完成", "耗时 120ms"), false);
});

test("shouldCollapseSystemLogContent: 超过字符阈值的日志内容应默认折叠", () => {
  const longMessage = "A".repeat(SYSTEM_LOG_COLLAPSE_CHAR_LIMIT + 1);
  assert.equal(shouldCollapseSystemLogContent(longMessage), true);
});

test("shouldCollapseSystemLogContent: 超过行数阈值的日志内容应默认折叠", () => {
  const multiLineDetail = ["line1", "line2", "line3", "line4", "line5"].join("\n");
  assert.equal(shouldCollapseSystemLogContent("执行异常", multiLineDetail), true);
});
