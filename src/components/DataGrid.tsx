import { useMemo, useState } from "react";
import { Box, Tooltip, Typography } from "@mui/material";
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
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  dirtyCellKeys: string[];
  selectedRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: string) => void;
};

// 查询结果表：使用 Glide Data Grid 提供更接近数据库客户端的表格体验。
export function DataGrid({
  result,
  visibleColumns,
  fieldMetadataMap,
  dirtyCellKeys,
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
  const hasAnyChecked = selectedRecordIds.some((id) => selectableIds.includes(id));
  const dirtyCellSet = useMemo(() => new Set(dirtyCellKeys), [dirtyCellKeys]);

  // 列宽状态：支持用户拖拽后即时更新列宽。
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  // 表头悬浮信息：用于展示字段全部元数据。
  const [hoveredHeaderMeta, setHoveredHeaderMeta] = useState<{
    fieldName: string;
    bounds: { x: number; y: number; width: number; height: number };
    metadata: Record<string, unknown>;
  } | null>(null);

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
      // 空状态容器。
      <Box sx={{ p: 2 }}>
        {/* 空状态提示。 */}
        <Typography variant="caption" color="text.secondary">
          暂无查询结果。
        </Typography>
      </Box>
    );
  }

  const getRecordKey = (rowIndex: number): string => {
    const record = records[rowIndex] || {};
    if (record.__localId) return String(record.__localId);
    if (record.Id) return String(record.Id);
    return `row-${rowIndex}`;
  };

  const getCellContent = ([col, row]: Item): GridCell => {
    const columnId = String(columns[col]?.id ?? "");
    const record = records[row] || {};
    const recordId = getRecordKey(row);

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
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: true,
      readonly: false,
      themeOverride: isDirty
        ? {
            bgCell: "#fff6d9",
            bgCellMedium: "#ffe9a8"
          }
        : undefined
    };
  };

  // 双击单元格进入编辑，编辑结果会回写到当前 Tab 的表格数据状态。
  const handleCellEdited = ([col, row]: Item, newValue: EditableGridCell) => {
    const columnId = String(columns[col]?.id ?? "");

    if (columnId === "__select" && newValue.kind === GridCellKind.Boolean) {
      const recordId = getRecordKey(row);
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

  const tooltipAnchorRect = hoveredHeaderMeta
    ? new DOMRect(
        hoveredHeaderMeta.bounds.x,
        hoveredHeaderMeta.bounds.y + hoveredHeaderMeta.bounds.height,
        hoveredHeaderMeta.bounds.width,
        1
      )
    : new DOMRect(0, 0, 1, 1);

  return (
    // 表格容器：顶部统计栏 + 数据表格。
    <Box sx={{ height: "100%", display: "flex", flexDirection: "column", minHeight: 0, position: "relative" }}>
      {/* 顶部工具栏：仅显示统计。 */}
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
        {/* 统计信息。 */}
        <Typography variant="caption" color="text.secondary">
          Rows: {result.totalSize}
        </Typography>
      </Box>

      {/* 数据表格主体。 */}
      <Box sx={{ flex: 1, minHeight: 0 }}>
        {/* Glide Data Grid 组件。 */}
        <DataEditor
          columns={columns}
          rows={records.length}
          getCellContent={getCellContent}
          onCellEdited={handleCellEdited}
          onCellsEdited={handleCellsEdited}
          // 自定义首列表头复选框样式，使其与行内复选框视觉一致。
          drawHeader={(args, drawContent) => {
            drawContent();
            if (String(args.column.id) !== "__select") return;

            const { ctx, rect } = args;
            const size = 14;
            const x = rect.x + Math.floor((rect.width - size) / 2);
            const y = rect.y + Math.floor((rect.height - size) / 2);
            const radius = 2;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + size - radius, y);
            ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
            ctx.lineTo(x + size, y + size - radius);
            ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
            ctx.lineTo(x + radius, y + size);
            ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fillStyle = allChecked || hasAnyChecked ? "#0176d3" : "#ffffff";
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = allChecked || hasAnyChecked ? "#0176d3" : "#98a4b4";
            ctx.stroke();

            if (allChecked) {
              ctx.beginPath();
              ctx.moveTo(x + 3, y + 7);
              ctx.lineTo(x + 6, y + 10);
              ctx.lineTo(x + 11, y + 4);
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.stroke();
            } else if (hasAnyChecked) {
              ctx.beginPath();
              ctx.moveTo(x + 3, y + 7);
              ctx.lineTo(x + 11, y + 7);
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.lineCap = "round";
              ctx.stroke();
            }

            ctx.restore();
          }}
          // 点击首列表头可切换全选状态。
          onHeaderClicked={(col) => {
            if (col !== 0) return;
            onToggleAll(!allChecked, selectableIds);
          }}
          // 监听鼠标移动，鼠标位于字段表头时显示元数据提示。
          onMouseMove={(args) => {
            if (args.kind !== "header") {
              if (hoveredHeaderMeta) setHoveredHeaderMeta(null);
              return;
            }

            const columnId = String(columns[args.location[0]]?.id ?? "");
            if (!columnId || columnId.startsWith("__")) {
              if (hoveredHeaderMeta) setHoveredHeaderMeta(null);
              return;
            }

            const metadata = fieldMetadataMap[columnId];
            if (!metadata) {
              if (hoveredHeaderMeta) setHoveredHeaderMeta(null);
              return;
            }

            if (hoveredHeaderMeta && hoveredHeaderMeta.fieldName === columnId) {
              return;
            }

            setHoveredHeaderMeta({
              fieldName: columnId,
              bounds: {
                x: args.bounds.x,
                y: args.bounds.y,
                width: args.bounds.width,
                height: args.bounds.height
              },
              metadata
            });
          }}
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

      {/* 表头字段元数据提示：使用 Tooltip 展示字段完整元数据（中文）。 */}
      {hoveredHeaderMeta && (
        <Tooltip
          open
          placement="bottom-start"
          arrow
          title={
            <Box sx={{ maxWidth: 560, minWidth: 340 }}>
              <Typography variant="caption" sx={{ display: "block", mb: 0.75, color: "inherit", fontWeight: 700 }}>
                {hoveredHeaderMeta.fieldName} 字段元数据
              </Typography>
              <Box sx={{ maxHeight: 320, overflow: "auto", pr: 0.5 }}>
                {Object.entries(hoveredHeaderMeta.metadata).map(([key, value]) => (
                  <Typography
                    key={key}
                    variant="caption"
                    sx={{
                      display: "block",
                      lineHeight: 1.5,
                      fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace"
                    }}
                  >
                    {translateFieldMetaKey(key)}: {formatFieldMetaValue(value)}
                  </Typography>
                ))}
              </Box>
            </Box>
          }
          slotProps={{
            tooltip: {
              sx: {
                bgcolor: "#223047",
                border: "1px solid #3a557f",
                maxWidth: "none"
              }
            },
            popper: {
              anchorEl: {
                getBoundingClientRect: () => tooltipAnchorRect
              }
            }
          }}
        >
          <Box
            sx={{
              position: "absolute",
              left: hoveredHeaderMeta.bounds.x,
              top: hoveredHeaderMeta.bounds.y + hoveredHeaderMeta.bounds.height,
              width: 1,
              height: 1,
              pointerEvents: "none"
            }}
          />
        </Tooltip>
      )}
    </Box>
  );
}

