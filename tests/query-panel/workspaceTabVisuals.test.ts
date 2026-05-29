import test from "node:test";
import assert from "node:assert/strict";
import { buildWorkspaceTabSurfaceStyles } from "../../src/features/main/QueryPanel/logic/workspaceTabVisuals.ts";

test("workspaceTabVisuals: 未配置数据源颜色时，激活态也应保留明显强调线", () => {
  const result = buildWorkspaceTabSurfaceStyles("");
  assert.equal(result.surfaceStyle, undefined);
  assert.equal(result.activeSurfaceStyle?.boxShadow, "inset 0 -2px 0 #2563EB");
});

test("workspaceTabVisuals: 配置数据源颜色时，应同时生成普通态与激活态表面样式", () => {
  const result = buildWorkspaceTabSurfaceStyles("#60A5FA");
  assert.equal(typeof result.surfaceStyle?.backgroundColor, "string");
  assert.equal(typeof result.surfaceStyle?.borderColor, "string");
  assert.equal(result.activeSurfaceStyle?.boxShadow, "inset 0 -2px 0 #60A5FA");
  assert.notEqual(result.surfaceStyle?.backgroundColor, result.activeSurfaceStyle?.backgroundColor);
});
