import test from "node:test";
import assert from "node:assert/strict";
import { hydrateTab } from "../../src/store/queryTabHydration.ts";
import { useAppStore } from "../../src/store/useAppStore.ts";
import {
  buildBaselineRecords,
  getRecordKey,
  normalizeRecordsWithStableIds
} from "../../src/features/main/QueryPanel/logic/queryUtils.ts";
import { resolveMysqlResultUpdateCapability } from "../../src/features/main/QueryPanel/logic/mysqlUpdateCapability.ts";

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

// 构造最小化 MySQL describe：用于结果集可更新性判定测试。
function createMysqlDescribe(options?: {
  primaryKeyField?: string;
}) {
  const primaryKeyField = options?.primaryKeyField || "id";
  return {
    name: "users",
    label: "users",
    fields: [
      {
        name: primaryKeyField,
        label: primaryKeyField,
        dataType: "int",
        nillable: false,
        createable: true,
        updateable: false,
        metadata: {
          columnKey: "PRI",
          mysqlDataType: "int"
        }
      },
      {
        name: "name",
        label: "name",
        dataType: "varchar",
        nillable: true,
        createable: true,
        updateable: true,
        metadata: {
          mysqlDataType: "varchar"
        }
      }
    ],
    childRelationships: []
  };
}

test("resolveMysqlResultUpdateCapability: 单表且包含主键列时应判定为 editable", () => {
  const capability = resolveMysqlResultUpdateCapability({
    sourceType: "mysql",
    objectName: "users",
    queryText: "SELECT id, name FROM users ORDER BY id DESC LIMIT 50",
    describe: createMysqlDescribe()
  });

  assert.equal(capability.mode, "editable");
  assert.equal(capability.editable, true);
  assert.equal(capability.primaryKeyField, "id");
});

test("resolveMysqlResultUpdateCapability: 缺少主键列时应判定为 readonly_missing_pk", () => {
  const capability = resolveMysqlResultUpdateCapability({
    sourceType: "mysql",
    objectName: "users",
    queryText: "SELECT name FROM users ORDER BY name ASC LIMIT 50",
    describe: createMysqlDescribe()
  });

  assert.equal(capability.mode, "readonly_missing_pk");
  assert.equal(capability.editable, false);
  assert.match(capability.reason, /主键列/);
});

test("resolveMysqlResultUpdateCapability: JOIN 查询应判定为 readonly_multi_table", () => {
  const capability = resolveMysqlResultUpdateCapability({
    sourceType: "mysql",
    objectName: "users",
    queryText: "SELECT users.id, profiles.nickname FROM users JOIN profiles ON profiles.user_id = users.id",
    describe: createMysqlDescribe()
  });

  assert.equal(capability.mode, "readonly_multi_table");
  assert.equal(capability.editable, false);
  assert.match(capability.reason, /多表/);
});

test("resolveMysqlResultUpdateCapability: 聚合查询应判定为 readonly_complex_query", () => {
  const capability = resolveMysqlResultUpdateCapability({
    sourceType: "mysql",
    objectName: "users",
    queryText: "SELECT COUNT(*) AS total FROM users",
    describe: createMysqlDescribe()
  });

  assert.equal(capability.mode, "readonly_complex_query");
  assert.equal(capability.editable, false);
  assert.match(capability.reason, /复杂查询/);
});
