import { GridCell, GridCellKind, GridColumn, Item } from "@glideapps/glide-data-grid";
import { buildCellThemeOverride, buildRowThemeOverride } from "../logic/rowTheme";
import { isMysqlBlankValue, resolveMysqlDisplayValue } from "../../../features/main/QueryPanel/logic/mysqlValueSemantics.ts";
import {
  normalizeDateDisplayValue,
  normalizeDatetimeDisplayValue
} from "../utils/datetime";
import {
  isCellEditableByMeta,
  isRequiredOnCreate
} from "../utils/field";
import {
  getPicklistEditorOptions,
  normalizePicklistValue,
  resolvePicklistDisplayText
} from "../utils/picklist";
import {
  coerceNumber,
  getNullPlaceholderBySourceType,
  isEmptyValue,
  normalizeBooleanText,
  stringifyCellValue
} from "../utils/value";
import { resolveFieldTypeStrategy } from "../logic/fieldTypeStrategy";

type CreateGetCellContentParams = {
  // 列定义：用于将坐标列索引映射为字段名。
  columns: GridColumn[];
  // 行数据：来自 QueryResult.records。
  records: Record<string, unknown>[];
  // 字段元数据：用于推断类型、可编辑性与必填状态。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 已选中记录集合：用于首列 checkbox 回显。
  selectedRecordIds: string[];
  // 脏单元格集合：用于高亮显示。
  dirtyCellSet: Set<string>;
  // 待删除记录集合：用于整行灰色高亮。
  pendingDeleteRecordSet: Set<string>;
  // Salesforce 用户时区：用于 datetime 显示对齐。
  effectiveSalesforceTimezone: string | null;
  // 当前数据源类型：用于区分 Salesforce/MySQL 展示策略。
  selectedSourceType?: string;
  // 行键提取器：统一获取 recordId。
  getRecordKey: (rowIndex: number) => string;
  // 只读单元格是否允许双击打开 Overlay（仅查看不可编辑）。
  allowReadonlyOverlay?: boolean;
};

// 构建单元格读取函数：只负责“按坐标返回展示单元格”。
export function createGetCellContent({
  columns,
  records,
  fieldMetadataMap,
  selectedRecordIds,
  dirtyCellSet,
  pendingDeleteRecordSet,
  effectiveSalesforceTimezone,
  selectedSourceType,
  getRecordKey,
  allowReadonlyOverlay = false
}: CreateGetCellContentParams): (cell: Item) => GridCell {
  const isMysqlSource = (selectedSourceType || "salesforce").toLowerCase() === "mysql";
  const nullPlaceholderText = getNullPlaceholderBySourceType(selectedSourceType);
  return ([col, row]) => {
    const columnId = String(columns[col]?.id ?? "");
    const record = records[row] || {};
    const recordId = getRecordKey(row);
    const isNewRow = Boolean(record.__isNew);
    // 待删除行统一灰色高亮，便于用户识别“尚未提交删除”的记录。
    const isPendingDeleteRow = pendingDeleteRecordSet.has(recordId);
    // 新建行统一浅绿色高亮，便于用户识别“待提交新增”的记录。
    const isNewRowHighlight = isNewRow;
    // 行级样式：用于选择列/序号列等非业务字段单元格。
    const rowThemeOverride = buildRowThemeOverride(isPendingDeleteRow, isNewRowHighlight);

    if (columnId === "__select") {
      return {
        kind: GridCellKind.Boolean,
        data: selectedRecordIds.includes(recordId),
        allowOverlay: false,
        readonly: recordId.startsWith("row:"),
        // 行级高亮：确保选择列与数据列颜色一致。
        themeOverride: rowThemeOverride
      };
    }

    if (columnId === "__index") {
      const text = String(row + 1);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: false,
        readonly: true,
        // 行级高亮：确保序号列与数据列颜色一致。
        themeOverride: rowThemeOverride
      };
    }

    const metadata = fieldMetadataMap[columnId] || {};
    const strategy = resolveFieldTypeStrategy(metadata);
    const editable = isCellEditableByMeta(metadata, isNewRow);
    const requiredNewField = isRequiredOnCreate(metadata, isNewRow);
    const raw = record[columnId];
    const mysqlDisplayState = isMysqlSource
      ? resolveMysqlDisplayValue(raw, metadata)
      : { value: raw, useNullPlaceholder: raw === null || raw === undefined };
    const cellValue = mysqlDisplayState.value;
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    const isRequiredEmpty = requiredNewField && (isMysqlSource ? isMysqlBlankValue(raw) : isEmptyValue(raw));
    const isNullishValue = mysqlDisplayState.useNullPlaceholder;

    const commonTheme = buildCellThemeOverride(isDirty, isRequiredEmpty, isPendingDeleteRow, isNewRowHighlight);
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
      // MySQL 日期值直接展示标准字符串；Salesforce 继续按既有日期规范展示。
      const text = isMysqlSource ? stringifyCellValue(cellValue) : normalizeDateDisplayValue(cellValue);
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
      // MySQL datetime/timestamp 不做 Salesforce 时区偏移转换，避免跨时区误差。
      const text = isMysqlSource ? stringifyCellValue(cellValue) : normalizeDatetimeDisplayValue(cellValue, effectiveSalesforceTimezone);
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
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: isNullishValue ? nullPlaceholderText : text,
      allowOverlay: editable || allowReadonlyOverlay,
      readonly: !editable,
      themeOverride: commonTheme,
      style: nullPlaceholderStyle
    };
  };
}
