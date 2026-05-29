import test from "node:test";
import assert from "node:assert/strict";
import { CompactSelection, type GridSelection } from "@glideapps/glide-data-grid";
import { resolveIndexHeaderToggleSelection, resolveIndexRowSelection } from "../../src/components/DataGrid/logic/selection.ts";

test("resolveIndexRowSelection: 拖拽序号列时应扩展为整行多选并返回命中的记录 Id", () => {
  const nextSelection: GridSelection = {
    current: {
      cell: [0, 1],
      range: {
        x: 0,
        y: 1,
        width: 1,
        height: 3
      },
      rangeStack: []
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveIndexRowSelection({
    nextSelection,
    columns: [{ id: "__index", title: "#" }, { id: "Name", title: "" }, { id: "Status", title: "" }],
    selectableIds: ["row-1", "row-2", "row-3", "row-4"]
  });

  assert.equal(result.isIndexRowSelection, true);
  assert.deepEqual(result.selectedRecordIds, ["row-2", "row-3", "row-4"]);
  assert.deepEqual(result.gridSelection?.current, {
    cell: [0, 1],
    range: {
      x: 0,
      y: 1,
      width: 3,
      height: 3
    },
    rangeStack: []
  });
});

test("resolveIndexRowSelection: 非序号列选区不应被改写", () => {
  const nextSelection: GridSelection = {
    current: {
      cell: [1, 0],
      range: {
        x: 1,
        y: 0,
        width: 2,
        height: 1
      },
      rangeStack: []
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveIndexRowSelection({
    nextSelection,
    columns: [{ id: "__index", title: "#" }, { id: "Name", title: "" }, { id: "Status", title: "" }],
    selectableIds: ["row-1", "row-2"]
  });

  assert.equal(result.isIndexRowSelection, false);
  assert.equal(result.gridSelection, nextSelection);
  assert.deepEqual(result.selectedRecordIds, []);
});

test("resolveIndexRowSelection: Ctrl 点击序号列追加离散多行时应合并历史整行选区", () => {
  const nextSelection: GridSelection = {
    current: {
      cell: [0, 3],
      range: {
        x: 0,
        y: 3,
        width: 1,
        height: 1
      },
      rangeStack: [
        {
          x: 0,
          y: 0,
          width: 1,
          height: 1
        }
      ]
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveIndexRowSelection({
    nextSelection,
    columns: [{ id: "__index", title: "#" }, { id: "Name", title: "" }, { id: "Status", title: "" }],
    selectableIds: ["row-1", "row-2", "row-3", "row-4"]
  });

  assert.equal(result.isIndexRowSelection, true);
  assert.deepEqual(result.selectedRecordIds, ["row-1", "row-4"]);
  assert.deepEqual(result.gridSelection.current?.rangeStack, [
    {
      x: 0,
      y: 0,
      width: 3,
      height: 1
    }
  ]);
  assert.deepEqual(result.gridSelection.current?.range, {
    x: 0,
    y: 3,
    width: 3,
    height: 1
  });
});

test("resolveIndexHeaderToggleSelection: 点击 # 表头时应选中当前页全部行", () => {
  const result = resolveIndexHeaderToggleSelection({
    selectableIds: ["row-1", "row-2", "row-3"],
    selectedRecordIds: ["row-1"]
  });

  assert.deepEqual(result, {
    checked: true,
    recordIds: ["row-1", "row-2", "row-3"]
  });
});

test("resolveIndexHeaderToggleSelection: 当前页已全选时再次点击 # 表头应取消全选", () => {
  const result = resolveIndexHeaderToggleSelection({
    selectableIds: ["row-1", "row-2"],
    selectedRecordIds: ["row-1", "row-2", "row-9"]
  });

  assert.deepEqual(result, {
    checked: false,
    recordIds: []
  });
});
