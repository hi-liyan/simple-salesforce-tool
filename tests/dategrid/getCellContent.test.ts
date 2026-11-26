import test from "node:test";
import assert from "node:assert/strict";
import { createGetCellContent } from "../../src/components/DataGrid/renderers/getCellContent.ts";

test("createGetCellContent: 序号列应按分页 offset 连续编号", () => {
  const getCellContent = createGetCellContent({
    columns: [{ id: "__index", title: "#", width: 40 }],
    records: [{ Id: "001" }, { Id: "002" }],
    fieldMetadataMap: {},
    selectedRecordSet: new Set(),
    dirtyCellSet: new Set(),
    pendingDeleteRecordSet: new Set(),
    effectiveSalesforceTimezone: null,
    currentOffset: 200,
    getRecordKey: (rowIndex) => `row-${rowIndex}`,
    allowReadonlyOverlay: false
  });

  const firstCell = getCellContent([0, 0]);
  const secondCell = getCellContent([0, 1]);

  assert.equal(firstCell.displayData, "201");
  assert.equal(secondCell.displayData, "202");
  assert.equal(firstCell.contentAlign, "center");
});

test("createGetCellContent: MySQL DECIMAL 与 BIGINT 应按高精度文本原样渲染，TINYINT(1) 应按数字渲染", () => {
  const getCellContent = createGetCellContent({
    columns: [
      { id: "amount", title: "amount", width: 120 },
      { id: "snowflake_id", title: "snowflake_id", width: 180 },
      { id: "is_enabled", title: "is_enabled", width: 80 }
    ],
    records: [
      {
        amount: "123456789012345678.90",
        snowflake_id: "9223372036854775807",
        is_enabled: 1
      }
    ],
    fieldMetadataMap: {
      amount: { type: "decimal", mysqlDataType: "decimal", columnType: "decimal(22,2)" },
      snowflake_id: { type: "bigint", mysqlDataType: "bigint", columnType: "bigint(20)" },
      is_enabled: { type: "tinyint", mysqlDataType: "tinyint", columnType: "tinyint(1)" }
    },
    selectedRecordSet: new Set(),
    dirtyCellSet: new Set(),
    pendingDeleteRecordSet: new Set(),
    effectiveSalesforceTimezone: null,
    selectedSourceType: "mysql",
    getRecordKey: (rowIndex) => `row-${rowIndex}`,
    allowReadonlyOverlay: false
  });

  const decimalCell = getCellContent([0, 0]);
  const bigintCell = getCellContent([1, 0]);
  const tinyintCell = getCellContent([2, 0]);

  assert.equal(decimalCell.displayData, "123456789012345678.90");
  assert.equal(bigintCell.displayData, "9223372036854775807");
  assert.equal(tinyintCell.displayData, "1");
});
