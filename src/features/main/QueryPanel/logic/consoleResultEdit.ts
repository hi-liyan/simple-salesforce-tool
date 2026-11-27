import type { GridAdapter } from "../../../../drivers/types.ts";
import type {
  ObjectDescribe,
  QueryResult,
  RecordUpdatePayload
} from "../../../../types/index.ts";
import { extractPrimaryObjectName } from "./consoleQueryUtils.ts";

// 单个结果块的本地编辑草稿状态。
export type ConsoleBlockEditDraft = {
  // 基线原始记录映射（key 为行定位键），用于提交时定位旧主键。
  baselineRecords: Record<string, Record<string, unknown>>;
  // 脏单元格集合（`${rowKey}:${columnName}`）。
  dirtyCellKeys: string[];
  // 待删除记录定位值列表。
  pendingDeleteRecordIds: string[];
  // 当前编辑后的记录列表（与 result.records 同序）。
  records: Record<string, unknown>[];
};

// 解析控制台结果块的可编辑性（优先信任后端 resultMeta，未返回时做保守兜底）。
export function resolveConsoleResultEditability(
  sql: string,
  result: QueryResult | undefined,
  objectDescribeMap: Record<string, ObjectDescribe>,
  gridAdapter: GridAdapter
): {
  editable: boolean;
  readonlyReason: string;
  sourceTable: string;
  primaryKeyField: string;
} {
  if (!result) {
    return {
      editable: false,
      readonlyReason: "当前语句无可用结果集。",
      sourceTable: "",
      primaryKeyField: ""
    };
  }

  // 行内注释：后端驱动已返回 resultMeta 时，直接使用权威判定结果。
  if (result.resultMeta) {
    return {
      editable: result.resultMeta.editable,
      readonlyReason: result.resultMeta.readonlyReason || "当前结果集为只读。",
      sourceTable: result.resultMeta.sourceTable || "",
      primaryKeyField: result.resultMeta.primaryKeyFields?.[0] || ""
    };
  }

  // 行内注释：兜底路径（例如尚未返回 resultMeta 的驱动），仅当单表且存在可定位主键时开放编辑。
  const primaryObject = extractPrimaryObjectName(sql);
  const describe = primaryObject ? objectDescribeMap[primaryObject] : undefined;
  const fieldMetaMap: Record<string, Record<string, unknown>> = {};
  describe?.fields.forEach((field) => {
    fieldMetaMap[field.name] = {
      ...(field.metadata || {}),
      columnKey: field.metadata?.columnKey
    };
  });
  const pkField = gridAdapter.resolvePrimaryKeyField(fieldMetaMap);
  const firstRecord = result.records[0];
  const hasPkInResult = Boolean(pkField && (!firstRecord || firstRecord[pkField] !== undefined));

  if (!primaryObject || !hasPkInResult) {
    return {
      editable: false,
      readonlyReason: "当前结果集缺少单表来源或主键列，已设为只读。",
      sourceTable: primaryObject,
      primaryKeyField: pkField
    };
  }

  return {
    editable: true,
    readonlyReason: "",
    sourceTable: primaryObject,
    primaryKeyField: pkField
  };
}

// 为结果集构建基线快照字典（key -> 浅拷贝记录）。
export function buildConsoleBaselineMap(
  records: Record<string, unknown>[],
  primaryKeyField: string,
  gridAdapter: GridAdapter
): Record<string, Record<string, unknown>> {
  const map: Record<string, Record<string, unknown>> = {};
  records.forEach((record, index) => {
    const rowKey = resolveConsoleRowKey(record, index, primaryKeyField, gridAdapter);
    map[rowKey] = { ...record };
  });
  return map;
}

// 解析控制台表格行键（与 DataGrid.getRecordKey 保持一致）。
export function resolveConsoleRowKey(
  record: Record<string, unknown>,
  rowIndex: number,
  primaryKeyField: string,
  gridAdapter: GridAdapter
): string {
  if (record.__rowStableId) return String(record.__rowStableId);
  if (record.__localId) return String(record.__localId);
  const resolved = gridAdapter.resolveRecordKey(record, primaryKeyField);
  if (resolved) return resolved;
  return `row:${rowIndex}`;
}

// 递归解包驱动草稿值或原始值（用于提取真实提交值）。
function unwrapDraftValue(rawValue: unknown): { isOmit: boolean; isDefault: boolean; value: unknown } {
  if (rawValue && typeof rawValue === "object" && "__mysqlDraft" in rawValue) {
    const draft = rawValue as { __mysqlDraft?: boolean; kind?: string; value?: unknown };
    if (draft.__mysqlDraft === true) {
      if (draft.kind === "omit") {
        return { isOmit: true, isDefault: false, value: undefined };
      }
      if (draft.kind === "default") {
        return { isOmit: false, isDefault: true, value: rawValue };
      }
      if (draft.kind === "null") {
        return { isOmit: false, isDefault: false, value: null };
      }
      return { isOmit: false, isDefault: false, value: draft.value };
    }
  }
  return { isOmit: false, isDefault: false, value: rawValue };
}

