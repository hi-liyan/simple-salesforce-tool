import test from "node:test";
import assert from "node:assert/strict";
import { useTerminalStore } from "../../src/store/useTerminalStore.ts";

// 重置终端 store：保证各测试之间彼此独立，避免共享运行态污染断言。
function resetTerminalStore() {
  useTerminalStore.setState({
    tabs: [],
    tabOrder: [],
    activeTabId: ""
  });
}

test("Terminal store 应保持全局独立状态，不暴露数据源切换能力", () => {
  resetTerminalStore();

  const firstTabId = useTerminalStore.getState().createTerminalTab("sf org list", "Terminal A");
  const secondTabId = useTerminalStore.getState().createTerminalTab("sf data query", "Terminal B");

  // 终端状态应只围绕 Tabs 自身收敛，不再携带 QueryPanel 的数据源上下文。
  const state = useTerminalStore.getState() as Record<string, unknown>;
  assert.equal(typeof state.switchSource, "undefined");
  assert.equal(typeof state.sourceId, "undefined");
  assert.equal(state.tabs instanceof Array, true);
  assert.equal(state.activeTabId, secondTabId);
  assert.equal((state.tabs as { id: string }[]).length, 2);
  assert.equal((state.tabs as { id: string }[]).some((tab) => tab.id === firstTabId), true);
  assert.equal((state.tabs as { id: string }[]).some((tab) => tab.id === secondTabId), true);
});

test("Terminal store 在常规 Tab 操作后应持续保留已有终端内容", () => {
  resetTerminalStore();

  const terminalTabId = useTerminalStore.getState().createTerminalTab("echo hello", "Terminal A");
  useTerminalStore.getState().appendTerminalOutput(terminalTabId, {
    kind: "stdout",
    text: "hello"
  });
  useTerminalStore.getState().setActiveTabId(terminalTabId);

  const state = useTerminalStore.getState();
  const terminalTab = state.tabs.find((tab) => tab.id === terminalTabId);

  assert.equal(state.activeTabId, terminalTabId);
  assert.equal(terminalTab?.name, "Terminal A");
  assert.equal(terminalTab?.inputDraft, "echo hello");
  assert.equal(terminalTab?.outputs.some((line) => line.text === "hello"), true);
});

test("Terminal store 应支持重命名与拖拽排序，并保持顺序状态独立", () => {
  resetTerminalStore();

  const firstTabId = useTerminalStore.getState().createTerminalTab("echo 1", "Terminal 1");
  const secondTabId = useTerminalStore.getState().createTerminalTab("echo 2", "Terminal 2");

  useTerminalStore.getState().renameTerminalTab(firstTabId, "已重命名终端");
  useTerminalStore.getState().reorderTerminalTabs(secondTabId, firstTabId);

  const state = useTerminalStore.getState();
  const renamedTab = state.tabs.find((tab) => tab.id === firstTabId);

  assert.equal(renamedTab?.name, "已重命名终端");
  assert.deepEqual(state.tabOrder.slice(0, 2), [secondTabId, firstTabId]);
  assert.equal(typeof (state as Record<string, unknown>).sourceId, "undefined");
});
