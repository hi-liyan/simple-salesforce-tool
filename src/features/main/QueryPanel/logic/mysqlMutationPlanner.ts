import {
  isMysqlCellDraftValue,
  resolveMysqlDraftRuntimeValue
} from "./mysqlValueSemantics.ts";

type BuildMysqlMutationValuesInput = {
  // 当前行记录：可能包含 MySQL draft 值。
  record: Record<string, unknown>;
  // 当前允许写入的字段集合。
  editableFields: Set<string>;
  // 更新场景下的脏字段列表；为空时表示按整行扫描。
  dirtyFields?: string[];
};

// 判断字段是否为内部运行时字段。
function isInternalField(fieldName: string): boolean {
  return fieldName.startsWith("__") || fieldName === "Id";
}

// 将单个字段值转换成提交语义：omit=跳过，null/value=保留到 payload。
function resolveMysqlMutationEntry(rawValue: unknown): { include: boolean; value?: unknown } {
  if (isMysqlCellDraftValue(rawValue) && rawValue.kind === "omit") {
    return { include: false };
  }
  const runtimeValue = resolveMysqlDraftRuntimeValue(rawValue);
  if (runtimeValue === undefined) {
    return { include: false };
  }
  return {
    include: true,
    value: runtimeValue
  };
}

// 构建 MySQL 新增 payload：保留 null/空字符串/0/false，省略 omit/undefined。
export function buildMysqlCreateValues({
  record,
  editableFields
}: BuildMysqlMutationValuesInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  Object.entries(record).forEach(([fieldName, rawValue]) => {
    if (isInternalField(fieldName) || !editableFields.has(fieldName)) return;
    const entry = resolveMysqlMutationEntry(rawValue);
    if (!entry.include) return;
    values[fieldName] = entry.value;
  });
  return values;
}

// 构建 MySQL 更新 payload：仅消费脏字段，并保留显式 null/value 语义。
export function buildMysqlUpdateValues({
  record,
  editableFields,
  dirtyFields = []
}: BuildMysqlMutationValuesInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  dirtyFields.forEach((fieldName) => {
    if (isInternalField(fieldName) || !editableFields.has(fieldName)) return;
    const entry = resolveMysqlMutationEntry(record[fieldName]);
    if (!entry.include) return;
    values[fieldName] = entry.value;
  });
  return values;
}