// 字段元数据键名中文映射。
function translateFieldMetaKey(key: string): string {
  const map: Record<string, string> = {
    name: "API 名称",
    label: "标签",
    type: "字段类型",
    nillable: "可为空",
    createable: "可创建",
    updateable: "可更新",
    defaultedOnCreate: "创建时默认值",
    calculated: "是否公式字段",
    calculatedFormula: "公式表达式",
    length: "长度",
    precision: "精度",
    scale: "小数位",
    unique: "是否唯一",
    externalId: "外部 ID",
    filterable: "可筛选",
    sortable: "可排序",
    groupable: "可分组",
    referenceTo: "引用对象",
    relationshipName: "关系名称",
    byteLength: "字节长度",
    inlineHelpText: "帮助文本",
    defaultValue: "默认值",
    defaultValueFormula: "默认值公式",
    picklistValues: "选项列表"
  };
  return map[key] || key;
}

// 字段元数据值格式化。
function formatFieldMetaValue(value: unknown): string {
  if (typeof value === "boolean") {
    return value ? "是" : "否";
  }
  if (Array.isArray(value)) {
    return value.length === 0 ? "[]" : JSON.stringify(value);
  }
  if (value && typeof value === "object") {
    return JSON.stringify(value);
  }
  if (value === null || value === undefined || value === "") {
    return "-";
  }
  return String(value);
}

// 将单元格值转为显示字符串。
function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}

// 抽取可编辑值。
function extractEditableValue(value: EditableGridCell): string {
  if (value.kind === GridCellKind.Text) return String(value.data ?? "");
  if (value.kind === GridCellKind.Number) return String(value.data ?? "");
  if (value.kind === GridCellKind.Boolean) return String(value.data ?? "");
  return String(value.data ?? "");
}
