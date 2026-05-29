import test from "node:test";
import assert from "node:assert/strict";
import { buildGridColumns, buildIndexColumnWidth } from "../../src/components/DataGrid/hooks/useDataGridColumns.ts";

test("buildGridColumns: 第一列应固定为序号列且不再生成 checkbox 列", () => {
  const columns = buildGridColumns({
    displayColumns: ["Name", "Status"],
    headerMinWidths: {
      __index: 48,
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
  assert.equal(columns[0]?.title, "");
});

test("buildIndexColumnWidth: 翻页后应按最大序号位数自适应宽度", () => {
  const firstPageWidth = buildIndexColumnWidth({
    currentOffset: 0,
    rowCount: 20
  });
  const laterPageWidth = buildIndexColumnWidth({
    currentOffset: 1980,
    rowCount: 20
  });

  assert.equal(firstPageWidth < laterPageWidth, true);
  assert.equal(firstPageWidth <= 36, true);
  assert.equal(laterPageWidth < 48, true);
});
