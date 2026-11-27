import { useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Eye,
  GitCompareArrows,
  Layers,
  Pin,
  PinOff,
  Play,
  RotateCcw,
  Save,
  Table2,
  Trash2
} from "lucide-react";
import { DataGrid } from "../../../../components/DataGrid";
import type { DataGridDiffOverlay, DataGridDiffRowStatus } from "../../../../components/DataGrid/types";
import type { GridAdapter } from "../../../../drivers/types";
import type { ObjectDescribe, QueryResult } from "../../../../types";
import {
  computeBlockDiff,
  type ConsoleDiffBaseline,
  type ConsoleResultBlock
} from "../logic/consoleDiffEngine.ts";
import {
  extractPrimaryObjectName,
  extractVisibleColumns,
  normalizeQueryResult,
  resolveFieldMetadataForExecutor
} from "../logic/consoleQueryUtils.ts";
import {
  resolveConsoleResultEditability,
  resolveConsoleRowKey,
  type ConsoleBlockEditDraft
} from "../logic/consoleResultEdit.ts";
import { resolveMysqlConsoleVisibleColumns } from "../logic/mysqlConsoleColumnOrder.ts";

type ConsoleDiffBoardProps = {
  // 当前控制台 Tab ID（用于隔离 DataGrid 滚动状态）。
  tabId: string;
  // 当前数据源 ID。
  sourceId: string;
  // 数据源表格适配器。
  gridAdapter: GridAdapter;
  // 展示时区。
  displayTimezone?: string | null;
  // 是否保留原始列序。
  preserveColumnOrder: boolean;
  // 当前多语句结果块列表。
  blocks: ConsoleResultBlock[];
  // 当前基线快照。
  baseline: ConsoleDiffBaseline | null;
  // 按语句下标映射的编辑草稿。
  draftsByStatement: Record<number, ConsoleBlockEditDraft>;
  // 按语句下标映射的选中行 ID。
  selectedRowIdsByStatement: Record<number, string[]>;
  // 对象字段描述缓存。
  objectDescribeMap: Record<string, ObjectDescribe>;
  // 是否正在执行查询。
  loading: boolean;
  // 设为基线回调。
  onPinBaseline: () => void;
  // 清除基线回调。
  onClearBaseline: () => void;
  // 重新执行全部 SQL 回调。
  onRerunAll: () => void;
  // 单元格编辑回调。
  onEditCell: (statementIndex: number, rowIndex: number, columnName: string, value: unknown) => void;
  // 行选中切换回调。
  onToggleRows: (statementIndex: number, checked: boolean, recordIds: string[]) => void;
  // 标记选中行删除回调。
  onToggleDeleteSelected: (statementIndex: number) => void;
  // 提交指定结果块修改回调。
  onSaveBlockChanges: (statementIndex: number) => void;
  // 放弃指定结果块修改回调。
  onDiscardBlockChanges: (statementIndex: number) => void;
  // 提示消息回调。
  onShowMessage: (message: string) => void;
};

type DiffBoardViewMode = "stacked" | "merged";

