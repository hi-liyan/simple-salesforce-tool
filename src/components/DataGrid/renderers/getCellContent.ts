import { GridCell, GridCellKind, GridColumn, Item } from "@glideapps/glide-data-grid";
import { buildCellThemeOverride, buildRowThemeOverride } from "../logic/rowTheme";
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
  // 行键提取器：统一获取 recordId。
  getRecordKey: (rowIndex: number) => string;
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
  getRecordKey
}: CreateGetCellContentParams): (cell: Item) => GridCell {
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
        readonly: recordId.startsWith("row-"),
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
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    const isRequiredEmpty = requiredNewField && isEmptyValue(raw);

    const commonTheme = buildCellThemeOverride(isDirty, isRequiredEmpty, isPendingDeleteRow, isNewRowHighlight);

    if (strategy === "boolean") {
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

    if (strategy === "number") {
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

    if (strategy === "date") {
      const text = normalizeDateDisplayValue(raw);
      return {
        kind: GridCellKind.Text,
        // date 单元格展示与提交统一为 Salesforce 日期格式（YYYY-MM-DD）。
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (strategy === "datetime") {
      const text = normalizeDatetimeDisplayValue(raw, effectiveSalesforceTimezone);
      return {
        kind: GridCellKind.Text,
        // datetime 单元格展示为 Salesforce 日期时间格式（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (strategy === "picklist") {
      const options = getPicklistEditorOptions(metadata);
      const value = normalizePicklistValue(raw);
      const displayText = resolvePicklistDisplayText(value, options);
      return {
        kind: GridCellKind.Text,
        // picklist 单元格保留 value 作为真实值，提交时按 value/null 写回后端。
        data: value,
        // 单元格显示统一改为 label，满足数据库工具预期阅读体验。
        displayData: displayText,
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
}
