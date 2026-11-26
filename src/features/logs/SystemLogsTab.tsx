import { useMemo, useState } from "react";
import { RefreshCw, Search, X } from "lucide-react";
import { useSystemLogsQuery } from "../../queries/salesforce";
import type { SystemLogEntry } from "../../types";
import {
  buildSystemLogContent,
  extractSystemLogStructuredFailureText,
  parseSystemLogDetail
} from "./systemLogContent";

// 系统运行日志视图：支持级别/失败筛选、搜索、分页与右侧详情检视。
export function SystemLogsTab() {
  const [page, setPage] = useState(1);
  const [levelFilter, setLevelFilter] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedLog, setSelectedLog] = useState<SystemLogEntry | null>(null);
  const pageSize = 50;

  const { data, isFetching, isLoading, refetch, error } = useSystemLogsQuery(page, pageSize);
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return (data?.items || []).filter((item) => {
      if (levelFilter && item.level.toUpperCase() !== levelFilter) return false;
      if (onlyFailed && item.success) return false;
      if (!q) return true;
      return [item.category, item.action, item.message, item.detail || "", item.target || ""]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [data?.items, levelFilter, onlyFailed, keyword]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 筛选与分页工具栏。 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-base-300/80 bg-base-200/25 px-3 py-2 text-[12px]">
        <select
          className="select select-bordered select-xs rounded-lg"
          value={levelFilter}
          onChange={(event) => setLevelFilter(event.target.value)}
        >
          <option value="">全部级别</option>
          <option value="INFO">INFO</option>
          <option value="WARN">WARN</option>
          <option value="ERROR">ERROR</option>
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2 py-1 text-[11px]">
          <input
            type="checkbox"
            className="checkbox checkbox-xs checkbox-error"
            checked={onlyFailed}
            onChange={(event) => setOnlyFailed(event.target.checked)}
          />
          <span>仅看失败</span>
        </label>

        <label className="flex h-7 min-w-[160px] flex-1 items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2">
          <Search size={12} className="shrink-0 text-neutral/50" />
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            placeholder="搜索分类、动作或日志内容..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <button type="button" onClick={() => setKeyword("")} className="text-neutral/50 hover:text-neutral">
              <X size={12} />
            </button>
          )}
        </label>

        <div className="flex items-center gap-1.5">
          <button
            type="button"
            className="btn btn-outline btn-xs rounded-lg"
            disabled={page <= 1 || isFetching}
            onClick={() => setPage((p) => Math.max(1, p - 1))}
          >
            上一页
          </button>
          <span className="text-[11px] text-neutral/70">
            {page} / {totalPages}
          </span>
          <button
            type="button"
            className="btn btn-outline btn-xs rounded-lg"
            disabled={page >= totalPages || isFetching}
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
          >
            下一页
          </button>
          <button type="button" className="btn btn-primary btn-xs gap-1 rounded-lg" onClick={() => void refetch()} disabled={isFetching}>
            <RefreshCw size={12} className={isFetching ? "animate-spin" : ""} />
            <span>刷新</span>
          </button>
        </div>
      </div>

      {error && <div className="mx-3 mt-2 rounded-lg bg-error/10 px-3 py-1.5 text-[12px] text-error">{String(error)}</div>}

      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-[12px] text-neutral/60">正在加载系统日志...</div>
          ) : filteredItems.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-neutral/60">暂无系统日志</div>
          ) : (
            <table className="table table-xs w-full">
              <thead className="sticky top-0 z-10 bg-base-200/90 text-[11px]">
                <tr>
                  <th>时间</th>
                  <th>级别</th>
                  <th>分类 / 动作</th>
                  <th>结果</th>
                  <th>摘要</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => (
                  <tr
                    key={item.id}
                    onClick={() => setSelectedLog(item)}
                    className={`cursor-pointer text-[11.5px] hover:bg-base-200/60 ${
                      selectedLog?.id === item.id ? "bg-primary/10" : ""
                    }`}
                  >
                    <td className="whitespace-nowrap text-neutral/70">{new Date(item.createdAt).toLocaleString()}</td>
                    <td>
                      <span
                        className={`rounded px-1.5 py-0.5 font-mono text-[10px] ${
                          item.level === "ERROR"
                            ? "bg-error/15 text-error"
                            : item.level === "WARN"
                              ? "bg-warning/20 text-warning"
                              : "bg-base-200 text-neutral/80"
                        }`}
                      >
                        {item.level}
                      </span>
                    </td>
                    <td className="whitespace-nowrap font-mono text-[11px]">
                      {item.category} · {item.action}
                    </td>
                    <td>
                      <span className={item.success ? "text-success" : "font-medium text-error"}>
                        {item.success ? "成功" : "失败"}
                      </span>
                    </td>
                    <td className="max-w-[300px] truncate text-neutral/85">{item.message}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        {/* 右侧日志详情检视器。 */}
        {selectedLog && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-base-300/80 bg-base-200/20 p-3 text-[12px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-neutral">日志详情 #{selectedLog.id}</span>
              <span className={`badge badge-xs ${selectedLog.success ? "badge-success" : "badge-error"}`}>
                {selectedLog.level}
              </span>
            </div>

            {(() => {
              const failureText = extractSystemLogStructuredFailureText(selectedLog.detail);
              const parsed = parseSystemLogDetail(selectedLog.detail);
              const content = buildSystemLogContent(selectedLog.message, selectedLog.detail);
              return (
                <div className="space-y-2.5 text-[11px]">
                  <div className="space-y-1 rounded-xl border border-base-300/80 bg-base-100 p-2.5">
                    <div>分类：{selectedLog.category}</div>
                    <div>动作：{selectedLog.action}</div>
                    {selectedLog.sourceId && <div>数据源：{selectedLog.sourceId}</div>}
                    {selectedLog.target && <div>目标：{selectedLog.target}</div>}
                    {parsed?.executionMode && <div>执行模式：{parsed.executionMode}</div>}
                  </div>
                  {failureText && (
                    <div className="rounded-xl border border-error/40 bg-error/10 p-2.5 text-error">
                      <div className="font-semibold">失败定位</div>
                      <p className="mt-1 whitespace-pre-wrap break-all">{failureText}</p>
                    </div>
                  )}
                  <div>
                    <div className="mb-1 font-medium text-neutral/75">完整内容</div>
                    <pre className="max-h-[320px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-base-300 bg-base-100 p-2.5 font-mono text-[11px]">
                      {content}
                    </pre>
                  </div>
                </div>
              );
            })()}
          </aside>
        )}
      </div>
    </div>
  );
}
