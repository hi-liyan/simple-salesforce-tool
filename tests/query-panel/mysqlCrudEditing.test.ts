import test from "node:test";
import assert from "node:assert/strict";
import { hydrateTab } from "../../src/store/queryTabHydration.ts";
import { useAppStore } from "../../src/store/useAppStore.ts";
import {
  buildBaselineRecords,
  getRecordKey,
  normalizeRecordsWithStableIds
} from "../../src/features/main/QueryPanel/logic/queryUtils.ts";

// 重置 App Store：避免测试之间共享状态导致断言互相污染。
function resetAppStoreState() {
  useAppStore.setState({
    selectedSourceId: "",
    tabs: [],
    activeTabObjectName: "",
    loading: false
  });
}

test("useAppStore: patchTab 只应接受 bindingKey，不能再按 objectName 回写同名表状态", () => {
  resetAppStoreState();
  const store = useAppStore.getState();

  store.setTabs([
    hydrateTab({
      sourceId: "mysql-a",
      sourceType: "mysql",
      sourceName: "DB-A",
      sourceColor: "#111111",
      objectName: "users",
      label: "Users-A"
    }),
    hydrateTab({
      sourceId: "mysql-b",
      sourceType: "mysql",
      sourceName: "DB-B",
      sourceColor: "#222222",
      objectName: "users",
      label: "Users-B"
    })
  ]);

  // 兼容性断言：旧的 objectName 写法不应再命中任何 Tab。
  store.patchTab("users", (tab) => ({ ...tab, label: `${tab.label}-legacy-write` }));

  let tabs = useAppStore.getState().tabs;
  assert.equal(tabs.find((tab) => tab.bindingKey === "mysql-a::users")?.label, "Users-A");
  assert.equal(tabs.find((tab) => tab.bindingKey === "mysql-b::users")?.label, "Users-B");

  // 正确写法：仅允许通过 bindingKey 更新目标 Tab。
  store.patchTab("mysql-a::users", (tab) => ({ ...tab, label: "Users-A-Patched" }));

  tabs = useAppStore.getState().tabs;
  assert.equal(tabs.find((tab) => tab.bindingKey === "mysql-a::users")?.label, "Users-A-Patched");
  assert.equal(tabs.find((tab) => tab.bindingKey === "mysql-b::users")?.label, "Users-B");
});

test("queryUtils: MySQL 主键被编辑后，旧行仍应使用稳定 rowStableId 命中基线", () => {
  const options = {
    sourceType: "mysql",
    mysqlPrimaryKeyField: "id"
  } as const;
  const records = normalizeRecordsWithStableIds(
    [
      {
        id: 1,
        name: "Alice"
      }
    ],
    options
  );
  const stableRowId = getRecordKey(records[0] || {}, 0, options);
  const baselineRecords = buildBaselineRecords(records, options);
  const editedRecord = {
    ...records[0],
    id: 2,
    name: "Alice Updated"
  };

  assert.equal(stableRowId, "mysql:id:1");
  assert.equal(records[0]?.__rowStableId, stableRowId);
  assert.equal(records[0]?.__baselineKey, stableRowId);
  assert.equal(getRecordKey(editedRecord, 0, options), stableRowId);
  assert.equal(baselineRecords[stableRowId]?.id, 1);
  assert.equal(baselineRecords[stableRowId]?.__rowStableId, stableRowId);
});
