import { GridCellKind } from "@glideapps/glide-data-grid";
import type { GridCell, GridColumn, Item } from "@glideapps/glide-data-grid";
import { buildCellThemeOverride, buildRowThemeOverride } from "../logic/rowTheme.ts";
import type { GridAdapter } from "../../../drivers/types.ts";
import {
  isCellEditableByMeta,
  isRequiredOnCreate
} from "../utils/field.ts";
import {
  getPicklistEditorOptions,
  normalizePicklistValue,
  resolvePicklistDisplayText
} from "../utils/picklist.ts";
import {
  coerceNumber,
  normalizeBooleanText,
  stringifyCellValue
} from "../utils/value.ts";
import { resolveFieldTypeStrategy } from "../logic/fieldTypeStrategy.ts";

type CreateGetCellContentParams = {
  // 列定义：用于将坐标列索引映射为字段名。
  columns: GridColumn[];
  // 行数据：来自 QueryResult.records。
  records: Record<string, unknown>[];
  // 字段元数据：用于推断类型、可编辑性与必填状态。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 已选中记录集合：用于整行高亮回显。
  selectedRecordSet: Set<string>;
  // 脏单元格集合：用于高亮显示。
  dirtyCellSet: Set<string>;
  // 待删除记录集合：用于整行灰色高亮。
  pendingDeleteRecordSet: Set<string>;
  // 展示与编辑时区：用于 datetime 显示对齐。
  effectiveTimezone: string | null;
  // 数据源表格适配器：用于区分展示策略。
  gridAdapter: GridAdapter;
  // 行键提取器：统一获取 recordId。
  getRecordKey: (rowIndex: number) => string;
  // 当前分页偏移量：用于把序号列渲染为跨页连续编号。
  currentOffset?: number;
  // 只读单元格是否允许双击打开 Overlay（仅查看不可编辑）。
  allowReadonlyOverlay?: boolean;
};

