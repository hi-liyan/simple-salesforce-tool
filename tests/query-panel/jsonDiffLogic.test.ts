import test from "node:test";
import assert from "node:assert/strict";
import { buildJsonDiffSemanticState, isJsonDiffInputEmpty, normalizeJsonText } from "../../src/features/main/ToolsPanel/logic/jsonDiff.ts";

test("JsonDiff 空态判断：左右都为空时应返回 true", () => {
  assert.equal(isJsonDiffInputEmpty("", ""), true);
  assert.equal(isJsonDiffInputEmpty("   ", "\n"), true);
});

test("JsonDiff 空态判断：任一侧有内容时应返回 false", () => {
  assert.equal(isJsonDiffInputEmpty("{\"a\":1}", ""), false);
  assert.equal(isJsonDiffInputEmpty("", "{\"b\":2}"), false);
});

test("JsonDiff 归一化：应按键排序并稳定输出格式", () => {
  const result = normalizeJsonText("{\"b\":2,\"a\":1}");

  assert.equal(result.errorMessage, "");
  assert.equal(
    result.normalizedText,
    `{
  "a": 1,
  "b": 2
}`
  );
});

test("JsonDiff 语义状态：键顺序不同但语义一致时应判定为一致", () => {
  const state = buildJsonDiffSemanticState("{\"b\":2,\"a\":1}", "{\"a\":1,\"b\":2}");

  assert.equal(state.empty, false);
  assert.equal(state.comparable, true);
  assert.equal(state.semanticallyEqual, true);
});

test("JsonDiff 语义状态：值不同应判定为语义差异", () => {
  const state = buildJsonDiffSemanticState("{\"a\":1}", "{\"a\":2}");

  assert.equal(state.comparable, true);
  assert.equal(state.semanticallyEqual, false);
});

test("JsonDiff 语义状态：解析失败时应给出错误并不可比较", () => {
  const state = buildJsonDiffSemanticState("{\"a\":1", "{\"a\":1}");

  assert.equal(state.comparable, false);
  assert.equal(state.semanticallyEqual, false);
  assert.equal(state.left.errorMessage.startsWith("JSON 解析失败"), true);
});
