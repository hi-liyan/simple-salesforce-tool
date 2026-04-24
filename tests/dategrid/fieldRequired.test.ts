import test from "node:test";
import assert from "node:assert/strict";
import { isRequiredOnCreate } from "../../src/components/DataGrid/utils/field.ts";

test("isRequiredOnCreate: MySQL 非空且有默认值字段不应标记为创建必填", () => {
  assert.equal(
    isRequiredOnCreate(
      {
        createable: true,
        nillable: false,
        mysqlDataType: "timestamp",
        columnDefault: "CURRENT_TIMESTAMP"
      },
      true
    ),
    false
  );
});

test("isRequiredOnCreate: MySQL 非空且无默认值字段应标记为创建必填", () => {
  assert.equal(
    isRequiredOnCreate(
      {
        createable: true,
        nillable: false,
        mysqlDataType: "varchar",
        columnDefault: null
      },
      true
    ),
    true
  );
});
