import { RefreshCw } from "lucide-react";
import { useEffect, useState } from "react";
import { useSystemLogsQuery } from "../../queries/salesforce";

// 系统日志面板：展示后端持久化日志并支持分页。
export function SystemLogsPanel() {
  // 当前页码（从 1 开始）。
  const [page, setPage] = useState(1);
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
          data?.items.map((item) => (
            <div key={item.id} className="py-2">
              <p className="block text-[12px] font-bold">
                [{formatTime(item.createdAt)}] [{item.category}] [{item.action}] {item.success ? "成功" : "失败"}
              </p>
              <p className="block text-[12px] text-neutral/70">
                级别: {item.level} {item.sourceId ? `| 数据源: ${item.sourceId}` : ""} {item.target ? `| 目标: ${item.target}` : ""}
              </p>
              <p className="block text-[12px]">信息: {item.message}</p>
              {item.detail && (
                <p className="block whitespace-pre-wrap text-[12px] text-neutral/70">详情: {item.detail}</p>
              )}
              <div className="mt-2 border-b border-base-300" />
            </div>
          ))}
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
