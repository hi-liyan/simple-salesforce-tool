import test from "node:test";
import assert from "node:assert/strict";
import {
  buildMysqlCreateValues,
  buildMysqlUpdateValues
} from "../../src/features/main/QueryPanel/logic/mysqlMutationPlanner.ts";
import {
  createMysqlDraftNullValue,
  createMysqlDraftOmitValue,
  createMysqlDraftValue,
  isMysqlDraftDirty
} from "../../src/features/main/QueryPanel/logic/mysqlValueSemantics.ts";

// MySQL 值语义规划测试：验证 omit/null/value 三种语义能稳定映射到提交 payload。
test("isMysqlDraftDirty: 空字符串改成 null 时应判定为脏数据", () => {
  assert.equal(isMysqlDraftDirty("", createMysqlDraftNullValue()), true);
  assert.equal(isMysqlDraftDirty(null, createMysqlDraftNullValue()), false);
  assert.equal(isMysqlDraftDirty(undefined, createMysqlDraftNullValue()), true);
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
