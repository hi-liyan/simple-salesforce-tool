// 元数据类型提取。
export function getFieldType(metadata: Record<string, unknown>): string {
  const raw = metadata.type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

// 判断布尔字段类型。
export function isBooleanType(fieldType: string): boolean {
  return fieldType === "boolean";
}

// 判断数字字段类型。
export function isNumberType(fieldType: string): boolean {
  // 兼容 Salesforce 与 MySQL 常见数值类型。
  return [
    "int",
    "integer",
    "tinyint",
    "smallint",
    "mediumint",
    "bigint",
    "float",
    "double",
    "decimal",
    "numeric",
    "real",
    "currency",
    "percent",
    "long"
  ].includes(fieldType);
}

// 判断 picklist 字段类型。
export function isPicklistType(fieldType: string): boolean {
  return fieldType === "picklist";
}

// 判断 date 字段类型。
export function isDateType(fieldType: string): boolean {
  return fieldType === "date";
}

// 判断 datetime 字段类型。
export function isDateTimeType(fieldType: string): boolean {
  return fieldType === "datetime";
}

// 判断字段是否可编辑。
export function isCellEditableByMeta(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  const createable = metadata.createable;
  const updateable = metadata.updateable;
  if (isNewRow) {
    return createable !== false;
  }
  return updateable !== false;
}

// 判断新建记录时是否必填。
export function isRequiredOnCreate(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  if (!isNewRow) return false;
  if (metadata.createable === false) return false;
  // 创建时后端会自动填默认值的字段，不应再按“必填缺失”标红。
  if (metadata.defaultedOnCreate === true) return false;
  return metadata.nillable === false;
}
