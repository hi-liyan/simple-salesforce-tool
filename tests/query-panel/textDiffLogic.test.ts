import test from "node:test";
import assert from "node:assert/strict";
import { isTextDiffInputEmpty } from "../../src/features/main/ToolsPanel/logic/textDiff.ts";

test("TextDiff 空态判断：左右都为空时应返回 true", () => {
  assert.equal(isTextDiffInputEmpty("", ""), true);
  assert.equal(isTextDiffInputEmpty("   ", "\n"), true);
});

test("TextDiff 空态判断：任一侧有内容时应返回 false", () => {
  assert.equal(isTextDiffInputEmpty("left", ""), false);
  assert.equal(isTextDiffInputEmpty("", "right"), false);
});
