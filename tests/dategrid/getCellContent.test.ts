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
