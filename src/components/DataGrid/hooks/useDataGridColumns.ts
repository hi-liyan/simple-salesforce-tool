import { useMemo, useState } from "react";
import { GridColumn } from "@glideapps/glide-data-grid";

type UseDataGridColumnsParams = {
  // 当前可见字段列表。
  visibleColumns: string[];
  // 是否展示首列选择列。
  showSelectionColumn: boolean;
  // 当前记录列表：用于推导可选记录 Id。
  records: Record<string, unknown>[];
  // 当前已选记录 Id。
  selectedRecordIds: string[];
  // 字段元数据映射：MySQL 下用于识别主键列（columnKey=PRI）。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 当前数据源类型：用于按源类型切换记录 Id 提取策略。
  selectedSourceType?: string;
};

// DataGrid 列与勾选状态 Hook：统一管理列顺序、列宽和全选态。
export function useDataGridColumns({
  visibleColumns,
  showSelectionColumn,
  records,
  selectedRecordIds,
  fieldMetadataMap,
  selectedSourceType
}: UseDataGridColumnsParams) {
  // 列宽状态：支持用户拖拽后即时更新列宽。
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const displayColumns = useMemo(
    () => {
      // 列顺序规范：始终将 Id、Name 提前展示，其余字段保持原有顺序。
      const priority = ["Id", "Name"].filter((column) => visibleColumns.includes(column));
      const rest = visibleColumns.filter((column) => column !== "Id" && column !== "Name");
      return [...priority, ...rest];
    },
    [visibleColumns]
  );

  const columns = useMemo<GridColumn[]>(() => {
    const dataColumns: GridColumn[] = displayColumns.map((column) => ({
      id: column,
      // 数据列标题由 drawHeader 自定义双行绘制，这里留空避免默认文案覆盖。
      title: "",
      width: columnWidths[column] ?? (column === "Id" ? 280 : 180)
    }));

    return [
      ...(showSelectionColumn ? [{ id: "__select", title: "", width: columnWidths.__select ?? 44 }] : []),
      { id: "__index", title: "#", width: columnWidths.__index ?? 56 },
      ...dataColumns
    ];
  }, [displayColumns, columnWidths, showSelectionColumn]);

  // MySQL 主键列：用于缺失 Id 时的勾选回退键。
  const mysqlPrimaryKeyField = useMemo(() => {
    if ((selectedSourceType || "salesforce").toLowerCase() !== "mysql") return "";
    const field = Object.entries(fieldMetadataMap).find(
      ([, metadata]) => String(metadata?.columnKey || "").toUpperCase() === "PRI"
    )?.[0];
    return field || "";
  }, [fieldMetadataMap, selectedSourceType]);

  const selectableIds = useMemo(
    () =>
      records.map((item, index) => {
        const fromId = item.Id;
        if (fromId !== null && fromId !== undefined && String(fromId).trim() !== "") {
          return String(fromId);
        }
        if (mysqlPrimaryKeyField) {
          const fromPrimary = item[mysqlPrimaryKeyField];
          if (fromPrimary !== null && fromPrimary !== undefined && String(fromPrimary).trim() !== "") {
            return String(fromPrimary);
          }
        }
        return `row-${index}`;
      }),
    [records, mysqlPrimaryKeyField]
  );

  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedRecordIds.includes(id));
  const hasAnyChecked = selectedRecordIds.some((id) => selectableIds.includes(id));

  return {
    columns,
    columnWidths,
    setColumnWidths,
    allChecked,
    hasAnyChecked,
    selectableIds
  };
}
