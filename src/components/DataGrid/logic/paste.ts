import { GridCellKind, type EditListItem, type GridColumn, type GridSelection, type Item } from "@glideapps/glide-data-grid";

type ResolveBroadcastPasteEditsParams = {
  // 当前已解析的可粘贴单元格列表：由选区变化时同步维护。
  selectedLocations: readonly Item[];
  // 剪贴板拆分后的二维文本。
  pastedValues: readonly (readonly string[])[];
};

type ResolveSelectedEditableLocationsParams = {
  // 当前表格选区：用于识别矩形/离散多选单元格。
  gridSelection: GridSelection | undefined;
  // 当前列定义：用于过滤系统列（如序号列）。
  columns: GridColumn[];
};

// 解析多选单元格单值粘贴：仅在“单值 + 多个已选数据单元格”时接管默认粘贴。
export function resolveBroadcastPasteEdits({
  selectedLocations,
  pastedValues
}: ResolveBroadcastPasteEditsParams): EditListItem[] | undefined {
  const pastedValue = resolveSinglePastedValue(pastedValues);
  if (pastedValue === undefined) {
    return undefined;
  }

  if (selectedLocations.length <= 1) {
    return undefined;
  }

  return selectedLocations.map((location) => ({
    location,
    // 统一构造文本编辑值，后续仍交由字段级编辑处理器做类型规范化与校验。
    value: {
      kind: GridCellKind.Text,
      data: pastedValue,
      displayData: pastedValue,
      allowOverlay: true
    }
  }));
}

// 从当前 Glide 选区提取可编辑目标单元格：供粘贴时直接使用最新快照，避免依赖异步 state。
export function resolveSelectedEditableLocations({
  gridSelection,
  columns
}: ResolveSelectedEditableLocationsParams): Item[] {
  return collectSelectedEditableLocations(gridSelection, columns);
}

// 解析单值剪贴板：只有严格的 1x1 内容才走“广播粘贴”。
function resolveSinglePastedValue(pastedValues: readonly (readonly string[])[]): string | undefined {
  const normalizedRows = [...pastedValues];
  while (normalizedRows.length > 1) {
    const lastRow = normalizedRows[normalizedRows.length - 1];
    const isTrailingEmptyRow = !lastRow || lastRow.length === 0 || lastRow.every((cell) => String(cell ?? "") === "");
    if (!isTrailingEmptyRow) break;
    normalizedRows.pop(); // 行内注释：兼容剪贴板尾部换行导致的空行，不把它误判成多值粘贴。
  }
  if (normalizedRows.length !== 1) return undefined;
  if (normalizedRows[0]?.length !== 1) return undefined;
  return String(normalizedRows[0][0] ?? "");
}

// 收集选中的可编辑单元格坐标：支持当前矩形选区与离散 rangeStack，自动去重并跳过系统列。
function collectSelectedEditableLocations(
  gridSelection: GridSelection | undefined,
  columns: GridColumn[]
): Item[] {
  const currentSelection = gridSelection?.current;
  if (!currentSelection) {
    return [];
  }

  const locationMap = new Map<string, readonly [number, number]>();
  const selectionRanges = [...currentSelection.rangeStack, currentSelection.range];
  selectionRanges.forEach((range) => {
    const startCol = Math.max(0, range.x);
    const endCol = Math.min(columns.length - 1, range.x + Math.max(0, range.width) - 1);
    const startRow = Math.max(0, range.y);
    const endRow = Math.max(startRow - 1, range.y + Math.max(0, range.height) - 1);
    for (let row = startRow; row <= endRow; row += 1) {
      for (let col = startCol; col <= endCol; col += 1) {
        const columnId = String(columns[col]?.id ?? "");
        if (!columnId || columnId.startsWith("__")) continue;
        const location = [col, row] as const;
        locationMap.set(`${col}:${row}`, location);
      }
    }
  });

  return Array.from(locationMap.values()).sort((left, right) => {
    if (left[1] !== right[1]) return left[1] - right[1];
    return left[0] - right[0];
  });
}