// 查询 Diff 控制台结果面板：支持多表同屏堆叠、单一 DataGrid 合并视图、基线对比标注与行内编辑。
export function ConsoleDiffBoard({
  tabId,
  sourceId,
  gridAdapter,
  displayTimezone,
  preserveColumnOrder,
  blocks,
  baseline,
  draftsByStatement,
  selectedRowIdsByStatement,
  objectDescribeMap,
  loading,
  onPinBaseline,
  onClearBaseline,
  onRerunAll,
  onEditCell,
  onToggleRows,
  onToggleDeleteSelected,
  onSaveBlockChanges,
  onDiscardBlockChanges,
  onShowMessage
}: ConsoleDiffBoardProps) {
  // 展示模式：stacked=分表同屏平铺，merged=合并为单一 DataGrid。
  const [viewMode, setViewMode] = useState<DiffBoardViewMode>("stacked");
  // 是否仅展示发生变化的记录。
  const [showChangedOnly, setShowChangedOnly] = useState(false);
  // 折叠状态映射（statementIndex -> 是否折叠）。
  const [collapsedMap, setCollapsedMap] = useState<Record<number, boolean>>({});

  // 计算每个结果块的 Diff 结果与可编辑性。
  const computedBlocks = useMemo(() => {
    return blocks.map((block) => {
      const draft = draftsByStatement[block.statementIndex];
      const activeResult: QueryResult | undefined = block.result
        ? {
            ...block.result,
            records: draft ? draft.records : block.result.records
          }
        : undefined;
      const effectiveBlock: ConsoleResultBlock = {
        ...block,
        result: activeResult
      };
      const diff = computeBlockDiff(effectiveBlock, baseline, gridAdapter, showChangedOnly);
      const editability = resolveConsoleResultEditability(
        block.sql,
        block.result,
        objectDescribeMap,
        gridAdapter
      );
      const primaryObject = editability.sourceTable || extractPrimaryObjectName(block.sql);
      const normalizedDisplayResult = normalizeQueryResult({
        totalSize: diff.displayRecords.length,
        records: diff.displayRecords,
        columnTypes: block.result?.columnTypes
      });
      const rawVisibleColumns = extractVisibleColumns(normalizedDisplayResult.records, preserveColumnOrder);
      const visibleColumns = preserveColumnOrder
        ? resolveMysqlConsoleVisibleColumns({
            queryText: block.sql,
            describe: primaryObject ? objectDescribeMap[primaryObject] : null,
            records: normalizedDisplayResult.records
          })
        : rawVisibleColumns;
      const fieldMetadataMap: Record<string, Record<string, unknown>> = {};
      visibleColumns.forEach((fieldName) => {
        const meta = resolveFieldMetadataForExecutor(
          fieldName,
          primaryObject,
          objectDescribeMap,
          normalizedDisplayResult.records,
          normalizedDisplayResult.columnTypes
        );
        if (meta) {
          fieldMetadataMap[fieldName] = meta;
        }
      });

      const dirtyCount = (draft?.dirtyCellKeys.length || 0) + (draft?.pendingDeleteRecordIds.length || 0);
      return {
        block,
        diff,
        editability,
        primaryObject,
        normalizedDisplayResult,
        visibleColumns,
        fieldMetadataMap,
        draft,
        dirtyCount
      };
    });
  }, [blocks, draftsByStatement, baseline, gridAdapter, showChangedOnly, objectDescribeMap, preserveColumnOrder]);

  // 汇总全部结果块的 Diff 计数。
  const totalDiffStats = useMemo(() => {
    return computedBlocks.reduce(
      (acc, item) => {
        acc.added += item.diff.addedCount;
        acc.modified += item.diff.modifiedCount;
        acc.deleted += item.diff.deletedCount;
        return acc;
      },
      { added: 0, modified: 0, deleted: 0 }
    );
  }, [computedBlocks]);

  // 单一 DataGrid 合并视图数据：将多表结果整合到同一个表格并附带来源列 `__source_query`。
  const mergedGridState = useMemo(() => {
    if (viewMode !== "merged") return null;
    const mergedRecords: Record<string, unknown>[] = [];
    const columnSet = new Set<string>(["__source_query"]);
    const mergedFieldMeta: Record<string, Record<string, unknown>> = {
      __source_query: {
        label: "来源查询",
        type: "string",
        createable: false,
        updateable: false
      }
    };
    const rowStatusByKey: Record<string, DataGridDiffRowStatus> = {};
    const cellDiffByKey: Record<string, { oldValue: unknown; newValue: unknown }> = {};

    computedBlocks.forEach((item) => {
      if (item.block.error || !item.block.result) return;
      const sourceLabel = `#${item.block.statementIndex + 1} ${item.primaryObject || "Query"}`;
      item.visibleColumns.forEach((col) => {
        columnSet.add(col);
        if (!mergedFieldMeta[col] && item.fieldMetadataMap[col]) {
          mergedFieldMeta[col] = {
            ...item.fieldMetadataMap[col],
            createable: false,
            updateable: false
          };
        }
      });

      item.normalizedDisplayResult.records.forEach((rec, rowIdx) => {
        const originalRowKey = resolveConsoleRowKey(
          rec,
          rowIdx,
          item.editability.primaryKeyField,
          gridAdapter
        );
        const mergedStableId = `merged:${item.block.statementIndex}:${originalRowKey}:${rowIdx}`;
        mergedRecords.push({
          ...rec,
          __source_query: sourceLabel,
          __rowStableId: mergedStableId
        });

        const rowStatus = item.diff.diffOverlay.rowStatusByKey?.[originalRowKey];
        if (rowStatus) {
          rowStatusByKey[mergedStableId] = rowStatus;
        }
        Object.entries(item.diff.diffOverlay.cellDiffByKey || {}).forEach(([cellKey, diffVal]) => {
          if (cellKey.startsWith(`${originalRowKey}:`)) {
            const colName = cellKey.slice(originalRowKey.length + 1);
            cellDiffByKey[`${mergedStableId}:${colName}`] = diffVal;
          }
        });
      });
    });

    const diffOverlay: DataGridDiffOverlay = { rowStatusByKey, cellDiffByKey };
    return {
      result: { totalSize: mergedRecords.length, records: mergedRecords } as QueryResult,
      visibleColumns: Array.from(columnSet),
      fieldMetadataMap: mergedFieldMeta,
      diffOverlay
    };
  }, [viewMode, computedBlocks, gridAdapter]);

  if (blocks.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-[12px] text-neutral/65">
        <GitCompareArrows size={20} className="text-amber-600/75" />
        <p>在上方输入一条或多条 SQL 后点击执行，然后点击“设为基线”即可在测试前后对比多表数据变化。</p>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Diff 控制台顶部统一工具栏。 */}
      <div className="flex flex-wrap items-center gap-1.5 border-b border-base-300 bg-base-200/40 px-3 py-1.5 text-[11.5px]">
        {/* 重新执行并对比按钮。 */}
        <button
          type="button"
          className="btn btn-primary btn-xs"
          disabled={loading}
          onClick={onRerunAll}
          title="重新执行当前编辑器 SQL 并与基线对比"
        >
          <Play size={11} />
          <span>{baseline ? "重新执行并对比" : "重新执行"}</span>
        </button>

        {/* 设为/更新基线按钮。 */}
        <button
          type="button"
          className={`btn btn-xs ${baseline ? "btn-outline" : "btn-secondary"}`}
          disabled={loading}
          onClick={onPinBaseline}
          title="将当前查询结果锁定为对比基线"
        >
          <Pin size={11} />
          <span>{baseline ? "更新基线" : "设为基线"}</span>
        </button>

        {baseline && (
          <button
            type="button"
            className="btn btn-ghost btn-xs text-neutral/70"
            onClick={onClearBaseline}
            title="清除当前对比基线"
          >
            <PinOff size={11} />
            <span>清除基线</span>
          </button>
        )}

        <div className="mx-1 h-3.5 w-[1px] bg-base-300" />

        {/* 仅看变化行开关。 */}
        <button
          type="button"
          className={`btn btn-xs ${showChangedOnly ? "btn-accent" : "btn-ghost"}`}
          disabled={!baseline}
          onClick={() => setShowChangedOnly((prev) => !prev)}
          title="仅展示新增、修改或删除的数据行"
        >
          <Eye size={11} />
          <span>仅看变化行</span>
        </button>

        {/* 分表同屏 / 单表合并切换。 */}
        <div className="join">
          <button
            type="button"
            className={`btn join-item btn-xs ${viewMode === "stacked" ? "btn-active" : "btn-ghost"}`}
            onClick={() => setViewMode("stacked")}
            title="按表分区同屏展示（支持独立列头与行内编辑）"
          >
            <Layers size={11} />
            <span>分表同屏</span>
          </button>
          <button
            type="button"
            className={`btn join-item btn-xs ${viewMode === "merged" ? "btn-active" : "btn-ghost"}`}
            onClick={() => setViewMode("merged")}
            title="将所有查询结果合并到同一个 DataGrid 表格中展示"
          >
            <Table2 size={11} />
            <span>单表合并</span>
          </button>
        </div>

        {/* 汇总 Diff 统计徽标。 */}
        {baseline && (
          <div className="ml-auto flex items-center gap-1.5 text-[11px]">
            <span className="text-neutral/60">
              基线 {new Date(baseline.capturedAt).toLocaleTimeString([], { hour12: false })}
            </span>
            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700">
              +{totalDiffStats.added}
            </span>
            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700">
              ~{totalDiffStats.modified}
            </span>
            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-medium text-rose-700">
              -{totalDiffStats.deleted}
            </span>
          </div>
        )}
      </div>

      {/* 结果主体区域。 */}
      {viewMode === "merged" && mergedGridState ? (
        <div className="min-h-0 flex-1">
          <DataGrid
            result={mergedGridState.result}
            visibleColumns={mergedGridState.visibleColumns}
            fieldMetadataMap={mergedGridState.fieldMetadataMap}
            readOnlyMode={true}
            readOnlyReasonText="单表合并视图仅用于联合浏览与 Diff 对比，请切回“分表同屏”进行单表行内编辑。"
            dirtyCellKeys={[]}
            selectedRecordIds={[]}
            pendingDeleteRecordIds={[]}
            displayTimezone={displayTimezone}
            gridAdapter={gridAdapter}
            preserveColumnOrder={true}
            diffOverlay={mergedGridState.diffOverlay}
            scrollStateKey={`diff-merged:${tabId}`}
            onToggleAll={() => {}}
            onEditCell={() => {}}
            onShowMessage={onShowMessage}
          />
        </div>
      ) : (
        <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto p-2.5">
          {computedBlocks.map((item) => {
            const stmtIdx = item.block.statementIndex;
            const collapsed = Boolean(collapsedMap[stmtIdx]);
            const selectedIds = selectedRowIdsByStatement[stmtIdx] || [];
            const hasDiffChanges =
              item.diff.addedCount + item.diff.modifiedCount + item.diff.deletedCount > 0;
            const blockHeight = Math.min(340, Math.max(150, item.normalizedDisplayResult.records.length * 32 + 78));

            return (
              <div
                key={stmtIdx}
                className="overflow-hidden rounded-lg border border-base-300 bg-base-100 shadow-xs"
              >
                {/* 单表区块头部。 */}
                <div className="flex flex-wrap items-center gap-2 border-b border-base-200 bg-base-200/45 px-2.5 py-1.5 text-[11.5px]">
                  <button
                    type="button"
                    className="flex items-center gap-1 font-medium text-neutral hover:text-primary"
                    onClick={() =>
                      setCollapsedMap((prev) => ({ ...prev, [stmtIdx]: !prev[stmtIdx] }))
                    }
                  >
                    {collapsed ? <ChevronRight size={13} /> : <ChevronDown size={13} />}
                    <span>#{stmtIdx + 1}</span>
                    {item.primaryObject && (
                      <span className="rounded bg-base-300/70 px-1.5 py-0.5 font-mono text-[11px]">
                        {item.primaryObject}
                      </span>
                    )}
                  </button>

                  <span className="max-w-[260px] truncate font-mono text-[11px] text-neutral/65" title={item.block.sql}>
                    {item.block.sql}
                  </span>

                  <span className="text-[11px] text-neutral/60">
                    {item.block.result?.totalSize ?? 0} 行 · {item.block.durationMs}ms
                  </span>

                  {/* Diff 徽标。 */}
                  {item.diff.hasBaseline && !item.diff.sqlMatched && (
                    <span className="rounded bg-warning/20 px-1.5 py-0.5 text-[10.5px] text-warning-content">
                      SQL 已变更，未对比
                    </span>
                  )}
                  {item.diff.hasBaseline && item.diff.sqlMatched && (
                    <div className="flex items-center gap-1 text-[10.5px]">
                      {hasDiffChanges ? (
                        <>
                          {item.diff.addedCount > 0 && (
                            <span className="rounded bg-emerald-500/15 px-1.5 py-0.5 font-medium text-emerald-700">
                              +{item.diff.addedCount}
                            </span>
                          )}
                          {item.diff.modifiedCount > 0 && (
                            <span className="rounded bg-amber-500/15 px-1.5 py-0.5 font-medium text-amber-700">
                              ~{item.diff.modifiedCount}
                            </span>
                          )}
                          {item.diff.deletedCount > 0 && (
                            <span className="rounded bg-rose-500/15 px-1.5 py-0.5 font-medium text-rose-700">
                              -{item.diff.deletedCount}
                            </span>
                          )}
                        </>
                      ) : (
                        <span className="rounded bg-base-200 px-1.5 py-0.5 text-neutral/55">
                          无变化
                        </span>
                      )}
                      {item.diff.matchMode === "position" && (
                        <span className="text-neutral/50" title="未检测到主键列，当前按行位置对比">
                          (按位置对比)
                        </span>
                      )}
                    </div>
                  )}

                  {/* 可编辑状态与行内提交操作。 */}
                  <div className="ml-auto flex items-center gap-1.5">
                    {item.editability.editable ? (
                      <>
                        <span className="rounded bg-sky-500/12 px-1.5 py-0.5 text-[10.5px] text-sky-700">
                          可编辑
                        </span>
                        {selectedIds.length > 0 && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-xs text-rose-600"
                            onClick={() => onToggleDeleteSelected(stmtIdx)}
                            title="标记或取消标记选中行为待删除"
                          >
                            <Trash2 size={11} />
                            <span>删行 ({selectedIds.length})</span>
                          </button>
                        )}
                        {item.dirtyCount > 0 && (
                          <>
                            <button
                              type="button"
                              className="btn btn-ghost btn-xs"
                              onClick={() => onDiscardBlockChanges(stmtIdx)}
                            >
                              <RotateCcw size={11} />
                              <span>放弃</span>
                            </button>
                            <button
                              type="button"
                              className="btn btn-primary btn-xs"
                              onClick={() => onSaveBlockChanges(stmtIdx)}
                            >
                              <Save size={11} />
                              <span>保存 ({item.dirtyCount})</span>
                            </button>
                          </>
                        )}
                      </>
                    ) : (
                      <span
                        className="rounded bg-base-200 px-1.5 py-0.5 text-[10.5px] text-neutral/60"
                        title={item.editability.readonlyReason}
                      >
                        只读
                      </span>
                    )}
                  </div>
                </div>

                {/* 区块数据内容。 */}
                {!collapsed && (
                  item.block.error ? (
                    <div className="p-3 text-[12px] text-error">{item.block.error}</div>
                  ) : (
                    <div style={{ height: blockHeight }}>
                      <DataGrid
                        result={item.normalizedDisplayResult}
                        visibleColumns={item.visibleColumns}
                        fieldMetadataMap={item.fieldMetadataMap}
                        readOnlyMode={!item.editability.editable}
                        readOnlyReasonText={item.editability.readonlyReason}
                        dirtyCellKeys={item.draft?.dirtyCellKeys || []}
                        selectedRecordIds={selectedIds}
                        pendingDeleteRecordIds={item.draft?.pendingDeleteRecordIds || []}
                        displayTimezone={displayTimezone}
                        sourceId={sourceId}
                        objectName={item.editability.sourceTable || item.primaryObject}
                        gridAdapter={gridAdapter}
                        preserveColumnOrder={preserveColumnOrder}
                        diffOverlay={item.diff.diffOverlay}
                        enableReadonlyCellHint={false}
                        allowReadonlyOverlay={true}
                        scrollStateKey={`diff-block:${tabId}:${stmtIdx}`}
                        onToggleAll={(checked, recordIds) => onToggleRows(stmtIdx, checked, recordIds)}
                        onEditCell={(rowIndex, columnName, value) =>
                          onEditCell(stmtIdx, rowIndex, columnName, value)
                        }
                        onShowMessage={onShowMessage}
                      />
                    </div>
                  )
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
