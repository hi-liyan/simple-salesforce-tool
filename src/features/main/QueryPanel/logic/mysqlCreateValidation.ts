import type { ObjectDescribe } from "../../../../types/index.ts";
import { isMysqlBlankValue } from "./mysqlValueSemantics.ts";

// MySQL 新增行必填字段缺失信息。
export type MysqlMissingRequiredFieldItem = {
  // 行号（从 1 开始，便于用户在表格里定位）。
  row: number;
  // 当前行缺失的字段名列表。
  fields: string[];
};

// 判断字段是否属于 MySQL 新建时必填：仅限 createable + NOT NULL + 无默认值 + 非自动生成。
function isMysqlRequiredFieldOnCreate(field: ObjectDescribe["fields"][number]): boolean {
  if (!field.createable || field.nillable) return false;
  const defaultValue = field.metadata?.columnDefault;
  if (defaultValue !== null && defaultValue !== undefined) return false;
  const extraText = String(field.metadata?.extra || "").toLowerCase();
  if (extraText.includes("auto_increment") || extraText.includes("generated")) return false;
  return true;
}

// 收集 MySQL 新增行中“NOT NULL 且无默认值”的缺失字段。
export function collectMysqlMissingRequiredFields(
  records: Record<string, unknown>[],
  describe: ObjectDescribe
): MysqlMissingRequiredFieldItem[] {
  const requiredFields = describe.fields.filter((field) => isMysqlRequiredFieldOnCreate(field));
  if (requiredFields.length === 0) return [];

  const missingItems: MysqlMissingRequiredFieldItem[] = [];
  records.forEach((record, rowIndex) => {
    if (!record.__isNew) return;
    const missingFieldNames = requiredFields
      .filter((field) => isMysqlBlankValue(record[field.name]))
      .map((field) => field.name);
    if (missingFieldNames.length > 0) {
      missingItems.push({ row: rowIndex + 1, fields: missingFieldNames });
    }
  });
  return missingItems;
}

// 判断当前 MySQL 新建行是否存在必填字段缺失。
export function hasMysqlMissingRequiredFields(
  records: Record<string, unknown>[],
  describe: ObjectDescribe | null | undefined
): boolean {
  if (!describe) return false;
  return collectMysqlMissingRequiredFields(records, describe).length > 0;
}
