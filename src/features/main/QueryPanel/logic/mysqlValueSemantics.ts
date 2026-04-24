import type { MysqlCellDraftValue } from "../../../../types/index.ts";

// MySQL draft 标记键：用于在运行时识别显式值语义对象。
const MYSQL_DRAFT_MARKER = "__mysqlDraft";

// 创建“省略字段”语义：提交时不写入该列，让数据库走默认值或保持未改。
export function createMysqlDraftOmitValue(): MysqlCellDraftValue {
  return {
    [MYSQL_DRAFT_MARKER]: true,
    kind: "omit"
  };
}

// 创建“写入 NULL”语义：用于 Set Null 或可空字段清空。
export function createMysqlDraftNullValue(): MysqlCellDraftValue {
  return {
    [MYSQL_DRAFT_MARKER]: true,
    kind: "null"
  };
}

// 创建“写入具体值”语义：包括空字符串、0、false 等显式值。
export function createMysqlDraftValue(value: unknown): MysqlCellDraftValue {
  return {
    [MYSQL_DRAFT_MARKER]: true,
    kind: "value",
    value
  };
}

// 判断任意输入是否为 MySQL draft 对象。
export function isMysqlCellDraftValue(value: unknown): value is MysqlCellDraftValue {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return candidate[MYSQL_DRAFT_MARKER] === true && ["omit", "null", "value"].includes(String(candidate.kind || ""));
}

// 归一化编辑输入：把裸值统一包装成显式 MySQL draft 语义。
export function normalizeMysqlEditedCellValue(value: unknown): MysqlCellDraftValue {
  if (isMysqlCellDraftValue(value)) return value;
  if (value === null) return createMysqlDraftNullValue();
  if (value === undefined) return createMysqlDraftOmitValue();
  return createMysqlDraftValue(value);
}

// 判断当前 draft 是否表示“省略字段”。
export function isMysqlDraftOmitValue(value: unknown): boolean {
  return isMysqlCellDraftValue(value) && value.kind === "omit";
}

// 解析 draft 为运行时真实值：供展示、定位和提交时统一消费。
export function resolveMysqlDraftRuntimeValue(value: unknown): unknown {
  if (!isMysqlCellDraftValue(value)) return value;
  if (value.kind === "omit") return undefined;
  if (value.kind === "null") return null;
  return value.value;
}

// 判断值是否应按“空白输入”处理：用于必填校验与空值高亮。
export function isMysqlBlankValue(value: unknown): boolean {
  if (isMysqlCellDraftValue(value)) {
    if (value.kind === "omit" || value.kind === "null") return true;
    return isMysqlBlankValue(value.value);
  }
  if (value === null || value === undefined) return true;
  if (typeof value === "string") return value.trim() === "";
  return false;
}

// 解析单元格展示值与空值占位状态：避免 draft 对象直接显示为 [object Object]。
export function resolveMysqlDisplayValue(value: unknown): { value: unknown; useNullPlaceholder: boolean } {
  if (isMysqlCellDraftValue(value)) {
    if (value.kind === "omit") {
      return { value: "", useNullPlaceholder: false };
    }
    if (value.kind === "null") {
      return { value: null, useNullPlaceholder: true };
    }
    return {
      value: value.value,
      useNullPlaceholder: value.value === null || value.value === undefined
    };
  }
  return {
    value,
    useNullPlaceholder: value === null || value === undefined
  };
}

// 生成可比较的稳定 token：显式区分 null、undefined、空字符串、0、false。
function stringifyMysqlComparableValue(value: unknown): string {
  if (isMysqlCellDraftValue(value)) {
    if (value.kind === "omit") return "draft:omit";
    if (value.kind === "null") return "draft:null";
    return `draft:value:${stringifyMysqlComparableValue(value.value)}`;
  }
  if (value === undefined) return "raw:undefined";
  if (value === null) return "raw:null";
  if (typeof value === "string") return `raw:string:${value}`;
  if (typeof value === "number") return `raw:number:${Number.isNaN(value) ? "NaN" : value}`;
  if (typeof value === "boolean") return `raw:boolean:${value}`;
  if (typeof value === "bigint") return `raw:bigint:${value.toString()}`;
  try {
    return `raw:json:${JSON.stringify(value)}`;
  } catch {
    return `raw:text:${String(value)}`;
  }
}

// 判断基线值与当前值是否发生语义变化。
export function isMysqlDraftDirty(baselineValue: unknown, currentValue: unknown): boolean {
  return stringifyMysqlComparableValue(baselineValue) !== stringifyMysqlComparableValue(currentValue);
}
