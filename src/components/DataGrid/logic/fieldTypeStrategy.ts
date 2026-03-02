import {
  getFieldType,
  isBooleanType,
  isDateTimeType,
  isDateType,
  isNumberType,
  isPicklistType
} from "../utils/field";

// DataGrid 字段策略类型：统一映射不同字段到独立处理分支。
export type FieldTypeStrategy = "picklist" | "date" | "datetime" | "number" | "boolean" | "text";

// 根据字段元数据解析策略类型，供渲染/编辑/提交复用。
export function resolveFieldTypeStrategy(metadata: Record<string, unknown>): FieldTypeStrategy {
  const fieldType = getFieldType(metadata);
  if (isPicklistType(fieldType)) return "picklist";
  if (isDateType(fieldType)) return "date";
  if (isDateTimeType(fieldType)) return "datetime";
  if (isNumberType(fieldType)) return "number";
  if (isBooleanType(fieldType)) return "boolean";
  return "text";
}
