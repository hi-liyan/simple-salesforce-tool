import test from "node:test";
import assert from "node:assert/strict";
import {
  PAGE_SIZE_PRESET_VALUES,
  PAGE_SIZE_MAX,
  normalizeQueryPageSize,
  resolveQueryPageSizeOption
} from "../../src/features/main/QueryPanel/logic/queryToolbar.ts";

test("queryToolbar: 应暴露固定的 Page Size 预设列表", () => {
  assert.deepEqual(PAGE_SIZE_PRESET_VALUES, [10, 100, 250, 500, 1000]);
});

test("queryToolbar: normalizeQueryPageSize 应限制为 1-2000 的整数", () => {
  assert.equal(normalizeQueryPageSize(0), 1);
  assert.equal(normalizeQueryPageSize(10.8), 10);
  assert.equal(normalizeQueryPageSize(PAGE_SIZE_MAX + 1), PAGE_SIZE_MAX);
  assert.equal(normalizeQueryPageSize(Number.NaN), 200);
});

test("queryToolbar: resolveQueryPageSizeOption 应区分预设值与自定义值", () => {
  assert.deepEqual(resolveQueryPageSizeOption(250), { kind: "preset", value: 250, label: "250" });
  assert.deepEqual(resolveQueryPageSizeOption(333), { kind: "custom", value: 333, label: "333" });
});
