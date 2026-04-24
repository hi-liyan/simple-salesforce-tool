import {
  isMysqlCellDraftValue,
  resolveMysqlDraftRuntimeValue
} from "./mysqlValueSemantics.ts";
import type {
  MutationPreviewField,
  MutationPreviewItem,
  MutationPreviewSqlItem,
  RecordUpdatePayload
} from "../../../../types/index.ts";
import { getRecordKey, type RecordKeyOptions } from "./queryUtils.ts";

type BuildMysqlMutationValuesInput = {
  // 当前行记录：可能包含 MySQL draft 值。
  record: Record<string, unknown>;
  // 当前允许写入的字段集合。
  editableFields: Set<string>;
  // 更新场景下的脏字段列表；为空时表示按整行扫描。
  dirtyFields?: string[];
};

type BuildMysqlMutationPlanInput = {
  // 当前表格记录：可能包含新行、旧行以及 MySQL draft 值。
  records: Record<string, unknown>[];
  // 基线快照：用于 update/delete 仍按旧主键定位。
  baselineRecords: Record<string, Record<string, unknown>>;
  // 脏单元格集合：用于提取 update 字段清单。
  dirtyCellKeys: string[];
  // 待删除稳定行 ID 集合。
  pendingDeleteRecordIds: string[];
  // 当前允许写入的字段集合。
  editableFields: Set<string>;
  // 当前数据源类型。
  sourceType?: string;
  // MySQL 主键字段名。
  mysqlPrimaryKeyField?: string;
};

