import test from "node:test";
import assert from "node:assert/strict";
import { useTextDiffStore } from "../../src/store/useTextDiffStore.ts";

// 重置文本对比 store：确保测试之间互不污染。
function resetTextDiffStore() {
  useTextDiffStore.setState({
    tabs: [],
    tabOrder: [],
    activeTabId: ""
  });
}

test("TextDiff store 应支持多 Tab 新建与左右文本独立维护", () => {
  resetTextDiffStore();

  const firstTabId = useTextDiffStore.getState().createTab();
  const secondTabId = useTextDiffStore.getState().createTab();

  useTextDiffStore.getState().patchTab(firstTabId, (current) => ({
    ...current,
    leftText: "before",
    rightText: "after"
  }));
  useTextDiffStore.getState().patchTab(secondTabId, (current) => ({
    ...current,
    leftText: "foo",
    rightText: "bar"
  }));

  const state = useTextDiffStore.getState();
  const firstTab = state.tabs.find((tab) => tab.id === firstTabId);
  const secondTab = state.tabs.find((tab) => tab.id === secondTabId);

  assert.equal(state.activeTabId, secondTabId);
  assert.equal(firstTab?.leftText, "before");
  assert.equal(firstTab?.rightText, "after");
  assert.equal(secondTab?.leftText, "foo");
  assert.equal(secondTab?.rightText, "bar");
});

test("TextDiff store 应支持拖拽排序、重命名与交换左右文本", () => {
  resetTextDiffStore();

  const firstTabId = useTextDiffStore.getState().createTab();
  const secondTabId = useTextDiffStore.getState().createTab();

  useTextDiffStore.getState().patchTab(firstTabId, (current) => ({
    ...current,
    name: "接口响应对比",
    leftText: "A",
    rightText: "B"
  }));
  useTextDiffStore.getState().swapTabTexts(firstTabId);
  useTextDiffStore.getState().reorderTabs(secondTabId, firstTabId);

  const state = useTextDiffStore.getState();
  const renamedTab = state.tabs.find((tab) => tab.id === firstTabId);

  assert.equal(renamedTab?.name, "接口响应对比");
  assert.equal(renamedTab?.leftText, "B");
  assert.equal(renamedTab?.rightText, "A");
  assert.deepEqual(state.tabOrder.slice(0, 2), [secondTabId, firstTabId]);
});

test("TextDiff store 关闭激活 Tab 后应回退到剩余首个 Tab", () => {
  resetTextDiffStore();

  const firstTabId = useTextDiffStore.getState().createTab();
  const secondTabId = useTextDiffStore.getState().createTab();

  useTextDiffStore.getState().closeTab(secondTabId);

  const state = useTextDiffStore.getState();

  assert.equal(state.activeTabId, firstTabId);
  assert.deepEqual(
    state.tabs.map((tab) => tab.id),
    [firstTabId]
  );
  assert.deepEqual(state.tabOrder, [firstTabId]);
});
