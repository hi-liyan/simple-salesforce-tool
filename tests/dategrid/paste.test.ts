import test from "node:test";
import assert from "node:assert/strict";
import { CompactSelection, GridCellKind, type GridSelection } from "@glideapps/glide-data-grid";
import { resolveBroadcastPasteEdits, resolveSelectedEditableLocations } from "../../src/components/DataGrid/logic/paste.ts";

test("resolveBroadcastPasteEdits: 单值粘贴到多选单元格时应广播到全部已选数据单元格", () => {
  const gridSelection: GridSelection = {
    current: {
      cell: [1, 0],
      range: {
        x: 1,
        y: 0,
        width: 2,
        height: 2
      },
      rangeStack: []
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveBroadcastPasteEdits({
    selectedLocations: resolveSelectedEditableLocations({
      gridSelection,
      columns: [
        { id: "__index", title: "#" },
        { id: "Name", title: "Name" },
        { id: "Status", title: "Status" }
      ]
    }),
    pastedValues: [["已同步"]]
  });

  assert.deepEqual(result, [
    {
      location: [1, 0],
      value: { kind: GridCellKind.Text, data: "已同步", displayData: "已同步", allowOverlay: true }
    },
    {
      location: [2, 0],
      value: { kind: GridCellKind.Text, data: "已同步", displayData: "已同步", allowOverlay: true }
    },
    {
      location: [1, 1],
      value: { kind: GridCellKind.Text, data: "已同步", displayData: "已同步", allowOverlay: true }
    },
    {
      location: [2, 1],
      value: { kind: GridCellKind.Text, data: "已同步", displayData: "已同步", allowOverlay: true }
    }
  ]);
});

test("resolveBroadcastPasteEdits: 离散多选区单值粘贴时应去重后广播", () => {
  const gridSelection: GridSelection = {
    current: {
      cell: [2, 2],
      range: {
        x: 2,
        y: 2,
        width: 1,
        height: 1
      },
      rangeStack: [
        {
          x: 1,
          y: 0,
          width: 1,
          height: 1
        },
        {
          x: 1,
          y: 0,
          width: 2,
          height: 1
        }
      ]
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const selectedLocations = resolveSelectedEditableLocations({
    gridSelection,
    columns: [
      { id: "__index", title: "#" },
      { id: "Name", title: "Name" },
      { id: "Status", title: "Status" }
    ]
  });
  const result = resolveBroadcastPasteEdits({
    selectedLocations,
    pastedValues: [["DONE"]]
  });

  assert.deepEqual(selectedLocations, [
    [1, 0],
    [2, 0],
    [2, 2]
  ]);
  assert.deepEqual(result?.map((item) => item.location), [
    [1, 0],
    [2, 0],
    [2, 2]
  ]);
});

test("resolveBroadcastPasteEdits: 二维粘贴内容应回退到默认矩形粘贴", () => {
  const gridSelection: GridSelection = {
    current: {
      cell: [1, 0],
      range: {
        x: 1,
        y: 0,
        width: 2,
        height: 2
      },
      rangeStack: []
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveBroadcastPasteEdits({
    selectedLocations: resolveSelectedEditableLocations({
      gridSelection,
      columns: [
        { id: "__index", title: "#" },
        { id: "Name", title: "Name" },
        { id: "Status", title: "Status" }
      ]
    }),
    pastedValues: [
      ["A", "B"],
      ["C", "D"]
    ]
  });

  assert.equal(result, undefined);
});

test("resolveBroadcastPasteEdits: 单值尾部带空行时仍应识别为广播粘贴", () => {
  const result = resolveBroadcastPasteEdits({
    selectedLocations: [
      [1, 0],
      [1, 1]
    ],
    pastedValues: [
      ["0"],
      []
    ]
  });

  assert.deepEqual(result, [
    {
      location: [1, 0],
      value: { kind: GridCellKind.Text, data: "0", displayData: "0", allowOverlay: true }
    },
    {
      location: [1, 1],
      value: { kind: GridCellKind.Text, data: "0", displayData: "0", allowOverlay: true }
    }
  ]);
});

test("resolveBroadcastPasteEdits: 仅命中一个可编辑单元格时不应接管默认粘贴", () => {
  const gridSelection: GridSelection = {
    current: {
      cell: [0, 0],
      range: {
        x: 0,
        y: 0,
        width: 2,
        height: 1
      },
      rangeStack: []
    },
    columns: CompactSelection.empty(),
    rows: CompactSelection.empty()
  };

  const result = resolveBroadcastPasteEdits({
    selectedLocations: resolveSelectedEditableLocations({
      gridSelection,
      columns: [
        { id: "__index", title: "#" },
        { id: "__meta", title: "meta" }
      ]
    }),
    pastedValues: [["X"]]
  });

  assert.equal(result, undefined);
});
