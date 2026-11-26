import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { useDataGridScrollStore } from "../../src/store/useDataGridScrollStore.ts";

// 重置 DataGrid 运行态滚动 store：避免测试之间相互污染。
function resetDataGridScrollStore() {
  useDataGridScrollStore.setState({
    scrollStateByKey: {}
  });
}

test("useDataGridScrollStore: 不同 tab 的横竖滚动状态应互不覆盖", () => {
  resetDataGridScrollStore();
  const store = useDataGridScrollStore.getState();

  store.setScrollState("query:sf-1::Account", { x: 180, y: 420 });
  store.setScrollState("query:mysql-1::users", { x: 32, y: 96 });

  assert.deepEqual(store.getScrollState("query:sf-1::Account"), { x: 180, y: 420 });
  assert.deepEqual(store.getScrollState("query:mysql-1::users"), { x: 32, y: 96 });
  assert.deepEqual(store.getScrollState("query:missing"), { x: 0, y: 0 });
});

test("DataGridSurface: 应将受控滚动偏移传给 DataEditor，并通过可见区域变化回传滚动状态", () => {
  const source = readFileSync(new URL("../../src/components/DataGrid/components/DataGridSurface.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("scrollOffsetX={scrollOffsetX}"), true);
  assert.equal(source.includes("scrollOffsetY={scrollOffsetY}"), true);
  assert.equal(source.includes("onVisibleRegionChanged={handleVisibleRegionChanged}"), true);
  assert.equal(source.includes("resolveGridScrollOffsets"), true);
});

test("QueryPanel 数据表: 应按对象 tab 绑定独立的 DataGrid 运行态滚动 key", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("scrollStateKey={`query:${activeTab.bindingKey}`}"), true);
});

test("SoqlExecutorWorkspace 结果表: 应按 console tab 绑定独立的 DataGrid 运行态滚动 key", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/SoqlExecutorWorkspace.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("scrollStateKey={`console:${activeTab.id}`}"), true);
});
