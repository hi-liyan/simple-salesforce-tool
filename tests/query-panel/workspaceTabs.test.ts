import test from "node:test";
import assert from "node:assert/strict";
import {
  buildConsoleWorkspaceTabId,
  buildDataWorkspaceTabId,
  buildWorkspaceTabs,
  parseWorkspaceTabId,
  resolveActiveWorkspaceTabId
} from "../../src/features/main/QueryPanel/logic/workspaceTabs.ts";

// 构造最小 data tab：仅保留工作区映射所需 objectName。
function createDataTab(objectName: string) {
  return { objectName };
}

test("构建与解析工作区 Tab ID", () => {
  const dataId = buildDataWorkspaceTabId("Account");
  const consoleId = buildConsoleWorkspaceTabId("soql-tab-1");
  assert.equal(dataId, "data:Account");
  assert.equal(consoleId, "console:soql-tab-1");
  assert.deepEqual(parseWorkspaceTabId(dataId), { kind: "data", targetId: "Account" });
  assert.deepEqual(parseWorkspaceTabId(consoleId), { kind: "console", targetId: "soql-tab-1" });
  assert.equal(parseWorkspaceTabId("unknown:id"), null);
});

test("统一工作区 Tab 列表应保持 data 在前、console 在后", () => {
  const tabs = buildWorkspaceTabs(
    [createDataTab("Account"), createDataTab("Contact")],
    [
      { id: "soql-1", name: "Console 1" },
      { id: "soql-2", name: "Console 2" }
    ]
  );
  assert.deepEqual(
    tabs.map((item) => item.id),
    ["data:Account", "data:Contact", "console:soql-1", "console:soql-2"]
  );
});

test("激活工作区 Tab 回退：当前 ID 仍存在时保持不变", () => {
  const workspaceTabs = buildWorkspaceTabs([createDataTab("Account")], [{ id: "soql-1", name: "Console 1" }]);
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs,
    currentActiveWorkspaceTabId: "console:soql-1",
    activeDataObjectName: "Account",
    activeConsoleTabId: "soql-1"
  });
  assert.equal(result, "console:soql-1");
});

test("激活工作区 Tab 回退：优先回退到 data", () => {
  const workspaceTabs = buildWorkspaceTabs([createDataTab("Account")], [{ id: "soql-1", name: "Console 1" }]);
  const result = resolveActiveWorkspaceTabId({
    workspaceTabs,
    currentActiveWorkspaceTabId: "console:missing",
    activeDataObjectName: "Account",
    activeConsoleTabId: "soql-1"
  });
  assert.equal(result, "data:Account");
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
