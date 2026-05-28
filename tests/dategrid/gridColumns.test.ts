import test from "node:test";
import assert from "node:assert/strict";
import { buildGridColumns } from "../../src/components/DataGrid/hooks/useDataGridColumns.ts";

test("buildGridColumns: 第一列应固定为序号列且不再生成 checkbox 列", () => {
  const columns = buildGridColumns({
    displayColumns: ["Name", "Status"],
    headerMinWidths: {
      __index: 56,
      Name: 88,
      Status: 96
    },
    columnWidths: {},
    autoColumnWidths: {
      Name: 120,
      Status: 140
    }
  });

  assert.deepEqual(
    columns.map((column) => column.id),
    ["__index", "Name", "Status"]
  );
  assert.equal(columns[0]?.title, "#");
});
