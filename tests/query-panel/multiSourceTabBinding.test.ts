import test from "node:test";
import assert from "node:assert/strict";
import { hydrateTab } from "../../src/store/queryTabHydration.ts";
import { useAppStore } from "../../src/store/useAppStore.ts";
import { useSoqlExecutorStore } from "../../src/store/useSoqlExecutorStore.ts";

// 重置 App Store：避免测试之间共享状态导致断言互相污染。
function resetAppStoreState() {
  useAppStore.setState({
    selectedSourceId: "",
    viewMode: "query",
    tabs: [],
    activeTabObjectName: "",
    toolsPanelActiveToolId: null,
    loading: false
  });
}

// 重置控制台 Store：避免测试之间共享状态导致断言互相污染。
function resetSoqlExecutorStoreState() {
  useSoqlExecutorStore.setState({
    tabs: [],
    activeTabId: ""
  });
}

test("hydrateTab: 应保留对象 Tab 的 source 元信息", () => {
  const tab = hydrateTab({
    objectName: "Account",
    label: "客户",
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "Prod Org",
    sourceColor: "#2563EB"
  });

  assert.equal(tab.sourceId, "sf-1");
  assert.equal(tab.sourceType, "salesforce");
  assert.equal(tab.sourceName, "Prod Org");
  assert.equal(tab.sourceColor, "#2563EB");
  assert.equal(tab.bindingKey, "sf-1::Account");
});

test("hydrateTab: 历史快照缺少 source 元信息时应安全回退为空字符串", () => {
  const tab = hydrateTab({
    objectName: "Contact",
    label: "联系人"
  });

  assert.equal(tab.sourceId, "");
  assert.equal(tab.sourceType, "");
  assert.equal(tab.sourceName, "");
  assert.equal(tab.sourceColor, "");
  assert.equal(tab.bindingKey, "::Contact");
});

test("useAppStore: 使用 source+object 唯一键补丁时，不应覆盖其他 source 的同名对象 Tab", () => {
  resetAppStoreState();
  const store = useAppStore.getState();

  store.setSelectedSourceId("sf-1");
  store.setTabs([
    hydrateTab({
      sourceId: "sf-1",
      sourceType: "salesforce",
      sourceName: "Org A",
      sourceColor: "#111111",
      objectName: "Account",
      label: "Account-A"
    })
  ]);
  store.setActiveTabObjectName("Account");

  store.setTabs((current) => [
    ...current,
    hydrateTab({
      sourceId: "sf-2",
      sourceType: "salesforce",
      sourceName: "Org B",
      sourceColor: "#222222",
      objectName: "Account",
      label: "Account-B"
    })
  ]);
  store.setActiveTabObjectName("Account");

  store.patchTab("sf-1::Account", (tab) => ({ ...tab, label: "Account-A-Patched" }));

  const tabs = useAppStore.getState().tabs;
  assert.equal(tabs.find((tab) => tab.bindingKey === "sf-1::Account")?.label, "Account-A-Patched");
  assert.equal(tabs.find((tab) => tab.bindingKey === "sf-2::Account")?.label, "Account-B");
});

test("useAppStore: 切换 selectedSourceId 后不应丢失已打开的多 source 对象 Tab", () => {
  resetAppStoreState();
  const store = useAppStore.getState();

  store.setTabs([
    hydrateTab({
      sourceId: "sf-1",
      sourceType: "salesforce",
      sourceName: "Org A",
      sourceColor: "#111111",
      objectName: "Account",
      label: "Account-A"
    }),
    hydrateTab({
      sourceId: "mysql-1",
      sourceType: "mysql",
      sourceName: "DB A",
      sourceColor: "#222222",
      objectName: "users",
      label: "Users"
    })
  ]);
  store.setActiveTabObjectName("sf-1::Account");

  store.setSelectedSourceId("sf-1");
  store.setSelectedSourceId("mysql-1");

  assert.deepEqual(
    useAppStore.getState().tabs.map((tab) => tab.bindingKey),
    ["sf-1::Account", "mysql-1::users"]
  );
});

test("useAppStore: 从 tools 切到其他 panel 再切回时，应保留上一次工具页", () => {
  resetAppStoreState();
  const store = useAppStore.getState();

  store.setViewMode("tools");
  store.setToolsPanelActiveToolId("json-diff");
  store.setViewMode("query");
  store.setViewMode("tools");

  assert.equal(useAppStore.getState().viewMode, "tools");
  assert.equal(useAppStore.getState().toolsPanelActiveToolId, "json-diff");

  store.setToolsPanelActiveToolId(null);
  assert.equal(useAppStore.getState().toolsPanelActiveToolId, null);
});

test("console tabs: 应永久绑定创建时 sourceId/sourceType/sourceName/sourceColor", () => {
  resetSoqlExecutorStoreState();
  const store = useSoqlExecutorStore.getState();

  const sourceATabId = store.createTab({
    sourceId: "sf-1",
    sourceType: "salesforce",
    sourceName: "Org A",
    sourceColor: "#2563EB"
  });
  const sourceBTabId = useSoqlExecutorStore.getState().createTab({
    sourceId: "mysql-1",
    sourceType: "mysql",
    sourceName: "DB A",
    sourceColor: "#DC2626"
  });

  const tabs = useSoqlExecutorStore.getState().tabs;
  const sourceATab = tabs.find((tab) => tab.id === sourceATabId);
  const sourceBTab = tabs.find((tab) => tab.id === sourceBTabId);

  assert.equal(sourceATab?.sourceId, "sf-1");
  assert.equal(sourceATab?.sourceType, "salesforce");
  assert.equal(sourceATab?.sourceName, "Org A");
  assert.equal(sourceATab?.sourceColor, "#2563EB");
  assert.equal(sourceBTab?.sourceId, "mysql-1");
  assert.equal(sourceBTab?.sourceType, "mysql");
  assert.equal(sourceBTab?.sourceName, "DB A");
  assert.equal(sourceBTab?.sourceColor, "#DC2626");
});
