import test from "node:test";
import assert from "node:assert/strict";
import { useJsonDiffStore } from "../../src/store/useJsonDiffStore.ts";

// 重置 JSON Diff store：确保测试之间互不污染。
function resetJsonDiffStore() {
  useJsonDiffStore.setState({
    tabs: [],
    tabOrder: [],
    activeTabId: ""
  });
}

test("JsonDiff store 应支持多 Tab 新建与左右 JSON 独立维护", () => {
  resetJsonDiffStore();

  const firstTabId = useJsonDiffStore.getState().createTab();
  const secondTabId = useJsonDiffStore.getState().createTab();

  useJsonDiffStore.getState().patchTab(firstTabId, (current) => ({
    ...current,
    leftText: "{\"a\":1}",
    rightText: "{\"a\":2}"
  }));
  useJsonDiffStore.getState().patchTab(secondTabId, (current) => ({
    ...current,
    leftText: "{\"b\":1}",
    rightText: "{\"b\":1}"
  }));

  const state = useJsonDiffStore.getState();
  const firstTab = state.tabs.find((tab) => tab.id === firstTabId);
  const secondTab = state.tabs.find((tab) => tab.id === secondTabId);

  assert.equal(state.activeTabId, secondTabId);
  assert.equal(firstTab?.leftText, "{\"a\":1}");
  assert.equal(firstTab?.rightText, "{\"a\":2}");
  assert.equal(secondTab?.leftText, "{\"b\":1}");
  assert.equal(secondTab?.rightText, "{\"b\":1}");
});

test("JsonDiff store 应支持重命名、交换左右与拖拽排序", () => {
  resetJsonDiffStore();

  const firstTabId = useJsonDiffStore.getState().createTab();
  const secondTabId = useJsonDiffStore.getState().createTab();

  useJsonDiffStore.getState().patchTab(firstTabId, (current) => ({
    ...current,
    name: "配置差异",
    leftText: "{\"env\":\"staging\"}",
    rightText: "{\"env\":\"prod\"}"
  }));
  useJsonDiffStore.getState().swapTabTexts(firstTabId);
  useJsonDiffStore.getState().reorderTabs(secondTabId, firstTabId);

  const state = useJsonDiffStore.getState();
  const renamedTab = state.tabs.find((tab) => tab.id === firstTabId);

  assert.equal(renamedTab?.name, "配置差异");
  assert.equal(renamedTab?.leftText, "{\"env\":\"prod\"}");
  assert.equal(renamedTab?.rightText, "{\"env\":\"staging\"}");
  assert.deepEqual(state.tabOrder.slice(0, 2), [secondTabId, firstTabId]);
});

test("JsonDiff store 关闭激活 Tab 后应回退到剩余首个 Tab", () => {
  resetJsonDiffStore();

  const firstTabId = useJsonDiffStore.getState().createTab();
  const secondTabId = useJsonDiffStore.getState().createTab();

  useJsonDiffStore.getState().closeTab(secondTabId);

  const state = useJsonDiffStore.getState();

  assert.equal(state.activeTabId, firstTabId);
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [firstTabId]
  );
  assert.deepEqual(state.tabOrder, [firstTabId]);
});
