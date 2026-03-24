import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsoleWorkspaceTabId,
  buildDataWorkspaceTabId,
  buildWorkspaceTabs,
  parseWorkspaceTabId,
  resolveActiveWorkspaceTabId
} from "../../src/features/main/QueryPanel/logic/workspaceTabs.ts";
import { useQueryWorkspaceTabsStore } from "../../src/store/useQueryWorkspaceTabsStore.ts";

// 构造最小 data tab：覆盖工作区映射所需 bindingKey 与展示标题。
function createDataTab(bindingKey: string, objectName: string, title?: string) {
  return { bindingKey, objectName, title: title || objectName };
}

// 重置工作区顺序 Store：避免测试之间共享状态导致断言互相污染。
function resetWorkspaceTabsStore() {
  useQueryWorkspaceTabsStore.setState({
    tabOrder: []
  });
}

test("构建与解析工作区 Tab ID", () => {
  const dataId = buildDataWorkspaceTabId("sf-1::Account");
  const consoleId = buildConsoleWorkspaceTabId("soql-tab-1");
  assert.equal(dataId, "data:sf-1::Account");
  assert.equal(consoleId, "console:soql-tab-1");
  assert.deepEqual(parseWorkspaceTabId(dataId), { kind: "data", targetId: "sf-1::Account" });
  assert.deepEqual(parseWorkspaceTabId(consoleId), { kind: "console", targetId: "soql-tab-1" });
  assert.equal(parseWorkspaceTabId("unknown:id"), null);
});

test("统一工作区 Tab 列表应保持 data 在前、console 在后", () => {
  const tabs = buildWorkspaceTabs(
    [createDataTab("sf-1::Account", "Account", "客户"), createDataTab("sf-1::Contact", "Contact", "联系人")],
    [
      { id: "soql-1", name: "Console 1" },
      { id: "soql-2", name: "Console 2" }
    ]
  );
  assert.deepEqual(
    tabs.map((item) => item.id),
    ["data:sf-1::Account", "data:sf-1::Contact", "console:soql-1", "console:soql-2"]
  );
  assert.deepEqual(tabs.map((item) => item.title), ["客户", "联系人", "Console 1", "Console 2"]);
});

test("激活工作区 Tab 回退：当前 ID 仍存在时保持不变", () => {
  const workspaceTabs = buildWorkspaceTabs([createDataTab("sf-1::Account", "Account")], [{ id: "soql-1", name: "Console 1" }]);
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs,
    currentActiveWorkspaceTabId: "console:soql-1",
    activeDataObjectName: "sf-1::Account",
    activeConsoleTabId: "soql-1"
  });
  assert.equal(result, "console:soql-1");
});

test("激活工作区 Tab 回退：优先回退到 data", () => {
  const workspaceTabs = buildWorkspaceTabs([createDataTab("sf-1::Account", "Account")], [{ id: "soql-1", name: "Console 1" }]);
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs,
    currentActiveWorkspaceTabId: "console:missing",
    activeDataObjectName: "sf-1::Account",
    activeConsoleTabId: "soql-1"
  });
  assert.equal(result, "data:sf-1::Account");
});

test("激活工作区 Tab 回退：无 data 时回退到 console", () => {
  const workspaceTabs = buildWorkspaceTabs([], [{ id: "soql-2", name: "Console 2" }]);
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs,
    currentActiveWorkspaceTabId: "data:missing",
    activeDataObjectName: "",
    activeConsoleTabId: "soql-2"
  });
  assert.equal(result, "console:soql-2");
});

test("激活工作区 Tab 回退：无可用 Tab 时清空", () => {
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs: [],
    currentActiveWorkspaceTabId: "data:any",
    activeDataObjectName: "",
    activeConsoleTabId: ""
  });
  assert.equal(result, "");
});

test("workspace tabs: 多 source tab 混合显示时应按全局工作区顺序恢复", () => {
  resetWorkspaceTabsStore();
  const store = useQueryWorkspaceTabsStore.getState();
  const globalOrder = ["data:sf-1::Account", "console:soql-a", "data:mysql-1::users"];

  store.setTabOrder("sf-1", globalOrder);

  assert.deepEqual(useQueryWorkspaceTabsStore.getState().getTabOrder("mysql-1"), globalOrder);
});
