import { GridCell } from "@glideapps/glide-data-grid";

// 根据元数据计算单元格样式（脏数据高亮 + 必填缺失红色提示）。
export function buildCellThemeOverride(
  isDirty: boolean,
  requiredMissing: boolean,
  selected: boolean,
  pendingDelete: boolean,
  isNewRow: boolean
): GridCell["themeOverride"] | undefined {
  if (selected) {
    return {
      bgCell: "#dceeff",
      bgCellMedium: "#c7e4ff"
    };
  }
  if (pendingDelete) {
    return {
      bgCell: "#eceff3",
      bgCellMedium: "#dfe4ea"
    };
  }
  if (requiredMissing) {
    return {
      bgCell: "#ffeaea",
      bgCellMedium: "#ffd3d3"
    };
  }
  if (isNewRow) {
    return {
      bgCell: "#ebfaef",
      bgCellMedium: "#d5f3dc"
    };
  }
  if (isDirty) {
    return {
      bgCell: "#fff6d9",
      bgCellMedium: "#ffe9a8"
    };
  }
  return undefined;
}

// 行级样式：用于选择列与序号列的统一高亮。
export function buildRowThemeOverride(
  selected: boolean,
  pendingDelete: boolean,
  isNewRow: boolean
): GridCell["themeOverride"] | undefined {
  if (selected) {
    return {
      bgCell: "#dceeff",
      bgCellMedium: "#c7e4ff"
    };
  }
  if (pendingDelete) {
    return {
      bgCell: "#eceff3",
      bgCellMedium: "#dfe4ea"
    };
  }
  if (isNewRow) {
    return {
      bgCell: "#ebfaef",
      bgCellMedium: "#d5f3dc"
    };
  }
  return undefined;
}
