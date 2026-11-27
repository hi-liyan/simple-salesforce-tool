import assert from "node:assert/strict";
import test from "node:test";
import { mysqlDriver } from "../../src/drivers/mysql/index.ts";
import {
  computeBlockDiff,
  normalizeSqlFingerprint,
  type ConsoleDiffBaseline,
  type ConsoleResultBlock
} from "../../src/features/main/QueryPanel/logic/consoleDiffEngine.ts";
import {
  applyConsoleCellEdit,
  buildConsoleBaselineMap,
  buildConsoleMutationPayload,
  resolveConsoleResultEditability,
  toggleConsoleDeleteRows
} from "../../src/features/main/QueryPanel/logic/consoleResultEdit.ts";

test("computeBlockDiff identifies added, modified, and deleted rows by primary key", () => {
  const sql = "SELECT id, name, balance FROM accounts ORDER BY id";
  const fingerprint = normalizeSqlFingerprint(sql);
  const baseline: ConsoleDiffBaseline = {
    capturedAt: "2026-11-27T10:00:00.000Z",
    blocks: [
      {
        statementIndex: 0,
        sqlFingerprint: fingerprint,
        sourceTable: "accounts",
        primaryKeyFields: ["id"],
        records: [
          { id: 1, name: "Alice", balance: 100 },
          { id: 2, name: "Bob", balance: 200 },
          { id: 3, name: "Charlie", balance: 300 }
        ]
      }
    ]
  };

  const currentBlock: ConsoleResultBlock = {
    statementIndex: 0,
    sql,
    sqlFingerprint: fingerprint,
    durationMs: 12,
    result: {
      totalSize: 3,
      records: [
        { id: 2, name: "Bob", balance: 180 }, // 修改了 balance
        { id: 1, name: "Alice", balance: 100 }, // 顺序变化但未修改
        { id: 4, name: "Diana", balance: 400 } // 新增
      ],
      resultMeta: {
        sourceTable: "accounts",
        primaryKeyFields: ["id"],
        editable: true
      }
    }
  };

  const diffAll = computeBlockDiff(currentBlock, baseline, mysqlDriver.gridAdapter, false);
  assert.equal(diffAll.hasBaseline, true);
  assert.equal(diffAll.sqlMatched, true);
  assert.equal(diffAll.matchMode, "primary_key");
  assert.equal(diffAll.addedCount, 1);
  assert.equal(diffAll.modifiedCount, 1);
  assert.equal(diffAll.deletedCount, 1);
  assert.equal(diffAll.displayRecords.length, 4); // 3 条当前 + 1 条幽灵删除行
  assert.equal(diffAll.diffOverlay.rowStatusByKey?.["2"], "modified");
  assert.equal(diffAll.diffOverlay.rowStatusByKey?.["4"], "added");
  assert.deepEqual(diffAll.diffOverlay.cellDiffByKey?.["2:balance"], {
    oldValue: 200,
    newValue: 180
  });

  // 仅看变化行时应过滤掉未变化的 id=1。
  const diffChangedOnly = computeBlockDiff(currentBlock, baseline, mysqlDriver.gridAdapter, true);
  assert.equal(diffChangedOnly.displayRecords.length, 3);
  assert.equal(
    diffChangedOnly.displayRecords.some((rec) => rec.id === 1),
    false
  );
});

test("computeBlockDiff detects SQL change and skips mismatched comparison", () => {
  const baseline: ConsoleDiffBaseline = {
    capturedAt: "2026-11-27T10:00:00.000Z",
    blocks: [
      {
        statementIndex: 0,
        sqlFingerprint: normalizeSqlFingerprint("SELECT * FROM users"),
        primaryKeyFields: ["id"],
        records: [{ id: 1, name: "Alice" }]
      }
    ]
  };
  const currentBlock: ConsoleResultBlock = {
    statementIndex: 0,
    sql: "SELECT * FROM orders",
    sqlFingerprint: normalizeSqlFingerprint("SELECT * FROM orders"),
    durationMs: 5,
    result: {
      totalSize: 1,
      records: [{ id: 10, total: 99 }]
    }
  };

  const diff = computeBlockDiff(currentBlock, baseline, mysqlDriver.gridAdapter, false);
  assert.equal(diff.hasBaseline, true);
  assert.equal(diff.sqlMatched, false);
  assert.equal(diff.addedCount, 0);
  assert.equal(diff.modifiedCount, 0);
  assert.equal(diff.deletedCount, 0);
});

test("consoleResultEdit resolves editability and builds mutation payload", () => {
  const result = {
    totalSize: 2,
    records: [
      { id: 101, status: "pending" },
      { id: 102, status: "paid" }
    ],
    resultMeta: {
      sourceTable: "orders",
      primaryKeyFields: ["id"],
      editable: true
    }
  };

  const editability = resolveConsoleResultEditability(
    "SELECT id, status FROM orders",
    result,
    {},
    mysqlDriver.gridAdapter
  );
  assert.equal(editability.editable, true);
  assert.equal(editability.sourceTable, "orders");
  assert.equal(editability.primaryKeyField, "id");

  const draft0 = {
    baselineRecords: buildConsoleBaselineMap(result.records, "id", mysqlDriver.gridAdapter),
    dirtyCellKeys: [],
    pendingDeleteRecordIds: [],
    records: result.records
  };
  const draft1 = applyConsoleCellEdit(
    draft0,
    0,
    "status",
    mysqlDriver.gridAdapter.codec.encodeValue("shipped"),
    "id",
    mysqlDriver.gridAdapter
  );
  const draft2 = toggleConsoleDeleteRows(draft1, ["102"]);
  const payload = buildConsoleMutationPayload(draft2, "id", mysqlDriver.gridAdapter);

  assert.deepEqual(payload.updates, [{ recordId: "101", values: { status: "shipped" } }]);
  assert.deepEqual(payload.deletes, ["102"]);
  assert.deepEqual(payload.creates, []);
});
