import { CompactSelection, type GridColumn, type GridSelection } from "@glideapps/glide-data-grid";

type ResolveIndexRowSelectionParams = {
  // Glide 原始选区：由 DataEditor 在点击/拖拽后回传。
  nextSelection: GridSelection;
  // 当前表格列定义：用于判断是否命中序号列，并计算整行范围宽度。
  columns: GridColumn[];
  // 当前结果集的稳定记录 Id 列表：用于把行选区同步为外层业务选中态。
  selectableIds: string[];
};

type IndexRowSelectionResult = {
  // 改写后的受控选区：命中序号列时会扩展为整行范围。
  gridSelection: GridSelection;
  // 当前命中的记录 Id 列表：供外层同步选中记录。
  selectedRecordIds: string[];
  // 是否命中了序号列行选区。
  isIndexRowSelection: boolean;
};

// 统一处理序号列选区：点击/拖拽序号列时，将单列选区扩展为整行选区。
export function resolveIndexRowSelection({
  nextSelection,
  columns,
  selectableIds
}: ResolveIndexRowSelectionParams): IndexRowSelectionResult {
  const currentSelection = nextSelection.current;
  if (!currentSelection) {
    return {
      gridSelection: nextSelection,
      selectedRecordIds: [],
      isIndexRowSelection: false
    };
  }

  const [col] = currentSelection.cell;
  const columnId = String(columns[col]?.id ?? "");
  if (columnId !== "__index") {
    return {
      gridSelection: nextSelection,
      selectedRecordIds: [],
      isIndexRowSelection: false
    };
  }

  const indexColumn = columns.findIndex((item) => String(item.id ?? "") === "__index");
  const startCol = indexColumn >= 0 ? indexColumn : 0;
  const expandRangeToFullRow = (range: { x: number; y: number; width: number; height: number }) => ({
    x: startCol,
    y: range.y,
    width: Math.max(1, columns.length - startCol),
    height: Math.max(1, range.height)
  });

  const normalizedRangeStack = currentSelection.rangeStack.map(expandRangeToFullRow);
  const normalizedCurrentRange = expandRangeToFullRow(currentSelection.range);
  const selectedRowSet = new Set<number>();
  [...normalizedRangeStack, normalizedCurrentRange].forEach((range) => {
    const startRow = Math.max(0, range.y);
    const endRow = Math.min(selectableIds.length - 1, range.y + range.height - 1);
    for (let rowIndex = startRow; rowIndex <= endRow; rowIndex += 1) {
      selectedRowSet.add(rowIndex);
    }
  });
  const selectedRecordIds = Array.from(selectedRowSet)
    .sort((left, right) => left - right)
    .map((rowIndex) => selectableIds[rowIndex])
    .filter((recordId): recordId is string => Boolean(recordId));

  return {
    gridSelection: {
      current: {
        cell: [startCol, currentSelection.cell[1]],
        range: normalizedCurrentRange,
        rangeStack: normalizedRangeStack
      },
      columns: CompactSelection.empty(),
      rows: CompactSelection.empty()
    },
    selectedRecordIds,
    isIndexRowSelection: true
  };
}
