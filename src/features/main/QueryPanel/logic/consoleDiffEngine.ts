import type { DataGridDiffOverlay, DataGridDiffRowStatus } from "../../../../components/DataGrid/types.ts";
import type { GridAdapter } from "../../../../drivers/types.ts";
import type { QueryResult } from "../../../../types/index.ts";

// 控制台单条语句执行结果块：承载当前结果、SQL 元信息与独立编辑草稿。
export type ConsoleResultBlock = {
  // 语句在编辑器中的序号（从 0 开始）。
  statementIndex: number;
  // 实际执行的 SQL/SOQL 文本。
  sql: string;
  // 规范化 SQL 指纹（用于基线对齐校验）。
  sqlFingerprint: string;
  // 查询结果（失败时为空）。
  result?: QueryResult;
  // 执行错误信息。
  error?: string;
  // 执行耗时（毫秒）。
  durationMs: number;
};

// 基线快照中的单块记录：按语句序号与 SQL 指纹存储基线行。
export type ConsoleDiffBaselineBlock = {
  // 语句序号。
  statementIndex: number;
  // 规范化 SQL 指纹。
  sqlFingerprint: string;
  // 来源表名（可选）。
  sourceTable?: string;
  // 主键列名列表。
  primaryKeyFields: string[];
  // 基线记录列表（保留顺序）。
  records: Record<string, unknown>[];
};

// 查询 Diff 控制台基线快照（纯内存运行时状态，不写入巨型持久化）。
export type ConsoleDiffBaseline = {
  // 快照捕获时间（ISO 字符串）。
  capturedAt: string;
  // 各语句对应的基线块。
  blocks: ConsoleDiffBaselineBlock[];
};

// 单个结果块的 Diff 计算结果。
export type BlockDiffResult = {
  // 是否匹配到基线块。
  hasBaseline: boolean;
  // 基线 SQL 是否与当前一致（不一致时仅提示，不强行错位对比）。
  sqlMatched: boolean;
  // 行对齐模式：primary_key=主键精确对齐，position=无主键按位置兜底。
  matchMode: "primary_key" | "position";
  // 新增行数。
  addedCount: number;
  // 修改行数。
  modifiedCount: number;
  // 删除行数。
  deletedCount: number;
  // 合并幽灵删除行后的展示记录列表。
  displayRecords: Record<string, unknown>[];
  // 传给 DataGrid 的 Diff 叠加层。
  diffOverlay: DataGridDiffOverlay;
};

// 规范化 SQL 文本作为对比指纹：忽略首尾空白与连续空格差异。
export function normalizeSqlFingerprint(sql: string): string {
  return sql.replace(/\s+/g, " ").trim().toLowerCase();
}

// 稳定序列化单个字段值：用于精准判断字段前后是否发生变化。
function serializeComparableValue(value: unknown): string {
  if (value === null || value === undefined) return "__NULLISH__";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return `${typeof value}:${String(value)}`;
}

// 从记录中提取业务可见列（排除内部双下划线字段与 Salesforce attributes）。
function extractComparableColumns(record: Record<string, unknown>): string[] {
  return Object.keys(record).filter((key) => !key.startsWith("__") && key !== "attributes");
}

// 计算单行在 Diff 引擎中的唯一对齐键。
export function resolveDiffRowAnchorKey(
  record: Record<string, unknown>,
  rowIndex: number,
  primaryKeyFields: string[],
  gridAdapter: GridAdapter
): { key: string; usedPrimaryKey: boolean } {
  if (primaryKeyFields.length > 0) {
    const pkParts = primaryKeyFields.map((field) => record[field]);
    const hasAllPk = pkParts.every((val) => val !== null && val !== undefined && String(val) !== "");
    if (hasAllPk) {
      return {
        key: `pk:${pkParts.map((val) => String(val)).join("|")}`,
        usedPrimaryKey: true
      };
    }
  }
  const adapterKey = gridAdapter.resolveRecordKey(record, primaryKeyFields[0]);
  if (adapterKey && adapterKey !== `row:${rowIndex}`) {
    return { key: `pk:${adapterKey}`, usedPrimaryKey: true };
  }
  return { key: `pos:${rowIndex}`, usedPrimaryKey: false };
}

