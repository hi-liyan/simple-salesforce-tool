import test from "node:test";
import assert from "node:assert/strict";
import { buildHeaderDisplayLines } from "../../src/components/DataGrid/renderers/drawHeader.ts";

// 表头文本组装测试：验证 fieldName/label 的双行展示规则。
test("buildHeaderDisplayLines: label 与 fieldName 相同应只显示单行", () => {
  const lines = buildHeaderDisplayLines("OwnerId", { label: "OwnerId" });
  assert.equal(lines.primary, "OwnerId");
  assert.equal(lines.secondary, null);
});

test("buildHeaderDisplayLines: label 不同应显示第二行", () => {
  const lines = buildHeaderDisplayLines("OwnerId", { label: "所有者" });
  assert.equal(lines.primary, "OwnerId");
  assert.equal(lines.secondary, "所有者");
});