// 将单次单元格编辑应用到草稿状态中，并返回更新后的草稿。
export function applyConsoleCellEdit(
  draft: ConsoleBlockEditDraft,
  rowIndex: number,
  columnName: string,
  nextValue: unknown,
  primaryKeyField: string,
  gridAdapter: GridAdapter
): ConsoleBlockEditDraft {
  const target = draft.records[rowIndex];
  if (!target || target.__diffDeleted) return draft;

  const rowKey = resolveConsoleRowKey(target, rowIndex, primaryKeyField, gridAdapter);
  const nextRecords = draft.records.map((item, idx) =>
    idx === rowIndex ? { ...item, [columnName]: nextValue } : item
  );
  const cellKey = `${rowKey}:${columnName}`;
  const nextDirtyKeys = draft.dirtyCellKeys.includes(cellKey)
    ? draft.dirtyCellKeys
    : [...draft.dirtyCellKeys, cellKey];

  return {
    ...draft,
    records: nextRecords,
    dirtyCellKeys: nextDirtyKeys
  };
}

// 切换待删除行标记（仅对非幽灵行、非新建行生效）。
export function toggleConsoleDeleteRows(
  draft: ConsoleBlockEditDraft,
  selectedRecordIds: string[]
): ConsoleBlockEditDraft {
  if (selectedRecordIds.length === 0) return draft;
  const currentSet = new Set(draft.pendingDeleteRecordIds);
  const allMarked = selectedRecordIds.every((id) => currentSet.has(id));
  if (allMarked) {
    selectedRecordIds.forEach((id) => currentSet.delete(id));
  } else {
    selectedRecordIds.forEach((id) => currentSet.add(id));
  }
  return {
    ...draft,
    pendingDeleteRecordIds: Array.from(currentSet)
  };
}

// 基于草稿状态构建后端两阶段提交载荷（creates / updates / deletes）。
export function buildConsoleMutationPayload(
  draft: ConsoleBlockEditDraft,
  primaryKeyField: string,
  gridAdapter: GridAdapter
): {
  creates: Record<string, unknown>[];
  updates: RecordUpdatePayload[];
  deletes: string[];
} {
  const dirtyByRow = new Map<string, Set<string>>();
  draft.dirtyCellKeys.forEach((cellKey) => {
    const splitIdx = cellKey.lastIndexOf(":");
    if (splitIdx <= 0) return;
    const rowKey = cellKey.slice(0, splitIdx);
    const fieldName = cellKey.slice(splitIdx + 1);
    if (!dirtyByRow.has(rowKey)) {
      dirtyByRow.set(rowKey, new Set());
    }
    dirtyByRow.get(rowKey)!.add(fieldName);
  });

  const pendingDeleteSet = new Set(draft.pendingDeleteRecordIds);
  const updates: RecordUpdatePayload[] = [];
  const creates: Record<string, unknown>[] = [];

  draft.records.forEach((record, index) => {
    if (record.__diffDeleted) return;
    const rowKey = resolveConsoleRowKey(record, index, primaryKeyField, gridAdapter);
    if (pendingDeleteSet.has(rowKey)) return;

    if (record.__isNew) {
      const createValues: Record<string, unknown> = {};
      Object.entries(record).forEach(([key, rawVal]) => {
        if (key.startsWith("__") || key === "attributes") return;
        const unwrapped = unwrapDraftValue(rawVal);
        if (unwrapped.isOmit || unwrapped.isDefault || unwrapped.value === undefined) return;
        createValues[key] = unwrapped.value;
      });
      creates.push(createValues);
      return;
    }

    const dirtyFields = dirtyByRow.get(rowKey);
    if (!dirtyFields || dirtyFields.size === 0) return;

    const baseline = draft.baselineRecords[rowKey];
    const locatorRaw =
      (primaryKeyField ? baseline?.[primaryKeyField] : undefined) ??
      baseline?.Id ??
      (primaryKeyField ? record[primaryKeyField] : undefined) ??
      record.Id;
    const recordId = locatorRaw !== null && locatorRaw !== undefined ? String(locatorRaw).trim() : "";
    if (!recordId) return;

    const fields: Record<string, unknown> = {};
    dirtyFields.forEach((fieldName) => {
      const unwrapped = unwrapDraftValue(record[fieldName]);
      if (unwrapped.isOmit) return;
      fields[fieldName] = unwrapped.value;
    });

    if (Object.keys(fields).length > 0) {
      updates.push({ recordId, values: fields });
    }
  });

  const deletes = draft.pendingDeleteRecordIds.filter((id) => {
    const base = draft.baselineRecords[id];
    return !base?.__isNew && !base?.__diffDeleted;
  });

  return { creates, updates, deletes };
}
