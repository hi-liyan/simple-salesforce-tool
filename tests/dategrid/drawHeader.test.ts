import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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

test("DataGrid 表头: 应使用更紧凑的表头高度与双行文字基线", () => {
  const surfaceSource = readFileSync(new URL("../../src/components/DataGrid/components/DataGridSurface.tsx", import.meta.url), "utf8");
  const headerSource = readFileSync(new URL("../../src/components/DataGrid/renderers/drawHeader.ts", import.meta.url), "utf8");

  assert.equal(surfaceSource.includes("const DATA_GRID_HEADER_HEIGHT = 30;"), true);
  assert.equal(headerSource.includes("ctx.fillText(headerLines.primary, textLeft, rect.y + 10);"), true);
  assert.equal(headerSource.includes("ctx.fillText(headerLines.secondary || \"\", textLeft, rect.y + 21);"), true);
});
