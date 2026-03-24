import test from "node:test";
import assert from "node:assert/strict";
import { hydrateTab } from "../../src/store/queryTabHydration.ts";
import { useAppStore } from "../../src/store/useAppStore.ts";

// 重置 App Store：避免测试之间共享状态导致断言互相污染。
function resetAppStoreState() {
  useAppStore.setState({
    selectedSourceId: "",
    sourceTabStateBySourceId: {},
    tabs: [],
    activeTabObjectName: "",
    loading: false
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

  store.setSelectedSourceId("sf-2");
  store.setTabs([
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

  store.setSelectedSourceId("sf-1");
  store.patchTab("sf-1::Account", (tab) => ({ ...tab, label: "Account-A-Patched" }));

  store.setSelectedSourceId("sf-1");
  assert.equal(useAppStore.getState().tabs[0]?.label, "Account-A-Patched");

  store.setSelectedSourceId("sf-2");
  assert.equal(useAppStore.getState().tabs[0]?.label, "Account-B");
});
