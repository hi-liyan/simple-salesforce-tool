import { ChevronDown, RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSystemLogsQuery } from "../../../queries/salesforce";
import { buildSystemLogContent, shouldCollapseSystemLogContent } from "./systemLogContent";

// 系统日志面板：展示后端持久化日志并支持分页。
export function SystemLogsPanel() {
  // 当前页码（从 1 开始）。
  const [page, setPage] = useState(1);
  // 已展开的日志内容集合：key 为日志 ID。
  const [expandedLogIds, setExpandedLogIds] = useState<Record<number, boolean>>({});
  // 每页条数。
  const pageSize = 30;
  const { data, isFetching, isLoading, refetch, error } = useSystemLogsQuery(page, pageSize);

  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  useEffect(() => {
    // 进入页面先刷新一次，避免看到旧缓存。
    void refetch();

    // 面板挂载期间轮询刷新。
    const timer = window.setInterval(() => {
      void refetch();
    }, 5000);

    return () => {
      window.clearInterval(timer);
    };
  }, [refetch]);

  // 翻页后清空展开态，避免旧页展开状态串到新页。
  useEffect(() => {
    setExpandedLogIds({});
  }, [page]);

  // 切换单条日志的展开/折叠状态。
  function toggleLogExpanded(logId: number) {
    setExpandedLogIds((current) => ({
      ...current,
      [logId]: !current[logId]
    }));
  }

  return (
    // 外层容器：保持原结构为顶部工具栏 + 内容区。
    <div className="flex min-h-0 flex-1 flex-col">
      {/* 顶部工具栏。 */}
      <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
        <h2 className="text-[14px] font-semibold">系统日志</h2>
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={14} />
            刷新
          </button>
          <button className="btn btn-sm" disabled={page <= 1 || isFetching} onClick={() => setPage((current) => Math.max(1, current - 1))}>
            上一页
          </button>
          <span className="text-[12px] text-neutral/70">
            第 {page} / {totalPages} 页（共 {total} 条）
          </span>
          <button
            className="btn btn-sm"
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((current) => Math.min(totalPages, current + 1))}
          >
            下一页
          </button>
        </div>
      </div>

      {/* 日志内容区。 */}
      <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
        {isLoading && (
          <div className="flex items-center gap-2">
            <span className="loading loading-spinner" style={{ width: 16, height: 16 }} />
            <span className="text-[12px] text-neutral/70">正在加载系统日志...</span>
          </div>
        )}

        {!isLoading && error && <p className="text-[12px] text-error">加载系统日志失败：{String(error)}</p>}

        {!isLoading && !error && (data?.items?.length ?? 0) === 0 && <p className="text-[12px] text-neutral/70">暂无系统日志。</p>}

        {!isLoading &&
          !error &&
          data?.items.map((item) => {
            // 统一日志正文：将 message/detail 组合为单一可折叠内容块。
            const content = buildSystemLogContent(item.message, item.detail);
            // 长内容默认折叠，短内容直接完整展示。
            const collapsible = shouldCollapseSystemLogContent(item.message, item.detail);
            const expanded = expandedLogIds[item.id] ?? false;

            return (
              // 单条日志卡片：保留轻量列表结构，仅为正文增加折叠能力。
              <div key={item.id} className="py-2">
                {/* 日志标题：展示时间、分类、动作与执行结果。 */}
                <p className="block text-[12px] font-bold">
                  [{formatTime(item.createdAt)}] [{item.category}] [{item.action}] {item.success ? "成功" : "失败"}
                </p>
                {/* 日志元信息：用于快速定位级别、数据源与目标对象。 */}
                <p className="block text-[12px] text-neutral/70">
                  级别: {item.level} {item.sourceId ? `| 数据源: ${item.sourceId}` : ""} {item.target ? `| 目标: ${item.target}` : ""}
                </p>
                {/* 日志正文容器：长内容默认裁切，支持手动展开查看。 */}
                <div className="mt-1 rounded-md border border-base-300 bg-base-100/70 px-2 py-1.5">
                  {/* 正文文本：折叠态限制展示行数，展开态展示全部内容。 */}
                  <p className={`whitespace-pre-wrap break-all text-[12px] ${collapsible && !expanded ? "line-clamp-4 text-neutral/80" : "text-neutral/90"}`}>
                    {content}
                  </p>
                  {collapsible && (
                    // 展开按钮：仅在内容较长时出现，避免打扰短日志阅读。
                    <button
                      className="mt-1 inline-flex items-center gap-1 text-[12px] font-medium text-primary"
                      type="button"
                      onClick={() => toggleLogExpanded(item.id)}
                    >
                      {/* 箭头图标：通过旋转反馈当前展开状态。 */}
                      <ChevronDown size={14} className={`transition-transform ${expanded ? "rotate-180" : ""}`} />
                      {/* 按钮文案：明确当前操作语义。 */}
                      {expanded ? "收起" : "展开查看"}
                    </button>
                  )}
                </div>
                {/* 分隔线：维持原列表节奏。 */}
                <div className="mt-2 border-b border-base-300" />
              </div>
            );
          })}
      </div>
    </div>
  );
}

// 时间格式化：无效时间回退原值。
function formatTime(input: string): string {
  const date = new Date(input);
  if (Number.isNaN(date.getTime())) return input;
  return date.toLocaleString();
}
