import { useMemo, useState } from "react";
import { Box, FormControl, Select, Tooltip, Typography } from "@mui/material";
import {
  CellClickedEventArgs,
  DataEditor,
  EditableGridCell,
  EditListItem,
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  TextCell
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
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
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
  onEditCell,
  onShowMessage
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
  // 当前激活单元格：用于 provideEditor 判断是否为 picklist 编辑。
  const [activeEditorCell, setActiveEditorCell] = useState<Item | null>(null);

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
    const isNewRow = Boolean(record.__isNew);

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

    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);
    const editable = isCellEditableByMeta(metadata, isNewRow);
    const requiredNewField = isRequiredOnCreate(metadata, isNewRow);
    const raw = record[columnId];
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    const isRequiredEmpty = requiredNewField && isEmptyValue(raw);

    const commonTheme = buildCellThemeOverride(isDirty, isRequiredEmpty);

    if (isBooleanType(fieldType)) {
      const text = normalizeBooleanText(raw);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (isNumberType(fieldType)) {
      const num = coerceNumber(raw);
      return {
        kind: GridCellKind.Number,
        data: num,
        displayData: raw === null || raw === undefined ? "" : String(raw),
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    const text = stringifyCellValue(raw);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: editable,
      readonly: !editable,
      themeOverride: commonTheme
    };
  };

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

    const record = records[row] || {};
    const isNewRow = Boolean(record.__isNew);
    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (isPicklistType(fieldType)) {
      const options = getPicklistOptions(metadata);
      const nextText = extractEditableString(newValue);
      if (!options.some((item) => item.value === nextText)) {
        onShowMessage(`${columnId} 字段只能选择预设选项。`);
        return;
      }
      onEditCell(row, columnId, nextText);
      return;
    }

    if (isBooleanType(fieldType)) {
      const text = extractEditableString(newValue).trim().toLowerCase();
      if (text !== "true" && text !== "false") {
        onShowMessage(`${columnId} 字段仅支持 true/false。`);
        return;
      }
      onEditCell(row, columnId, text === "true");
      return;
    }

    if (isNumberType(fieldType)) {
      const num = extractEditableNumber(newValue);
      if (num === undefined && extractEditableString(newValue).trim() !== "") {
        onShowMessage(`${columnId} 字段仅支持数字。`);
        return;
      }
      onEditCell(row, columnId, num);
      return;
    }

    onEditCell(row, columnId, extractEditableString(newValue));
  };

  const handleCellClicked = (cell: Item, event: CellClickedEventArgs) => {
    const [col, row] = cell;
    const columnId = String(columns[col]?.id ?? "");
    if (!event.isDoubleClick) return;
    if (!columnId || columnId.startsWith("__")) return;

    const record = records[row] || {};
    const isNewRow = Boolean(record.__isNew);
    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (isPicklistType(fieldType)) {
      const options = getPicklistOptions(metadata);
      if (options.length === 0) {
        onShowMessage(`${columnId} 字段未配置可选值。`);
      }
    }
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
          onCellActivated={(cell) => setActiveEditorCell(cell)}
          onCellEdited={handleCellEdited}
          onCellClicked={handleCellClicked}
          onCellsEdited={handleCellsEdited}
          // 使用 Glide 内置 overlay 机制渲染 picklist 编辑器，避免手工定位。
          provideEditor={(cell) => {
            if (!activeEditorCell) return undefined;
            if (cell.kind !== GridCellKind.Text) return undefined;

            const [col] = activeEditorCell;
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId || columnId.startsWith("__")) return undefined;

            const metadata = fieldMetadataMap[columnId] || {};
            const fieldType = getFieldType(metadata);
            let options: { label: string; value: string }[] = [];
            if (isPicklistType(fieldType)) {
              options = getPicklistOptions(metadata);
            } else if (isBooleanType(fieldType)) {
              options = [
                { label: "true", value: "true" },
                { label: "false", value: "false" }
              ];
            } else {
              return undefined;
            }
            if (options.length === 0) return undefined;

            return (props) => {
              const textValue = props.value as TextCell;
              return (
                <FormControl
                  size="small"
                  sx={{
                    position: "absolute",
                    left: props.target.x,
                    top: props.target.y,
                    width: Math.max(props.target.width, 180),
                    bgcolor: "background.paper"
                  }}
                >
                  <Select
                    autoFocus
                    native
                    value={normalizeSelectValue(textValue.data, options)}
                    onBlur={() => props.onFinishedEditing(undefined, [0, 0])}
                    onChange={(event) => {
                      const next = String(event.target.value);
                      const nextCell: TextCell = {
                        ...textValue,
                        data: next,
                        displayData: next
                      };
                      props.onChange(nextCell);
                      props.onFinishedEditing(nextCell, [0, 0]);
                    }}
                  >
                    {options.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </Select>
                </FormControl>
              );
            };
          }}
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

// 根据元数据计算单元格样式（脏数据高亮 + 必填缺失红色提示）。
function buildCellThemeOverride(isDirty: boolean, requiredMissing: boolean): GridCell["themeOverride"] | undefined {
  if (requiredMissing) {
    return {
      bgCell: "#ffeaea",
      bgCellMedium: "#ffd3d3"
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

// 元数据类型提取。
function getFieldType(metadata: Record<string, unknown>): string {
  const raw = metadata.type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

// 判断布尔字段类型。
function isBooleanType(fieldType: string): boolean {
  return fieldType === "boolean";
}

// 判断数字字段类型。
function isNumberType(fieldType: string): boolean {
  return ["int", "double", "currency", "percent", "long"].includes(fieldType);
}

// 判断 picklist 字段类型。
function isPicklistType(fieldType: string): boolean {
  return fieldType === "picklist";
}

// 判断字段是否可编辑。
function isCellEditableByMeta(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  const createable = metadata.createable;
  const updateable = metadata.updateable;
  if (isNewRow) {
    return createable !== false;
  }
  return updateable !== false;
}

// 判断新建记录时是否必填。
function isRequiredOnCreate(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  if (!isNewRow) return false;
  if (metadata.createable === false) return false;
  return metadata.nillable === false;
}

// picklist 可选值提取。
function getPicklistOptions(metadata: Record<string, unknown>): { label: string; value: string }[] {
  const raw = metadata.picklistValues;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const obj = item as Record<string, unknown>;
      const active = obj.active;
      if (active === false) return null;
      const value = String(obj.value ?? "");
      const label = String(obj.label ?? value);
      if (!value) return null;
      return { label, value };
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}

// 布尔值统一转换为编辑器可识别文本。
function normalizeBooleanText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") return normalized;
  }
  return "false";
}

// 归一化 Select 当前值，防止值不在选项里导致空白。
function normalizeSelectValue(raw: string, options: { label: string; value: string }[]): string {
  if (options.some((item) => item.value === raw)) return raw;
  return options[0]?.value ?? "";
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

// 将值转换为数字。
function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// 判断值是否为空。
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
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

// 抽取文本编辑值。
function extractEditableString(value: EditableGridCell): string {
  if (value.kind === GridCellKind.Text) return String(value.data ?? "");
  if (value.kind === GridCellKind.Number) return String(value.data ?? "");
  if (value.kind === GridCellKind.Boolean) return String(value.data ?? "");
  return String(value.data ?? "");
}

// 抽取数字编辑值。
function extractEditableNumber(value: EditableGridCell): number | undefined {
  if (value.kind === GridCellKind.Number) {
    return typeof value.data === "number" && Number.isFinite(value.data) ? value.data : undefined;
  }
  const text = extractEditableString(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
