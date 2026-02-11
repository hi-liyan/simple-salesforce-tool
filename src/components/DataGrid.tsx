import { useMemo, useState } from "react";
import { Box, Checkbox, Typography } from "@mui/material";
import {
  DataEditor,
  EditableGridCell,
  EditListItem,
  GridCell,
  GridCellKind,
  GridColumn,
  Item
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { QueryResult } from "../types";

type Props = {
  result: QueryResult;
  visibleColumns: string[];
  selectedRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: string) => void;
};

// 查询结果表：使用 Glide Data Grid 提供更接近数据库客户端的表格体验。
export function DataGrid({
  result,
  visibleColumns,
  selectedRecordIds,
  onToggleRecord,
  onToggleAll,
  onEditCell
}: Props) {
  const records = result.records;

  const displayColumns = useMemo(
    () =>
      visibleColumns.includes("Id")
        ? ["Id", ...visibleColumns.filter((column) => column !== "Id")]
        : visibleColumns,
    [visibleColumns]
  );

  const selectableIds = useMemo(
    () =>
      records
        .map((item, index) => String(item.Id || `row-${index}`))
        .filter((id) => !id.startsWith("row-")),
    [records]
  );

  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedRecordIds.includes(id));

  // 列宽状态：支持用户拖拽后即时更新列宽。
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const columns = useMemo<GridColumn[]>(() => {
    const dataColumns: GridColumn[] = displayColumns.map((column) => ({
      id: column,
      title: column,
      width: columnWidths[column] ?? (column === "Id" ? 280 : 180)
    }));

    return [
      { id: "__select", title: "", width: columnWidths.__select ?? 44 },
      { id: "__index", title: "#", width: columnWidths.__index ?? 56 },
      ...dataColumns
    ];
  }, [displayColumns, columnWidths]);

  if (records.length === 0) {
    return (
      <Box sx={{ p: 2 }}>
        <Typography variant="caption" color="text.secondary">
          暂无查询结果。
        </Typography>
      </Box>
    );
  }

  const getRecordId = (rowIndex: number): string => String(records[rowIndex]?.Id || `row-${rowIndex}`);

  const getCellContent = ([col, row]: Item): GridCell => {
    const columnId = String(columns[col]?.id ?? "");
    const record = records[row] || {};
    const recordId = getRecordId(row);

    if (columnId === "__select") {
      return {
        kind: GridCellKind.Boolean,
        data: selectedRecordIds.includes(recordId),
        allowOverlay: false,
        readonly: recordId.startsWith("row-")
      };
    }

    if (columnId === "__index") {
      const text = String(row + 1);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: false,
        readonly: true
      };
    }

    const text = stringifyCellValue(record[columnId]);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: true,
      readonly: false
    };
  };

  // 双击单元格进入编辑，编辑结果会回写到当前 Tab 的表格数据状态。
  const handleCellEdited = ([col, row]: Item, newValue: EditableGridCell) => {
    const columnId = String(columns[col]?.id ?? "");

    if (columnId === "__select" && newValue.kind === GridCellKind.Boolean) {
      const recordId = getRecordId(row);
      if (!recordId.startsWith("row-")) {
        onToggleRecord(recordId, Boolean(newValue.data));
      }
      return;
    }

    if (columnId === "__index" || columnId.startsWith("__")) {
      return;
    }

    const nextValue = extractEditableValue(newValue);
    onEditCell(row, columnId, nextValue);
  };

  const handleCellsEdited = (newValues: readonly EditListItem[]) => {
    newValues.forEach((item) => handleCellEdited(item.location, item.value));
  };

  return (
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0 }}>
      <Box
        sx={{
          px: 1.5,
          py: 0.5,
          borderBottom: "1px solid",
          borderColor: "divider",
          display: "flex",
          alignItems: "center",
          gap: 1.2
        }}
      >
        <Checkbox size="small" checked={allChecked} onChange={(event) => onToggleAll(event.target.checked, selectableIds)} />
        <Typography variant="caption" color="text.secondary">
          Rows: {result.totalSize}
        </Typography>
      </Box>

      <Box sx={{ flex: 1, minHeight: 0 }}>
        <DataEditor
          columns={columns}
          rows={records.length}
          getCellContent={getCellContent}
          onCellEdited={handleCellEdited}
          onCellsEdited={handleCellsEdited}
          cellActivationBehavior="double-click"
          onColumnResize={(column, newSize) => {
            const id = String(column.id ?? "");
            if (!id) return;
            setColumnWidths((current) => ({ ...current, [id]: Math.max(44, Math.floor(newSize)) }));
          }}
          minColumnWidth={44}
          maxColumnWidth={900}
          rowHeight={30}
          headerHeight={30}
          smoothScrollX
          smoothScrollY
          width="100%"
          height="100%"
          getCellsForSelection
        />
      </Box>
    </Box>
  );
}

function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);

  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function extractEditableValue(value: EditableGridCell): string {
  switch (value.kind) {
    case GridCellKind.Text:
    case GridCellKind.Uri:
    case GridCellKind.Markdown:
      return String(value.data ?? "");
    case GridCellKind.Number:
      return value.data === undefined || value.data === null ? "" : String(value.data);
    case GridCellKind.Boolean:
      return String(Boolean(value.data));
    default:
      return "";
  }
}
