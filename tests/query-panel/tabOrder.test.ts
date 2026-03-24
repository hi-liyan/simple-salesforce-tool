import test from "node:test";
import assert from "node:assert/strict";
import {
  getTabIdsByCloseMode,
  moveTabOrder,
  normalizeTabOrder,
  sortTabsByOrder
} from "../../src/components/tabs/tabOrder.ts";

test("normalizeTabOrder: 应保留有效顺序并追加缺失 tab", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(normalizeTabOrder(["c", "x", "a"], tabs), ["c", "a", "b"]);
});

test("sortTabsByOrder: 应按排序结果输出 tabs", () => {
  const tabs = [
    { id: "a", title: "A" },
    { id: "b", title: "B" },
    { id: "c", title: "C" }
  ];
  assert.deepEqual(
    sortTabsByOrder(["c", "a"], tabs).map((tab) => tab.id),
    ["c", "a", "b"]
  );
});

test("moveTabOrder: 应把活动 tab 插入到目标 tab 位置", () => {
  assert.deepEqual(moveTabOrder(["a", "b", "c"], "c", "a"), ["c", "a", "b"]);
  assert.deepEqual(moveTabOrder(["a", "b", "c"], "b", "b"), ["a", "b", "c"]);
});

test("getTabIdsByCloseMode: 应正确返回左右/其他/全部的 tab id", () => {
  const tabs = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];
  assert.deepEqual(getTabIdsByCloseMode(tabs, "c", "left"), ["a", "b"]);
  assert.deepEqual(getTabIdsByCloseMode(tabs, "b", "right"), ["c", "d"]);
  assert.deepEqual(getTabIdsByCloseMode(tabs, "b", "others"), ["a", "c", "d"]);
  assert.deepEqual(getTabIdsByCloseMode(tabs, "c", "all"), ["a", "b", "c", "d"]);
});
