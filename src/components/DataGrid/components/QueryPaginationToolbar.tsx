import React from "react";
import { ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight } from "lucide-react";
import { buildQueryPaginationState } from "../logic/queryPagination.ts";
import {
  normalizeQueryPageSize,
  PAGE_SIZE_PRESET_VALUES,
  resolveQueryPageSizeOption
} from "../../../features/main/QueryPanel/logic/queryToolbar.ts";

type QueryPaginationToolbarProps = {
  // 查询总数：用于生成分页范围与总量文案。
  totalSize: number;
  // 当前页已加载行数：用于生成当前页尾范围。
  loadedRowCount: number;
  // 当前每页条数：用于分页器下拉与范围计算。
  pageSize: number;
  // 当前结果偏移量：用于生成当前页起始范围与按钮状态。
  currentOffset: number;
  // 修改每页条数：用于回写 QueryPanel 当前 limit。
  onPageSizeChange?: (pageSize: number) => void;
  // 分页导航：用于首页/上一页/下一页/末页触发重查。
  onPageNavigate?: (action: "first" | "previous" | "next" | "last") => void;
  // 额外样式：用于在不同宿主工具栏中复用统一分页器。
  className?: string;
};

// QueryPanel 结果分页工具栏：抽离自 DataGrid 顶部条，供主工具栏复用。
export function QueryPaginationToolbar({
  totalSize,
  loadedRowCount,
  pageSize,
  currentOffset,
  onPageSizeChange,
  onPageNavigate,
  className = ""
}: QueryPaginationToolbarProps) {
  // Page Size 下拉的自定义选项值：用于 select 组件承载 prompt 入口。
  const CUSTOM_PAGE_SIZE_OPTION = "__custom__";
  // 当前分页器状态：按已加载结果生成紧凑的“1-500 of 765”文案。
  const paginationState = React.useMemo(
    () =>
      buildQueryPaginationState({
        totalSize,
        loadedRowCount,
        pageSize,
        currentOffset
      }),
    [currentOffset, loadedRowCount, pageSize, totalSize]
  );
  // 当前 Page Size 选项：复用 QueryPanel 的预设与 custom 识别逻辑。
  const pageSizeOption = React.useMemo(() => resolveQueryPageSizeOption(pageSize), [pageSize]);

  return (
    // 分页工具栏：承载 page size、范围文案与翻页入口。
    <div className={`flex items-center gap-0.5 text-[12px] text-neutral/70 ${className}`.trim()}>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-5 min-h-[20px] w-5 min-w-[20px] px-0 text-neutral/70 hover:bg-base-200 hover:text-neutral disabled:text-neutral/35"
        disabled={!paginationState.canGoFirst || !onPageNavigate}
        title="首页"
        aria-label="首页"
        onClick={() => onPageNavigate?.("first")}
      >
        <ChevronsLeft size={12} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-5 min-h-[20px] w-5 min-w-[20px] px-0 text-neutral/70 hover:bg-base-200 hover:text-neutral disabled:text-neutral/35"
        disabled={!paginationState.canGoPrevious || !onPageNavigate}
        title="上一页"
        aria-label="上一页"
        onClick={() => onPageNavigate?.("previous")}
      >
        <ChevronLeft size={12} />
      </button>
      <select
        className="select select-bordered select-xs h-5 min-h-[20px] w-[76px] border-base-300 bg-white px-1.5 text-[12px] font-medium text-neutral focus:outline-none"
        value={pageSizeOption.kind === "custom" ? CUSTOM_PAGE_SIZE_OPTION : String(pageSizeOption.value)}
        onChange={(event) => {
          const nextValue = event.target.value;
          if (!onPageSizeChange) return;
          if (nextValue === CUSTOM_PAGE_SIZE_OPTION) {
            const customInput = window.prompt("请输入 Page Size（1-2000）", String(pageSizeOption.value));
            if (customInput === null) return;
            onPageSizeChange(normalizeQueryPageSize(Number(customInput), pageSizeOption.value)); // 行内注释：自定义条数继续复用当前 limit 作为回退值。
            return;
          }
          onPageSizeChange(normalizeQueryPageSize(Number(nextValue), pageSizeOption.value)); // 行内注释：预设值直接写回当前 limit。
        }}
        title="Page Size"
        aria-label="Page Size"
      >
        {PAGE_SIZE_PRESET_VALUES.map((value) => (
          <option key={`page-size-${value}`} value={value}>
            {value}
          </option>
        ))}
        {pageSizeOption.kind === "custom" && <option value={CUSTOM_PAGE_SIZE_OPTION}>{pageSizeOption.value}</option>}
        <option value={CUSTOM_PAGE_SIZE_OPTION}>自定义...</option>
      </select>
      <span className="min-w-[72px] text-center font-medium text-neutral">{paginationState.rangeLabel}</span>
      <span>{paginationState.totalLabel}</span>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-5 min-h-[20px] w-5 min-w-[20px] px-0 text-neutral/70 hover:bg-base-200 hover:text-neutral disabled:text-neutral/35"
        disabled={!paginationState.canGoNext || !onPageNavigate}
        title="下一页"
        aria-label="下一页"
        onClick={() => onPageNavigate?.("next")}
      >
        <ChevronRight size={12} />
      </button>
      <button
        type="button"
        className="btn btn-ghost btn-xs h-5 min-h-[20px] w-5 min-w-[20px] px-0 text-neutral/70 hover:bg-base-200 hover:text-neutral disabled:text-neutral/35"
        disabled={!paginationState.canGoLast || !onPageNavigate}
        title="末页"
        aria-label="末页"
        onClick={() => onPageNavigate?.("last")}
      >
        <ChevronsRight size={12} />
      </button>
    </div>
  );
}
