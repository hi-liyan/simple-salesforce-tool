import test from "node:test";
import assert from "node:assert/strict";
import type { ObjectDescribe } from "../../src/types/index.ts";
import {
  collectMysqlMissingRequiredFields,
  hasMysqlMissingRequiredFields
} from "../../src/features/main/QueryPanel/logic/mysqlCreateValidation.ts";

function buildDescribe(fields: ObjectDescribe["fields"]): ObjectDescribe {
  return {
    name: "demo_table",
    label: "demo_table",
    fields,
    childRelationships: []
  };
}

test("collectMysqlMissingRequiredFields: 有默认值的 NOT NULL 字段不应进入缺失列表", () => {
  const describe = buildDescribe([
    {
      name: "created_at",
      label: "created_at",
      dataType: "timestamp",
      nillable: false,
      updateable: true,
      createable: true,
      metadata: {
        columnDefault: "CURRENT_TIMESTAMP",
        extra: "",
        mysqlDataType: "timestamp"
      }
    }
  ]);

  assert.deepEqual(
    collectMysqlMissingRequiredFields([{ __isNew: true }], describe),
    []
  );
});

test("hasMysqlMissingRequiredFields: 仅当存在无默认值的 NOT NULL 新建字段缺失时返回 true", () => {
  const describe = buildDescribe([
    {
      name: "name",
      label: "name",
      dataType: "varchar",
      nillable: false,
      updateable: true,
      createable: true,
      metadata: {
        columnDefault: null,
        extra: "",
        mysqlDataType: "varchar"
      }
    },
    {
      name: "created_at",
      label: "created_at",
      dataType: "timestamp",
      nillable: false,
      updateable: true,
      createable: true,
      metadata: {
        columnDefault: "CURRENT_TIMESTAMP",
        extra: "",
        mysqlDataType: "timestamp"
      }
    }
  ]);

  assert.equal(hasMysqlMissingRequiredFields([{ __isNew: true }], describe), true);
  assert.equal(
    hasMysqlMissingRequiredFields([{ __isNew: true, name: "Alice" }], describe),
    false
  );
});
