// 元数据类型提取。
export function getFieldType(metadata: Record<string, unknown>): string {
  const raw = metadata.type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

// 元数据列类型提取（MySQL columnType），用于识别 unsigned 等细分类型。
export function getColumnType(metadata: Record<string, unknown>): string {
  const raw = metadata.columnType;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

// 元数据 MySQL 数据类型提取：优先 mysqlDataType，其次回退通用 type。
export function getMysqlDataType(metadata: Record<string, unknown>): string {
  const rawMysqlDataType = metadata.mysqlDataType;
  if (typeof rawMysqlDataType === "string" && rawMysqlDataType.trim()) {
    return rawMysqlDataType.trim().toLowerCase();
  }
  const rawType = metadata.type;
  return typeof rawType === "string" ? rawType.toLowerCase() : "";
}

// 不允许在 DataGrid 中直接编辑的 MySQL 数据类型清单（空间/二进制等非常规文本类型）。
const NON_EDITABLE_MYSQL_DATA_TYPE_SET = new Set([
  "bit",
  "binary",
  "varbinary",
  "tinyblob",
  "blob",
  "mediumblob",
  "longblob",
  "geometry",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection"
]);

// 判断当前元数据是否来自 MySQL 字段。
function isMysqlFieldMetadata(metadata: Record<string, unknown>): boolean {
  return (
    typeof metadata.mysqlDataType === "string" ||
    typeof metadata.columnType === "string"
  );
}

// 判断是否属于前端禁改的 MySQL 类型。
export function isNonEditableMysqlType(metadata: Record<string, unknown>): boolean {
  if (!isMysqlFieldMetadata(metadata)) return false;
  return NON_EDITABLE_MYSQL_DATA_TYPE_SET.has(getMysqlDataType(metadata));
}

// 获取禁改 MySQL 类型文案（用于提示），无命中时返回空字符串。
export function getNonEditableMysqlTypeLabel(metadata: Record<string, unknown>): string {
  if (!isNonEditableMysqlType(metadata)) return "";
  const dataType = getMysqlDataType(metadata);
  const columnType = getColumnType(metadata);
  if (columnType) return columnType;
  return dataType;
}

// 判断布尔字段类型。
export function isBooleanType(fieldType: string): boolean {
  return fieldType === "boolean" || fieldType === "bool";
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
    "year",
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
  return fieldType === "datetime" || fieldType === "timestamp";
}

// 判断是否需要按文本处理的大整数类型：避免 JS number 精度丢失。
export function isPrecisionSensitiveIntegerType(metadata: Record<string, unknown>): boolean {
  const columnType = getColumnType(metadata);
  return columnType.startsWith("bigint") && columnType.includes("unsigned");
}

// 判断字段是否可编辑。
export function isCellEditableByMeta(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  // 空间类型/二进制类型在 DataGrid 中仅支持展示，不支持直接编辑。
  if (isNonEditableMysqlType(metadata)) return false;
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
