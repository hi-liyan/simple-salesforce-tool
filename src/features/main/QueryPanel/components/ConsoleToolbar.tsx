import { Check, Eraser, FastForward, Gauge, ListChecks, Play, Sparkles, Square, Undo2, WrapText } from "lucide-react";
import { useState } from "react";
import { DataSourceSelector } from "../../../../components/DataSourceSelector";
import type { SalesforceSource } from "../../../../types";

// 控制台事务模式类型（对齐 DBX：Auto / Manual / Smart）。
export type ConsoleTransactionMode = "auto" | "manual" | "smart";

type ConsoleToolbarProps = {
  // 是否正在执行查询。
  loading: boolean;
  // 当前编辑器是否有内容。
  hasContent: boolean;
  // 当前驱动是否支持多语句批量执行。
  supportsMultiStatement: boolean;
  // 当前驱动是否支持 EXPLAIN 执行计划。
  supportsExplain: boolean;
  // 当前驱动是否支持交互式会话事务。
  supportsInteractiveTransaction?: boolean;
  // 当前事务模式。
  transactionMode?: ConsoleTransactionMode;
  // 当前是否存在未提交事务。
  inTransaction?: boolean;
  // 未提交 SQL 摘要列表。
  uncommittedSqls?: string[];
  // 事务提交/回滚中。
  transactionBusy?: boolean;
  // 当前查询语言展示标签（SQL / SOQL）。
  queryLanguageLabel: string;
  // 是否开启自动换行。
  wordWrapEnabled: boolean;
  // 全部可用数据源列表。
  sources: SalesforceSource[];
  // 当前控制台绑定的数据源 ID。
  selectedSourceId: string;
  // 执行当前/选中语句。
  onExecuteCurrent: () => void;
  // 执行全部语句。
  onExecuteAll: () => void;
  // 停止当前查询。
  onStopQuery: () => void;
  // 执行 EXPLAIN。
  onExplain: () => void;
  // 格式化语句。
  onFormat: () => void;
  // 切换自动换行。
  onToggleWordWrap: () => void;
  // 清空编辑器。
  onClear: () => void;
  // 切换当前控制台绑定数据源。
  onChangeSource: (sourceId: string) => void;
  // 切换当前事务模式。
  onChangeTransactionMode?: (mode: ConsoleTransactionMode) => void;
  // 提交挂起事务。
  onCommitTransaction?: () => void;
  // 回滚挂起事务。
  onRollbackTransaction?: () => void;
};

