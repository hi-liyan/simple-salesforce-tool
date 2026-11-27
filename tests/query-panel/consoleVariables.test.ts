import assert from "node:assert/strict";
import test from "node:test";
import { splitSqlStatementsWithRanges } from "../../src/components/codemirror/sqlCompletion.ts";
import { mysqlDriver } from "../../src/drivers/mysql/index.ts";
import { salesforceDriver } from "../../src/drivers/salesforce/index.ts";
import {
  extractContextVariablesFromResult,
  mergeConsoleContextVariables,
  resolveAndBindConsoleVariables,
  scanSqlPlaceholders
} from "../../src/features/main/QueryPanel/logic/consoleVariables.ts";
import type { ObjectDescribe } from "../../src/types/index.ts";

const driversDescribe: ObjectDescribe = {
  name: "drivers",
  label: "drivers",
  queryable: true,
  createable: true,
  updateable: true,
  deleteable: true,
  fields: [
    { name: "DRIVER_ID", label: "DRIVER_ID", dataType: "bigint", nillable: false, updateable: false, createable: false, filterable: true, sortable: true },
    { name: "DRIVER_PHONE", label: "DRIVER_PHONE", dataType: "varchar", nillable: false, updateable: true, createable: true, filterable: true, sortable: true },
    { name: "CREATED_AT", label: "CREATED_AT", dataType: "datetime", nillable: false, updateable: true, createable: true, filterable: true, sortable: true }
  ],
  childRelationships: []
};

const describeMap: Record<string, ObjectDescribe> = {
  drivers: driversDescribe,
  orders: {
    ...driversDescribe,
    name: "orders",
    label: "orders"
  }
};

test("scanSqlPlaceholders skips comments and string literals", () => {
  const sql = `
    -- SELECT * FROM drivers WHERE id = #{ignoredInComment}
    /* #{ignoredInBlock} */
    SELECT * FROM drivers WHERE name = '#{ignoredInString}' AND DRIVER_PHONE = #{driverId} AND DRIVER_ID IN (#{ids}) LIMIT #{pageSize};
  `;
  const occs = scanSqlPlaceholders(sql);
  assert.deepEqual(
    occs.map((o) => ({ name: o.name, op: o.operator, col: o.leftColumn, parens: o.hasSurroundingParens })),
    [
      { name: "driverId", op: "=", col: "DRIVER_PHONE", parens: false },
      { name: "ids", op: "IN", col: "DRIVER_ID", parens: true },
      { name: "pageSize", op: "LIMIT", col: "", parens: false }
    ]
  );
});

test("resolves manual variable with MySQL escaping and type validation", () => {
  const res = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM drivers WHERE DRIVER_PHONE = #{driverId};",
    contextVariables: {},
    manualVariables: { driverId: { value: "138'00138000" } },
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.executedSql, "SELECT * FROM drivers WHERE DRIVER_PHONE = '138\\'00138000';");
  }
});