// 计算单个结果块相对于基线的 Diff 结果，并生成幽灵删除行与 DataGrid 高亮叠加层。
export function computeBlockDiff(
  block: ConsoleResultBlock,
  baseline: ConsoleDiffBaseline | null,
  gridAdapter: GridAdapter,
  showChangedOnly = false
): BlockDiffResult {
  const currentRecords = block.result?.records || [];
  const primaryKeyFields = block.result?.resultMeta?.primaryKeyFields || [];

  if (!baseline) {
    return {
      hasBaseline: false,
      sqlMatched: true,
      matchMode: primaryKeyFields.length > 0 ? "primary_key" : "position",
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      displayRecords: currentRecords,
      diffOverlay: {}
    };
  }

  const baseBlock =
    baseline.blocks.find((item) => item.statementIndex === block.statementIndex) ||
    baseline.blocks.find((item) => item.sqlFingerprint === block.sqlFingerprint);

  if (!baseBlock) {
    return {
      hasBaseline: false,
      sqlMatched: false,
      matchMode: primaryKeyFields.length > 0 ? "primary_key" : "position",
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      displayRecords: currentRecords,
      diffOverlay: {}
    };
  }

  const sqlMatched = baseBlock.sqlFingerprint === block.sqlFingerprint;
  if (!sqlMatched) {
    return {
      hasBaseline: true,
      sqlMatched: false,
      matchMode: primaryKeyFields.length > 0 ? "primary_key" : "position",
      addedCount: 0,
      modifiedCount: 0,
      deletedCount: 0,
      displayRecords: currentRecords,
      diffOverlay: {}
    };
  }

  const effectivePkFields =
    primaryKeyFields.length > 0 ? primaryKeyFields : baseBlock.primaryKeyFields;

  // 行内注释：建立基线行映射（anchorKey -> 基线记录）。
  const baseMap = new Map<string, Record<string, unknown>>();
  let usedPrimaryKey = effectivePkFields.length > 0;
  baseBlock.records.forEach((record, index) => {
    const anchor = resolveDiffRowAnchorKey(record, index, effectivePkFields, gridAdapter);
    if (!anchor.usedPrimaryKey) usedPrimaryKey = false;
    baseMap.set(anchor.key, record);
  });

  const rowStatusByKey: Record<string, DataGridDiffRowStatus> = {};
  const cellDiffByKey: Record<string, { oldValue: unknown; newValue: unknown }> = {};
  const matchedBaseKeys = new Set<string>();
  const displayRecords: Record<string, unknown>[] = [];

  let addedCount = 0;
  let modifiedCount = 0;
  let deletedCount = 0;

  // 行内注释：遍历当前记录，判定新增（added）与修改（modified）。
  currentRecords.forEach((record, index) => {
    const anchor = resolveDiffRowAnchorKey(record, index, effectivePkFields, gridAdapter);
    if (!anchor.usedPrimaryKey) usedPrimaryKey = false;
    const gridRowKey = resolveGridDisplayRowKey(record, index, effectivePkFields[0], gridAdapter);
    const baseRecord = baseMap.get(anchor.key);

    if (!baseRecord) {
      addedCount += 1;
      rowStatusByKey[gridRowKey] = "added";
      displayRecords.push(record);
      return;
    }

    matchedBaseKeys.add(anchor.key);
    const cols = Array.from(
      new Set([...extractComparableColumns(baseRecord), ...extractComparableColumns(record)])
    );
    let hasChangedCell = false;
    cols.forEach((col) => {
      const oldVal = baseRecord[col];
      const newVal = record[col];
      if (serializeComparableValue(oldVal) !== serializeComparableValue(newVal)) {
        hasChangedCell = true;
        cellDiffByKey[`${gridRowKey}:${col}`] = { oldValue: oldVal, newValue: newVal };
      }
    });

    if (hasChangedCell) {
      modifiedCount += 1;
      rowStatusByKey[gridRowKey] = "modified";
      displayRecords.push(record);
    } else if (!showChangedOnly) {
      displayRecords.push(record);
    }
  });

  // 行内注释：将基线存在但当前结果已消失的记录作为幽灵删除行（deleted）追加展示。
  baseBlock.records.forEach((baseRecord, index) => {
    const anchor = resolveDiffRowAnchorKey(baseRecord, index, effectivePkFields, gridAdapter);
    if (matchedBaseKeys.has(anchor.key)) return;
    deletedCount += 1;
    const ghostStableId = `__diff_deleted__${block.statementIndex}__${anchor.key}`;
    const ghostRecord: Record<string, unknown> = {
      ...baseRecord,
      __rowStableId: ghostStableId,
      __diffDeleted: true
    };
    rowStatusByKey[ghostStableId] = "deleted";
    displayRecords.push(ghostRecord);
  });

  return {
    hasBaseline: true,
    sqlMatched: true,
    matchMode: usedPrimaryKey ? "primary_key" : "position",
    addedCount,
    modifiedCount,
    deletedCount,
    displayRecords,
    diffOverlay: {
      rowStatusByKey,
      cellDiffByKey
    }
  };
}

// 解析 DataGrid 内部使用的行键，确保与 DataGrid.getRecordKey 完全一致。
function resolveGridDisplayRowKey(
  record: Record<string, unknown>,
  rowIndex: number,
  primaryKeyField: string | undefined,
  gridAdapter: GridAdapter
): string {
  if (record.__rowStableId) return String(record.__rowStableId);
  if (record.__localId) return String(record.__localId);
  const resolved = gridAdapter.resolveRecordKey(record, primaryKeyField);
  if (resolved) return resolved;
  return `row:${rowIndex}`;
}
