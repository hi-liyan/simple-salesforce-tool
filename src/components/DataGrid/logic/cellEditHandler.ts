import {
  CellClickedEventArgs,
  EditableGridCell,
  GridCellKind,
  GridColumn,
  Item
} from "@glideapps/glide-data-grid";
import {
  normalizeDateValueForSave,
  normalizeDatetimeValueForSave
} from "../utils/datetime";
import {
  isCellEditableByMeta,
} from "../utils/field";
import {
  getPicklistEditorOptions,
  isPicklistNullable,
  PICKLIST_NONE_VALUE
} from "../utils/picklist";
import {
  extractEditableNumber,
  extractEditableString
} from "../utils/value";
import { resolveFieldTypeStrategy } from "./fieldTypeStrategy";

type CreateCellEditedHandlerParams = {
  // 列定义：用于定位当前编辑字段。
  columns: GridColumn[];
  // 行数据：用于判断是否新建行。
  records: Record<string, unknown>[];
  // 字段元数据：用于校验可编辑性与类型规则。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // Salesforce 用户时区：用于 datetime 保存时规范化。
  effectiveSalesforceTimezone: string | null;
  // 行键提取器：统一获取 recordId。
  getRecordKey: (rowIndex: number) => string;
  // 勾选状态回调。
  onToggleRecord: (recordId: string, checked: boolean) => void;
  // 单元格编辑回调。
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  // 用户提示回调。
  onShowMessage: (message: string) => void;
};

// 构建单点编辑处理器：按字段类型规则校验并提交编辑值。
export function createCellEditedHandler({
  columns,
  records,
  fieldMetadataMap,
  effectiveSalesforceTimezone,
  getRecordKey,
  onToggleRecord,
  onEditCell,
  onShowMessage
}: CreateCellEditedHandlerParams): (location: Item, newValue: EditableGridCell) => void {
  return ([col, row], newValue) => {
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
    const strategy = resolveFieldTypeStrategy(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (strategy === "picklist") {
      const options = getPicklistEditorOptions(metadata);
      const nextText = extractEditableString(newValue);
      if (!options.some((item) => item.value === nextText)) {
        onShowMessage(`${columnId} 字段只能选择预设选项。`);
        return;
      }
      if (nextText === PICKLIST_NONE_VALUE && isPicklistNullable(metadata)) {
        onEditCell(row, columnId, null);
        return;
      }
      onEditCell(row, columnId, nextText);
      return;
    }

    if (strategy === "date") {
      const nextText = extractEditableString(newValue).trim();
      if (!nextText) {
        if (metadata.nillable === true) {
          onEditCell(row, columnId, null);
          return;
        }
        onShowMessage(`${columnId} 字段不允许为空。`);
        return;
      }

      const normalizedDate = normalizeDateValueForSave(nextText);
      if (!normalizedDate) {
        onShowMessage(`${columnId} 字段仅支持日期格式（YYYY-MM-DD）。`);
        return;
      }

      onEditCell(row, columnId, normalizedDate);
      return;
    }

    if (strategy === "datetime") {
      const nextText = extractEditableString(newValue).trim();
      if (!nextText) {
        if (metadata.nillable === true) {
          onEditCell(row, columnId, null);
          return;
        }
        onShowMessage(`${columnId} 字段不允许为空。`);
        return;
      }

      const normalizedDatetime = normalizeDatetimeValueForSave(nextText, effectiveSalesforceTimezone);
      if (!normalizedDatetime) {
        onShowMessage(`${columnId} 字段仅支持日期时间格式。`);
        return;
      }

      onEditCell(row, columnId, normalizedDatetime);
      return;
    }

    if (strategy === "boolean") {
      const text = extractEditableString(newValue).trim().toLowerCase();
      if (text !== "true" && text !== "false") {
        onShowMessage(`${columnId} 字段仅支持 true/false。`);
        return;
      }
      onEditCell(row, columnId, text === "true");
      return;
    }

    if (strategy === "number") {
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
}

type CreateCellClickedHandlerParams = {
  // 列定义：用于定位当前点击字段。
  columns: GridColumn[];
  // 行数据：用于判断是否新建行。
  records: Record<string, unknown>[];
  // 字段元数据：用于提示只读或无选项场景。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 是否启用只读提示逻辑。
  enableReadonlyCellHint: boolean;
  // 用户提示回调。
  onShowMessage: (message: string) => void;
};

// 构建点击处理器：双击只读提示 + picklist 配置校验提示。
export function createCellClickedHandler({
  columns,
  records,
  fieldMetadataMap,
  enableReadonlyCellHint,
  onShowMessage
}: CreateCellClickedHandlerParams): (cell: Item, event: CellClickedEventArgs) => void {
  return (cell, event) => {
    if (!enableReadonlyCellHint) return;
    const [col, row] = cell;
    const columnId = String(columns[col]?.id ?? "");
    if (!event.isDoubleClick) return;
    if (!columnId || columnId.startsWith("__")) return;

    const record = records[row] || {};
    const isNewRow = Boolean(record.__isNew);
    const metadata = fieldMetadataMap[columnId] || {};
    const strategy = resolveFieldTypeStrategy(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (strategy === "picklist") {
      const options = getPicklistEditorOptions(metadata);
      if (options.length === 0) {
        onShowMessage(`${columnId} 字段未配置可选值。`);
      }
    }
  };
}
