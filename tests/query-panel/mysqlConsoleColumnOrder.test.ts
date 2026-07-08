import test from "node:test";
import assert from "node:assert/strict";
import type { ObjectDescribe } from "../../src/types/index.ts";
import { resolveDisplayColumns } from "../../src/components/DataGrid/hooks/useDataGridColumns.ts";
import { resolveMysqlConsoleVisibleColumns } from "../../src/features/main/QueryPanel/logic/mysqlConsoleColumnOrder.ts";

// 构造 MySQL 表字段元数据：字段顺序即表默认顺序。
function createMysqlDescribe(fieldNames: string[]): ObjectDescribe {
  return {
    name: "orders",
    label: "orders",
    fields: fieldNames.map((fieldName) => ({
      name: fieldName,
      label: fieldName,
      dataType: "string",
      nillable: true,
      updateable: true,
      createable: true,
      metadata: {}
    })),
    childRelationships: []
  };
}

test("mysqlConsoleColumnOrder: SELECT * 应按表字段默认顺序返回，并忽略兼容 Id 列", () => {
  const visibleColumns = resolveMysqlConsoleVisibleColumns({
    queryText: "SELECT * FROM orders",
    describe: createMysqlDescribe(["order_id", "status", "created_at"]),
    records: [
      {
        status: "NEW",
        Id: "A-100",
        created_at: "2026-07-08 10:00:00",
        order_id: "A-100"
      }
    ]
  });

  assert.deepEqual(visibleColumns, ["order_id", "status", "created_at"]);
});

test("mysqlConsoleColumnOrder: SELECT 具体字段时应按 SELECT 后字段顺序返回", () => {
  const visibleColumns = resolveMysqlConsoleVisibleColumns({
    queryText: "SELECT status, order_id FROM orders",
    describe: createMysqlDescribe(["order_id", "status", "created_at"]),
    records: [
      {
        order_id: "A-100",
        Id: "A-100",
        status: "NEW"
      }
    ]
  });

  assert.deepEqual(visibleColumns, ["status", "order_id"]);
});

test("mysqlConsoleColumnOrder: 别名列应按 SELECT 顺序返回别名", () => {
  const visibleColumns = resolveMysqlConsoleVisibleColumns({
    queryText: "SELECT status AS current_status, COUNT(*) AS total FROM orders",
    describe: createMysqlDescribe(["order_id", "status", "created_at"]),
    records: [
      {
        total: 3,
        current_status: "NEW",
        Id: "A-100"
      }
    ]
  });

  assert.deepEqual(visibleColumns, ["current_status", "total"]);
});

test("useDataGridColumns: 保留输入顺序时不应再把 Id 和 Name 强行提前", () => {
  assert.deepEqual(
    resolveDisplayColumns(["status", "Id", "Name", "order_id"], true),
    ["status", "Id", "Name", "order_id"]
  );
});
