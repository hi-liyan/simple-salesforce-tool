import { Eraser, FastForward, Gauge, Play, Sparkles, Square, WrapText } from "lucide-react";
import { DataSourceSelector } from "../../../../components/DataSourceSelector";
import type { SalesforceSource } from "../../../../types";

type ConsoleToolbarProps = {
  // 是否正在执行查询。
  loading: boolean;
  // 当前编辑器是否有内容。
  hasContent: boolean;
  // 当前驱动是否支持多语句批量执行。
  supportsMultiStatement: boolean;
  // 当前驱动是否支持 EXPLAIN 执行计划。
  supportsExplain: boolean;
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
};

// 控制台顶部紧凑操作栏（参考 DBX 设计：纯小 Icon 按钮 + 右侧数据源选择器）。
export function ConsoleToolbar({
  loading,
  hasContent,
  supportsMultiStatement,
  supportsExplain,
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
  onChangeSource
}: ConsoleToolbarProps) {
  const iconButtonClass =
    "inline-flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 transition-colors hover:bg-base-200 hover:text-neutral disabled:cursor-not-allowed disabled:opacity-40";

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
