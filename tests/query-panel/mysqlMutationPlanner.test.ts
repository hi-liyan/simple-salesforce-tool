import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMysqlMutationPlan,
  buildMysqlCreateValues,
  buildMysqlUpdateValues
} from "../../src/features/main/QueryPanel/logic/mysqlMutationPlanner.ts";
import {
  createMysqlDraftDefaultValue,
  createMysqlDraftNullValue,
  createMysqlDraftOmitValue,
  createMysqlDraftValue,
  isMysqlDraftDirty,
  resolveMysqlDisplayValue
} from "../../src/features/main/QueryPanel/logic/mysqlValueSemantics.ts";

// MySQL 值语义规划测试：验证 omit/null/value 三种语义能稳定映射到提交 payload。
test("isMysqlDraftDirty: 空字符串改成 null 时应判定为脏数据", () => {
  assert.equal(isMysqlDraftDirty("", createMysqlDraftNullValue()), true);
  assert.equal(isMysqlDraftDirty(null, createMysqlDraftNullValue()), true);
  assert.equal(isMysqlDraftDirty(undefined, createMysqlDraftNullValue()), true);
});

test("isMysqlDraftDirty: 改成默认值语义时应判定为脏数据", () => {
  assert.equal(isMysqlDraftDirty("DONE", createMysqlDraftDefaultValue()), true);
});

test("resolveMysqlDisplayValue: DEFAULT 草稿应优先显示字段默认值文本", () => {
  assert.deepEqual(
    resolveMysqlDisplayValue(createMysqlDraftDefaultValue(), { columnDefault: "CURRENT_TIMESTAMP" }),
    { value: "CURRENT_TIMESTAMP", useNullPlaceholder: false }
  );
});

test("buildMysqlCreateValues: 应区分 omit、null、空字符串、0、false", () => {
  const values = buildMysqlCreateValues({
    record: {
      name: createMysqlDraftValue(""),
      age: createMysqlDraftValue(0),
      enabled: createMysqlDraftValue(false),
      nickname: createMysqlDraftNullValue(),
      score: createMysqlDraftOmitValue(),
      __rowStableId: "new-1"
    },
    editableFields: new Set(["name", "age", "enabled", "nickname", "score"])
  });

  assert.deepEqual(values, {
    name: "",
    age: 0,
    enabled: false,
    nickname: null
  });
});

test("buildMysqlUpdateValues: 应仅输出脏字段，并保留 null 与空字符串语义差异", () => {
  const values = buildMysqlUpdateValues({
    record: {
      name: createMysqlDraftNullValue(),
      emptyText: createMysqlDraftValue(""),
      age: createMysqlDraftValue(0),
      enabled: createMysqlDraftValue(false),
      ignored: createMysqlDraftValue("x")
    },
    dirtyFields: ["name", "emptyText", "age", "enabled"],
    editableFields: new Set(["name", "emptyText", "age", "enabled", "ignored"])
  });

  assert.deepEqual(values, {
    name: null,
    emptyText: "",
    age: 0,
    enabled: false
  });
});

test("buildMysqlUpdateValues: DEFAULT 草稿应保留到更新 payload", () => {
  const values = buildMysqlUpdateValues({
    record: {
      status: createMysqlDraftDefaultValue(),
      ignored: createMysqlDraftValue("x")
    },
    dirtyFields: ["status"],
    editableFields: new Set(["status", "ignored"])
  });

  assert.deepEqual(values, {
    status: createMysqlDraftDefaultValue()
  });
});

test("buildMysqlMutationPlan: 预览项与最终提交 payload 应共享同一份变更计划", () => {
  const deletedStableId = "mysql:id:2";
  const plan = buildMysqlMutationPlan({
    records: [
      {
        __isNew: true,
        __rowStableId: "new-1",
        name: createMysqlDraftValue(""),
        nickname: createMysqlDraftNullValue(),
        omitted: createMysqlDraftOmitValue()
      },
      {
        __rowStableId: "mysql:id:1",
        __baselineKey: "mysql:id:1",
        id: 1,
        name: "Alice",
        nickname: createMysqlDraftNullValue()
      },
      {
        __rowStableId: deletedStableId,
        __baselineKey: deletedStableId,
        id: 999,
        name: "Bob"
      }
    ],
    baselineRecords: {
      "mysql:id:1": { id: 1, name: "Alice", nickname: "" },
      [deletedStableId]: { id: 2, name: "Bob" }
    },
    dirtyCellKeys: ["mysql:id:1:nickname"],
    pendingDeleteRecordIds: [deletedStableId],
    editableFields: new Set(["name", "nickname", "omitted"]),
    sourceType: "mysql",
    mysqlPrimaryKeyField: "id"
  });

  assert.deepEqual(plan.creates, [{ name: "", nickname: null }]);
  assert.deepEqual(plan.updates, [{ recordId: "1", values: { nickname: null } }]);
  assert.deepEqual(plan.deletes, ["2"]);
  assert.deepEqual(
    plan.previewItems.map((item) => ({
      op: item.op,
      rowStableId: item.rowStableId,
      rowLocator: item.rowLocator,
      fields: item.fields
    })),
    [
      {
        op: "create",
        rowStableId: "new-1",
        rowLocator: "",
        fields: [
          { name: "name", kind: "value", value: "" },
          { name: "nickname", kind: "null", value: null }
        ]
      },
      {
        op: "update",
        rowStableId: "mysql:id:1",
        rowLocator: "1",
        fields: [{ name: "nickname", kind: "null", value: null }]
      },
      {
        op: "delete",
        rowStableId: deletedStableId,
        rowLocator: "2",
        fields: []
      }
    ]
  );
  assert.deepEqual(plan.missingRecordIdRows, []);
});

test("buildMysqlMutationPlan: 更新预览应显式标记 DEFAULT 字段写入", () => {
  const plan = buildMysqlMutationPlan({
    records: [
      {
        __rowStableId: "mysql:id:1",
        __baselineKey: "mysql:id:1",
        id: 1,
        status: createMysqlDraftDefaultValue()
      }
    ],
    baselineRecords: {
      "mysql:id:1": { id: 1, status: "DONE" }
    },
    dirtyCellKeys: ["mysql:id:1:status"],
    pendingDeleteRecordIds: [],
    editableFields: new Set(["status"]),
    sourceType: "mysql",
    mysqlPrimaryKeyField: "id"
  });

  assert.deepEqual(plan.updates, [{ recordId: "1", values: { status: createMysqlDraftDefaultValue() } }]);
  assert.deepEqual(plan.previewItems[0]?.fields, [{ name: "status", kind: "default", value: "DEFAULT" }]);
});