// 构建单元格读取函数：只负责“按坐标返回展示单元格”。
export function createGetCellContent({
  columns,
  records,
  fieldMetadataMap,
  selectedRecordSet,
  dirtyCellSet,
  pendingDeleteRecordSet,
  effectiveTimezone,
  gridAdapter,
  getRecordKey,
  currentOffset = 0,
  allowReadonlyOverlay = false
}: CreateGetCellContentParams): (cell: Item) => GridCell {
  const nullPlaceholderText = gridAdapter.nullPlaceholder;
  return ([col, row]) => {
    const columnId = String(columns[col]?.id ?? "");
    const record = records[row] || {};
    const recordId = getRecordKey(row);
    const isNewRow = Boolean(record.__isNew);
    const isSelectedRow = selectedRecordSet.has(recordId);
    // 待删除行统一灰色高亮，便于用户识别“尚未提交删除”的记录。
    const isPendingDeleteRow = pendingDeleteRecordSet.has(recordId);
    // 新建行统一浅绿色高亮，便于用户识别“待提交新增”的记录。
    const isNewRowHighlight = isNewRow;
    // 行级样式：用于选择列/序号列等非业务字段单元格。
    const rowThemeOverride = buildRowThemeOverride(isSelectedRow, isPendingDeleteRow, isNewRowHighlight);

    if (columnId === "__index") {
      const text = String(Math.max(0, Math.floor(currentOffset || 0)) + row + 1);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: false,
        readonly: true,
        contentAlign: "center",
        // 行级高亮：确保序号列与数据列颜色一致。
        themeOverride: rowThemeOverride
      };
    }

    const metadata = fieldMetadataMap[columnId] || {};
    const strategy = gridAdapter.resolveFieldStrategy(metadata);
    const editable = isCellEditableByMeta(metadata, isNewRow);
    const requiredNewField = isRequiredOnCreate(metadata, isNewRow);
    const raw = record[columnId];
    const displayState = gridAdapter.resolveDisplayValue(raw, metadata);
    const cellValue = displayState.value;
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    const isRequiredEmpty = requiredNewField && gridAdapter.isBlankValue(raw);
    const isNullishValue = displayState.useNullPlaceholder;

    const commonTheme = buildCellThemeOverride(
      isDirty,
      isRequiredEmpty,
      isSelectedRow,
      isPendingDeleteRow,
      isNewRowHighlight
    );
    // 空值仅在展示态使用淡化样式，避免把编辑器里的输入文字也渲染成灰色。
    const nullPlaceholderStyle: "normal" | "faded" = isNullishValue ? "faded" : "normal";

    if (strategy === "boolean") {
      // 空值仅显示占位，不把 None/Null 作为真实编辑值写入编辑器。
      const text = isNullishValue ? "" : normalizeBooleanText(cellValue);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: isNullishValue ? nullPlaceholderText : text,
        allowOverlay: editable || allowReadonlyOverlay,
        readonly: !editable,
        themeOverride: commonTheme,
        style: nullPlaceholderStyle
      };
    }

    if (strategy === "number") {
      const num = coerceNumber(cellValue);
      return {
        kind: GridCellKind.Number,
        data: num,
        // 数值列优先使用归一化后的数字文本，避免 tinyint 等字段被显示为 true/false。
        displayData: isNullishValue ? nullPlaceholderText : num === undefined ? String(cellValue) : String(num),
        allowOverlay: editable || allowReadonlyOverlay,
        readonly: !editable,
        themeOverride: commonTheme,
        style: nullPlaceholderStyle
      };
    }

    if (strategy === "date") {
      // 按数据源适配器格式化日期展示值。
      const text = gridAdapter.formatDateDisplay(cellValue);
      return {
        kind: GridCellKind.Text,
        // date 单元格展示与提交统一为 Salesforce 日期格式（YYYY-MM-DD）。
        data: text,
        displayData: isNullishValue ? nullPlaceholderText : text,
        allowOverlay: editable || allowReadonlyOverlay,
        readonly: !editable,
        themeOverride: commonTheme,
        style: nullPlaceholderStyle
      };
    }

    if (strategy === "datetime") {
      // 按数据源适配器格式化日期时间展示值。
      const text = gridAdapter.formatDatetimeDisplay(cellValue, effectiveTimezone);
      return {
        kind: GridCellKind.Text,
        // datetime 单元格展示为 Salesforce 日期时间格式（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
        data: text,
        displayData: isNullishValue ? nullPlaceholderText : text,
        allowOverlay: editable || allowReadonlyOverlay,
        readonly: !editable,
        themeOverride: commonTheme,
        style: nullPlaceholderStyle
      };
    }

    if (strategy === "picklist") {
      const options = getPicklistEditorOptions(metadata);
      const value = normalizePicklistValue(cellValue);
      const displayText = resolvePicklistDisplayText(value, options);
      return {
        kind: GridCellKind.Text,
        // picklist 单元格保留 value 作为真实值，提交时按 value/null 写回后端。
        data: value,
        // 单元格显示统一改为 label，满足数据库工具预期阅读体验。
        displayData: isNullishValue ? nullPlaceholderText : displayText,
        allowOverlay: editable || allowReadonlyOverlay,
        readonly: !editable,
        themeOverride: commonTheme,
        style: nullPlaceholderStyle
      };
    }

    const text = stringifyCellValue(cellValue);
    const truncatedTotal = (record.__truncatedFields as Record<string, unknown> | undefined)?.[columnId];
    const isTruncatedLargeField = typeof truncatedTotal === "number";
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: isNullishValue
        ? nullPlaceholderText
        : isTruncatedLargeField
          ? `[大字段 ${(truncatedTotal / 1024).toFixed(1)}K · 双击查看] ${text.slice(0, 120)}`
          : text,
      allowOverlay: isTruncatedLargeField ? false : (editable || allowReadonlyOverlay),
      readonly: isTruncatedLargeField ? true : !editable,
      themeOverride: commonTheme,
      style: nullPlaceholderStyle
    };
  };
}