// 控制台顶部紧凑操作栏（参考 DBX 设计：纯小 Icon 按钮 + 事务控制 + 右侧数据源选择器）。
export function ConsoleToolbar({
  loading,
  hasContent,
  supportsMultiStatement,
  supportsExplain,
  supportsInteractiveTransaction = false,
  transactionMode = "auto",
  inTransaction = false,
  uncommittedSqls = [],
  transactionBusy = false,
  queryLanguageLabel,
  wordWrapEnabled,
  sources,
  selectedSourceId,
  onExecuteCurrent,
  onExecuteAll,
  onStopQuery,
  onExplain,
  onFormat,
  onToggleWordWrap,
  onClear,
  onChangeSource,
  onChangeTransactionMode,
  onCommitTransaction,
  onRollbackTransaction
}: ConsoleToolbarProps) {
  // 是否展开未提交事务日志弹层。
  const [txLogOpen, setTxLogOpen] = useState(false);
  const iconButtonClass =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 transition-colors hover:bg-base-200 hover:text-neutral disabled:cursor-not-allowed disabled:opacity-40";
  const txModeDotClass =
    transactionMode === "manual"
      ? "bg-amber-500"
      : transactionMode === "smart"
        ? "bg-sky-500"
        : "bg-emerald-500";

  return (
    <div className="flex h-9 shrink-0 items-center justify-between gap-2 border-b border-base-300 bg-base-100 px-2.5">
      {/* 左侧紧凑功能按钮组。 */}
      <div className="flex items-center gap-1">
        {/* 执行当前/选中语句按钮。 */}
        <button
          type="button"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-600 transition-colors hover:bg-emerald-500/12 disabled:cursor-not-allowed disabled:opacity-40"
          disabled={loading}
          title="执行当前或选中语句 (Ctrl/Cmd + Enter)"
          aria-label="执行当前或选中语句"
          onMouseDown={(event) => event.preventDefault()}
          onClick={onExecuteCurrent}
        >
          <Play size={14} fill="currentColor" />
        </button>

        {/* 执行全部语句按钮（支持多语句的数据源显示）。 */}
        {supportsMultiStatement && (
          <button
            type="button"
            className="inline-flex h-7 w-7 items-center justify-center rounded-md text-sky-600 transition-colors hover:bg-sky-500/12 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={loading}
            title="执行全部语句 (Ctrl/Cmd + Shift + Enter)"
            aria-label="执行全部语句"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onExecuteAll}
          >
            <FastForward size={14} />
          </button>
        )}

        {/* 停止慢查询按钮。 */}
        <button
          type="button"
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            loading
              ? "text-error hover:bg-error/12"
              : "cursor-not-allowed text-neutral/30"
          }`}
          disabled={!loading}
          title="停止执行"
          aria-label="停止执行"
          onClick={onStopQuery}
        >
          <Square size={12} fill="currentColor" />
        </button>

        <div className="mx-1 h-4 w-[1px] bg-base-300" />

        {/* 格式化 SQL/SOQL 按钮。 */}
        <button
          type="button"
          className={iconButtonClass}
          disabled={loading || !hasContent}
          title="格式化语句"
          aria-label="格式化语句"
          onClick={onFormat}
        >
          <Sparkles size={14} />
        </button>

        {/* EXPLAIN 执行计划按钮（仅支持驱动显示）。 */}
        {supportsExplain && (
          <button
            type="button"
            className={iconButtonClass}
            disabled={loading || !hasContent}
            title="查看执行计划 (EXPLAIN)"
            aria-label="查看执行计划"
            onMouseDown={(event) => event.preventDefault()}
            onClick={onExplain}
          >
            <Gauge size={14} />
          </button>
        )}

        {/* 自动换行切换按钮。 */}
        <button
          type="button"
          className={`inline-flex h-7 w-7 items-center justify-center rounded-md transition-colors ${
            wordWrapEnabled
              ? "bg-primary/12 text-primary"
              : "text-neutral/75 hover:bg-base-200 hover:text-neutral"
          }`}
          title={wordWrapEnabled ? "关闭自动换行" : "开启自动换行"}
          aria-label="切换自动换行"
          onClick={onToggleWordWrap}
        >
          <WrapText size={14} />
        </button>

        {/* 清空编辑器按钮。 */}
        <button
          type="button"
          className={iconButtonClass}
          disabled={loading || !hasContent}
          title="清空编辑器"
          aria-label="清空编辑器"
          onClick={onClear}
        >
          <Eraser size={14} />
        </button>

        {/* DBX 风格交互式事务控制区：仅支持事务的数据源展示。 */}
        {supportsInteractiveTransaction && (
          <>
            <div className="mx-1 h-4 w-[1px] bg-base-300" />

            {/* 事务模式选择器（Auto / Manual / Smart）。 */}
            <div
              className="relative flex h-7 items-center gap-1 rounded-md border border-base-300 bg-base-100 px-1.5"
              title="切换当前控制台事务模式"
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${txModeDotClass}`} />
              <select
                className="cursor-pointer bg-transparent text-[11px] font-medium text-neutral outline-none disabled:cursor-not-allowed disabled:opacity-50"
                value={transactionMode}
                disabled={loading || transactionBusy || inTransaction}
                aria-label="事务模式"
                onChange={(event) => {
                  onChangeTransactionMode?.(event.target.value as ConsoleTransactionMode); // 行内注释：切换当前会话事务模式。
                }}
              >
                <option value="auto">自动 (Auto)</option>
                <option value="manual">手动 (Manual)</option>
                <option value="smart">智能 (Smart)</option>
              </select>
            </div>

            {/* Commit 提交事务按钮。 */}
            <button
              type="button"
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                inTransaction
                  ? "bg-emerald-500/12 text-emerald-700 hover:bg-emerald-500/20"
                  : "cursor-not-allowed text-neutral/35"
              }`}
              disabled={!inTransaction || loading || transactionBusy}
              title="提交当前事务 (COMMIT)"
              aria-label="提交事务"
              onClick={onCommitTransaction}
            >
              <Check size={13} />
              <span>Commit</span>
            </button>

            {/* Rollback 回滚事务按钮。 */}
            <button
              type="button"
              className={`inline-flex h-7 items-center gap-1 rounded-md px-2 text-[11px] font-medium transition-colors ${
                inTransaction
                  ? "bg-amber-500/12 text-amber-700 hover:bg-amber-500/20"
                  : "cursor-not-allowed text-neutral/35"
              }`}
              disabled={!inTransaction || loading || transactionBusy}
              title="回滚当前事务 (ROLLBACK)"
              aria-label="回滚事务"
              onClick={onRollbackTransaction}
            >
              <Undo2 size={13} />
              <span>Rollback</span>
            </button>

            {/* 未提交语句列表（Transaction Log）徽标与弹层。 */}
            {inTransaction && (
              <div className="relative">
                <button
                  type="button"
                  className="inline-flex h-6 items-center gap-1 rounded-full bg-amber-500/15 px-2 text-[10px] font-medium text-amber-800 hover:bg-amber-500/25"
                  title="查看未提交事务语句 (Transaction Log)"
                  onClick={() => setTxLogOpen((prev) => !prev)}
                >
                  <ListChecks size={12} />
                  <span>未提交 {uncommittedSqls.length}</span>
                </button>
                {txLogOpen && (
                  <div className="absolute left-0 top-full z-[90] mt-1.5 w-[320px] rounded-lg border border-base-300 bg-base-100 p-2 shadow-xl">
                    <div className="mb-1.5 flex items-center justify-between border-b border-base-200 pb-1">
                      <span className="text-[11px] font-semibold text-neutral">未提交事务语句 ({uncommittedSqls.length})</span>
                      <button
                        type="button"
                        className="text-[11px] text-neutral/60 hover:text-neutral"
                        onClick={() => setTxLogOpen(false)}
                      >
                        关闭
                      </button>
                    </div>
                    {uncommittedSqls.length === 0 ? (
                      <div className="py-2 text-[11px] text-neutral/60">当前会话已开启事务，暂无写操作记录。</div>
                    ) : (
                      <div className="max-h-44 space-y-1 overflow-y-auto font-mono text-[11px] text-neutral/80">
                        {uncommittedSqls.map((sql, idx) => (
                          <div key={`${idx}-${sql.slice(0, 16)}`} className="truncate rounded bg-base-200/60 px-2 py-1" title={sql}>
                            {idx + 1}. {sql}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        )}
      </div>

      {/* 右侧状态与数据源绑定选择器。 */}
      <div className="flex items-center gap-2">
        <span className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[10px] font-semibold text-neutral/70">
          {queryLanguageLabel}
        </span>
        <DataSourceSelector
          sources={sources}
          selectedSourceId={selectedSourceId}
          disabled={loading}
          compact
          allowClear={false}
          placeholder="绑定数据源"
          onChange={onChangeSource}
        />
      </div>
    </div>
  );
}