test("rejects multi-row context variable on equality operator with IN suggestion", () => {
  const ctxEntries = extractContextVariablesFromResult({
    sql: "SELECT DRIVER_ID did FROM drivers;",
    statementIndex: 0,
    result: {
      totalSize: 2,
      records: [{ did: 101 }, { did: 102 }],
      columnTypes: { did: "BIGINT" }
    },
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  const ctx = mergeConsoleContextVariables({}, ctxEntries, 0);

  const failRes = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID = #{did};",
    contextVariables: ctx,
    manualVariables: {},
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(failRes.ok, false);
  if (!failRes.ok) {
    assert.match(failRes.errors[0].suggestion, /IN \(#\{did\}\)/);
  }

  // 支持 IN (#{did}) 与 IN #{did} 双写法。
  const okWithParens = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID IN (#{did});",
    contextVariables: ctx,
    manualVariables: {},
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(okWithParens.ok, true);
  if (okWithParens.ok) {
    assert.equal(okWithParens.executedSql, "SELECT * FROM orders WHERE DRIVER_ID IN (101, 102);");
  }

  const okWithoutParens = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID IN #{did};",
    contextVariables: ctx,
    manualVariables: {},
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(okWithoutParens.ok, true);
  if (okWithoutParens.ok) {
    assert.equal(okWithoutParens.executedSql, "SELECT * FROM orders WHERE DRIVER_ID IN (101, 102);");
  }
});

test("enforces case sensitivity and detects ambiguous context variables", () => {
  const ctx1 = mergeConsoleContextVariables(
    {},
    extractContextVariablesFromResult({
      sql: "SELECT DRIVER_ID did FROM drivers;",
      statementIndex: 0,
      result: { totalSize: 1, records: [{ did: 101 }], columnTypes: { did: "BIGINT" } },
      objectDescribeMap: describeMap,
      driver: mysqlDriver
    }),
    0
  );

  // 大小写不匹配时报错并给出相似变量提示。
  const caseRes = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID = #{DID};",
    contextVariables: ctx1,
    manualVariables: {},
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(caseRes.ok, false);
  if (!caseRes.ok) {
    assert.match(caseRes.errors[0].suggestion, /did/);
  }

  // 不同语句产生同名变量 -> 歧义冲突；允许手工覆写绕过。
  const ctx2 = mergeConsoleContextVariables(
    ctx1,
    extractContextVariablesFromResult({
      sql: "SELECT DRIVER_ID did FROM drivers WHERE DRIVER_PHONE = '1';",
      statementIndex: 1,
      result: { totalSize: 1, records: [{ did: 202 }], columnTypes: { did: "BIGINT" } },
      objectDescribeMap: describeMap,
      driver: mysqlDriver
    }),
    1
  );
  const conflictRes = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID = #{did};",
    contextVariables: ctx2,
    manualVariables: {},
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(conflictRes.ok, false);
  if (!conflictRes.ok) {
    assert.match(conflictRes.errors[0].message, /不唯一/);
  }

  const overrideRes = resolveAndBindConsoleVariables({
    sql: "SELECT * FROM orders WHERE DRIVER_ID = #{did};",
    contextVariables: ctx2,
    manualVariables: { did: { value: "999", overrideContext: true } },
    objectDescribeMap: describeMap,
    driver: mysqlDriver
  });
  assert.equal(overrideRes.ok, true);
  if (overrideRes.ok) {
    assert.equal(overrideRes.executedSql, "SELECT * FROM orders WHERE DRIVER_ID = 999;");
  }
});

test("formats SOQL date literals without quotes", () => {
  const res = resolveAndBindConsoleVariables({
    sql: "SELECT Id FROM Account WHERE CreatedDate > #{since}",
    contextVariables: {},
    manualVariables: { since: { value: "2026-11-27T00:00:00Z", typeOverride: "datetime" } },
    objectDescribeMap: {},
    driver: salesforceDriver
  });
  assert.equal(res.ok, true);
  if (res.ok) {
    assert.equal(res.executedSql, "SELECT Id FROM Account WHERE CreatedDate > 2026-11-27T00:00:00Z");
  }
});

test("splitSqlStatementsWithRanges does not treat #{} placeholder as MySQL # comment", () => {
  const doc = [
    "SELECT DRIVER_ID did FROM drivers WHERE DRIVER_PHONE = #{driverPhone};",
    "",
    "SELECT * FROM orders where DRIVER_ID = #{did};"
  ].join("\n");
  const stmts = splitSqlStatementsWithRanges(doc);
  assert.equal(stmts.length, 2);
  assert.equal(stmts[0].sql, "SELECT DRIVER_ID did FROM drivers WHERE DRIVER_PHONE = #{driverPhone}");
  assert.equal(stmts[1].sql, "SELECT * FROM orders where DRIVER_ID = #{did}");
});