// 统一的 MySQL 变更计划：供“提交前预览”和“真正执行”共享。
export type MysqlMutationPlan = {
  // 新增 payload。
  creates: Record<string, unknown>[];
  // 更新 payload。
  updates: RecordUpdatePayload[];
  // 删除定位值列表。
  deletes: string[];
  // 结构化预览项。
  previewItems: MutationPreviewItem[];
  // 缺少记录定位值的行号。
  missingRecordIdRows: number[];
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
  if (isMysqlCellDraftValue(rawValue) && rawValue.kind === "default") {
    return { include: true, value: rawValue };
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

// 解析记录定位值：优先使用基线主键，避免用户编辑当前主键后破坏 update/delete 定位。
function resolveMysqlRecordLocator(
  baselineRecord: Record<string, unknown> | undefined,
  record: Record<string, unknown>,
  options: RecordKeyOptions
): string {
  const recordIdRaw = baselineRecord?.Id
    ?? (options.sourceType?.toLowerCase() === "mysql" && options.mysqlPrimaryKeyField
      ? baselineRecord?.[options.mysqlPrimaryKeyField]
      : undefined)
    ?? resolveMysqlDraftRuntimeValue(record.Id)
    ?? (options.sourceType?.toLowerCase() === "mysql" && options.mysqlPrimaryKeyField
      ? resolveMysqlDraftRuntimeValue(record[options.mysqlPrimaryKeyField])
      : undefined);
  if (recordIdRaw === null || recordIdRaw === undefined) return "";
  return String(recordIdRaw).trim();
}

// 把最终提交值映射为预览字段摘要，供前端弹窗展示“哪些字段会写入 NULL/具体值”。
function buildMutationPreviewFields(values: Record<string, unknown>): MutationPreviewField[] {
  return Object.entries(values).map(([name, value]) => ({
    name,
    kind: isMysqlCellDraftValue(value) && value.kind === "default"
      ? "default"
      : value === null
        ? "null"
        : "value",
    value: isMysqlCellDraftValue(value) && value.kind === "default" ? "DEFAULT" : value
  }));
}

// 构建 MySQL 新增 payload：保留 null/空字符串/0/false，省略 omit/undefined。
export function buildMysqlCreateValues({
  record,
  editableFields
}: BuildMysqlMutationValuesInput): Record<string, unknown> {
  const values: Record<string, unknown> = {};
  Object.entries(record).forEach(([fieldName, rawValue]) => {
    if (isInternalField(fieldName) || !editableFields.has(fieldName)) return;
    if (isMysqlCellDraftValue(rawValue) && rawValue.kind === "default") return;
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

// 统一规划 MySQL 变更：让预览弹窗和真正提交共用同一份 create/update/delete 语义。
export function buildMysqlMutationPlan({
  records,
  baselineRecords,
  dirtyCellKeys,
  pendingDeleteRecordIds,
  editableFields,
  sourceType = "mysql",
  mysqlPrimaryKeyField = ""
}: BuildMysqlMutationPlanInput): MysqlMutationPlan {
  const recordKeyOptions: RecordKeyOptions = {
    sourceType,
    mysqlPrimaryKeyField
  };
  const dirtyCellSet = new Set(dirtyCellKeys);
  const pendingDeleteSet = new Set(pendingDeleteRecordIds);
  const creates: Record<string, unknown>[] = [];
  const updates: RecordUpdatePayload[] = [];
  const deletes: string[] = [];
  const previewItems: MutationPreviewItem[] = [];
  const missingRecordIdRows: number[] = [];
  let createOperationIndex = 0;
  let updateOperationIndex = 0;
  let deleteOperationIndex = 0;

  records.forEach((record, rowIndex) => {
    const stableRecordKey = typeof record.__baselineKey === "string" && record.__baselineKey.trim() !== ""
      ? record.__baselineKey
      : getRecordKey(record, rowIndex, recordKeyOptions);
    const isNewRow = Boolean(record.__isNew);

    if (isNewRow) {
      const values = buildMysqlCreateValues({
        record,
        editableFields
      });
      if (Object.keys(values).length === 0) return;
      creates.push(values);
      previewItems.push({
        op: "create",
        operationIndex: createOperationIndex,
        rowStableId: stableRecordKey,
        rowLocator: "",
        fields: buildMutationPreviewFields(values),
        previewSql: ""
      });
      createOperationIndex += 1;
      return;
    }

    const dirtyFields: string[] = [];
    dirtyCellSet.forEach((cellKey) => {
      // 记录键中可能包含 ":"，因此按最后一个 ":" 截取字段名。
      const splitIndex = cellKey.lastIndexOf(":");
      if (splitIndex < 0) return;
      const key = cellKey.slice(0, splitIndex);
      const field = cellKey.slice(splitIndex + 1);
      if (key !== stableRecordKey || field === "Id" || !editableFields.has(field)) return;
      dirtyFields.push(field);
    });

    const values = buildMysqlUpdateValues({
      record,
      editableFields,
      dirtyFields
    });
    const baselineRecord = baselineRecords[stableRecordKey];
    const recordLocator = resolveMysqlRecordLocator(baselineRecord, record, recordKeyOptions);
    const isPendingDelete = pendingDeleteSet.has(stableRecordKey);

    if (!recordLocator) {
      if (Object.keys(values).length > 0 || isPendingDelete) {
        missingRecordIdRows.push(rowIndex + 1);
      }
      return;
    }

    if (isPendingDelete) {
      deletes.push(recordLocator);
      previewItems.push({
        op: "delete",
        operationIndex: deleteOperationIndex,
        rowStableId: stableRecordKey,
        rowLocator: recordLocator,
        fields: [],
        previewSql: ""
      });
      deleteOperationIndex += 1;
      return;
    }

    if (Object.keys(values).length === 0) return;
    updates.push({
      recordId: recordLocator,
      values
    });
    previewItems.push({
      op: "update",
      operationIndex: updateOperationIndex,
      rowStableId: stableRecordKey,
      rowLocator: recordLocator,
      fields: buildMutationPreviewFields(values),
      previewSql: ""
    });
    updateOperationIndex += 1;
  });

  return {
    creates,
    updates,
    deletes,
    previewItems,
    missingRecordIdRows
  };
}

// 用后端返回的预览 SQL 回填前端结构化预览项，保证摘要与 SQL 一一对应。
export function mergeMysqlPreviewSqlItems(
  previewItems: MutationPreviewItem[],
  sqlItems: MutationPreviewSqlItem[]
): MutationPreviewItem[] {
  const sqlMap = new Map(sqlItems.map((item) => [`${item.op}:${item.operationIndex}`, item.previewSql]));
  return previewItems.map((item) => ({
    ...item,
    previewSql: sqlMap.get(`${item.op}:${item.operationIndex}`) || item.previewSql
  }));
}
