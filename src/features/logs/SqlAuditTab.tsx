import { useCallback, useEffect, useMemo, useState } from "react";
import { CheckCircle2, Copy, Download, RefreshCw, Search, ShieldAlert, X } from "lucide-react";
import { api } from "../../api";
import type { SalesforceSource } from "../../types";

// SQL 执行审计条目（与后端 SqlExecutionAuditEntry 对齐）。
export type SqlExecutionAuditEntry = {
  id: number;
  sourceId: string;
  sourceName: string;
  environment: string;
  operationSource: string;
  rawSql: string;
  executedSql: string;
  statementType: string;
  riskLevel: string;
  planHash: string;
  rowsAffected: number;
  rowsReturned: number;
  durationMs: number;
  success: boolean;
  errorMessage: string;
  executedAt: string;
};

type SqlAuditTabProps = {
  // 可选数据源列表（用于下拉筛选）。
  sources: SalesforceSource[];
};

// SQL 执行审计视图：支持多维过滤、高密度列表与右侧详情检视器。
export function SqlAuditTab({ sources }: SqlAuditTabProps) {
  const [items, setItems] = useState<SqlExecutionAuditEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState("");
  const [sourceFilter, setSourceFilter] = useState("");
  const [opSourceFilter, setOpSourceFilter] = useState("");
  const [onlyFailed, setOnlyFailed] = useState(false);
  const [keyword, setKeyword] = useState("");
  const [selectedItem, setSelectedItem] = useState<SqlExecutionAuditEntry | null>(null);
  const [copiedKey, setCopiedKey] = useState("");

  const loadAudits = useCallback(async () => {
    setLoading(true);
    setErrorMsg("");
    try {
      const rows = (await api.listSqlExecutionAudits(sourceFilter || undefined, 200)) as unknown as SqlExecutionAuditEntry[];
      setItems(rows);
      setSelectedItem((prev) => (prev ? rows.find((r) => r.id === prev.id) || null : rows[0] || null));
    } catch (err) {
      setErrorMsg(`加载 SQL 审计失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, [sourceFilter]);

  useEffect(() => {
    void loadAudits();
  }, [loadAudits]);

  const filteredItems = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    return items.filter((item) => {
      if (opSourceFilter && item.operationSource !== opSourceFilter) return false;
      if (onlyFailed && item.success) return false;
      if (!q) return true;
      return [item.sourceName, item.rawSql, item.executedSql, item.statementType, item.errorMessage, item.planHash]
        .join(" ")
        .toLowerCase()
        .includes(q);
    });
  }, [items, opSourceFilter, onlyFailed, keyword]);

  function handleCopy(text: string, key: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedKey(key);
      setTimeout(() => setCopiedKey(""), 1500);
    });
  }

  function handleExportJson() {
    const blob = new Blob([JSON.stringify(filteredItems, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `sql-audit-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-")}.json`;
    link.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* 筛选工具栏。 */}
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-base-300/80 bg-base-200/25 px-3 py-2 text-[12px]">
        <select
          className="select select-bordered select-xs rounded-lg"
          value={sourceFilter}
          onChange={(event) => setSourceFilter(event.target.value)}
        >
          <option value="">全部数据源</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>

        <select
          className="select select-bordered select-xs rounded-lg"
          value={opSourceFilter}
          onChange={(event) => setOpSourceFilter(event.target.value)}
        >
          <option value="">全部来源</option>
          <option value="console">控制台 (console)</option>
          <option value="datagrid_commit">表格提交 (datagrid)</option>
          <option value="ai_tool">AI 工具 (ai_tool)</option>
        </select>

        <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2 py-1 text-[11px]">
          <input
            type="checkbox"
            className="checkbox checkbox-xs checkbox-error"
            checked={onlyFailed}
            onChange={(event) => setOnlyFailed(event.target.checked)}
          />
          <span>仅看失败/拦截</span>
        </label>

        <label className="flex h-7 min-w-[180px] flex-1 items-center gap-1.5 rounded-lg border border-base-300 bg-base-100 px-2">
          <Search size={12} className="shrink-0 text-neutral/50" />
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            placeholder="搜索 SQL、错误信息或 planHash..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <button type="button" onClick={() => setKeyword("")} className="text-neutral/50 hover:text-neutral">
              <X size={12} />
            </button>
          )}
        </label>

        <button type="button" className="btn btn-outline btn-xs gap-1 rounded-lg" onClick={handleExportJson} disabled={filteredItems.length === 0}>
          <Download size={12} />
          <span>导出</span>
        </button>

        <button type="button" className="btn btn-primary btn-xs gap-1 rounded-lg" onClick={() => void loadAudits()} disabled={loading}>
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          <span>刷新</span>
        </button>
      </div>

      {errorMsg && <div className="mx-3 mt-2 rounded-lg bg-error/10 px-3 py-1.5 text-[12px] text-error">{errorMsg}</div>}

      {/* 双栏主体：左侧审计表格 + 右侧 SQL 详情检视器。 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <div className="min-w-0 flex-1 overflow-auto">
          {filteredItems.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-neutral/60">
              {loading ? "正在加载审计记录..." : "暂无匹配的 SQL 执行审计记录"}
            </div>
          ) : (
            <table className="table table-xs w-full">
              <thead className="sticky top-0 z-10 bg-base-200/90 text-[11px]">
                <tr>
                  <th>状态</th>
                  <th>时间</th>
                  <th>数据源</th>
                  <th>来源</th>
                  <th>类型</th>
                  <th>执行 SQL 摘要</th>
                  <th className="text-right">耗时</th>
                </tr>
              </thead>
              <tbody>
                {filteredItems.map((item) => {
                  const active = selectedItem?.id === item.id;
                  return (
                    <tr
                      key={item.id}
                      onClick={() => setSelectedItem(item)}
                      className={`cursor-pointer text-[11.5px] transition-colors hover:bg-base-200/60 ${
                        active ? "bg-primary/10" : ""
                      }`}
                    >
                      <td>
                        {item.success ? (
                          <span className="inline-flex items-center gap-1 text-success">
                            <CheckCircle2 size={12} />
                            <span>成功</span>
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-error">
                            <ShieldAlert size={12} />
                            <span>{item.riskLevel === "blocked" ? "已拦截" : "失败"}</span>
                          </span>
                        )}
                      </td>
                      <td className="whitespace-nowrap text-neutral/70">{new Date(item.executedAt).toLocaleString()}</td>
                      <td className="max-w-[120px] truncate font-medium">{item.sourceName || item.sourceId}</td>
                      <td>
                        <span className="rounded bg-base-200 px-1.5 py-0.5 text-[10px]">{item.operationSource}</span>
                      </td>
                      <td className="font-mono text-[10.5px]">{item.statementType}</td>
                      <td className="max-w-[260px] truncate font-mono text-[11px] text-neutral/85">
                        {item.executedSql || item.rawSql}
                      </td>
                      <td className="text-right font-mono text-neutral/70">{item.durationMs} ms</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        {/* 右侧详情检视器。 */}
        {selectedItem && (
          <aside className="flex w-[340px] shrink-0 flex-col overflow-y-auto border-l border-base-300/80 bg-base-200/20 p-3 text-[12px]">
            <div className="mb-2 flex items-center justify-between">
              <span className="font-semibold text-neutral">审计详情 #{selectedItem.id}</span>
              <span className={`badge badge-xs ${selectedItem.success ? "badge-success" : "badge-error"}`}>
                {selectedItem.success ? "执行成功" : selectedItem.riskLevel}
              </span>
            </div>

            <div className="space-y-1.5 rounded-xl border border-base-300/80 bg-base-100 p-2.5 text-[11px]">
              <div className="flex justify-between">
                <span className="text-neutral/60">数据源 / 环境</span>
                <span className="font-medium">
                  {selectedItem.sourceName} ({selectedItem.environment})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/60">影响 / 返回行数</span>
                <span className="font-mono">
                  {selectedItem.rowsAffected} / {selectedItem.rowsReturned}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-neutral/60">耗时</span>
                <span className="font-mono">{selectedItem.durationMs} ms</span>
              </div>
              {selectedItem.planHash && (
                <div className="flex justify-between gap-2">
                  <span className="text-neutral/60">Plan Hash</span>
                  <span className="truncate font-mono text-[10.5px]">{selectedItem.planHash}</span>
                </div>
              )}
            </div>

            {selectedItem.errorMessage && (
              <div className="mt-2.5 rounded-xl border border-error/40 bg-error/10 p-2.5 text-[11px] text-error">
                <div className="font-semibold">错误 / 拦截原因</div>
                <p className="mt-1 whitespace-pre-wrap break-all">{selectedItem.errorMessage}</p>
              </div>
            )}

            <div className="mt-2.5">
              <div className="mb-1 flex items-center justify-between">
                <span className="text-[11px] font-medium text-neutral/75">实际下发 SQL (executedSql)</span>
                <button
                  type="button"
                  onClick={() => handleCopy(selectedItem.executedSql || selectedItem.rawSql, "executed")}
                  className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
                >
                  <Copy size={11} />
                  <span>{copiedKey === "executed" ? "已复制" : "复制"}</span>
                </button>
              </div>
              <pre className="max-h-[180px] overflow-auto whitespace-pre-wrap break-all rounded-xl bg-slate-900 p-2.5 font-mono text-[11px] text-slate-100">
                {selectedItem.executedSql || selectedItem.rawSql}
              </pre>
            </div>

            {selectedItem.rawSql && selectedItem.rawSql !== selectedItem.executedSql && (
              <div className="mt-2.5">
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-[11px] font-medium text-neutral/75">原始输入 (rawSql)</span>
                  <button
                    type="button"
                    onClick={() => handleCopy(selectedItem.rawSql, "raw")}
                    className="inline-flex items-center gap-1 text-[10.5px] text-primary hover:underline"
                  >
                    <Copy size={11} />
                    <span>{copiedKey === "raw" ? "已复制" : "复制"}</span>
                  </button>
                </div>
                <pre className="max-h-[140px] overflow-auto whitespace-pre-wrap break-all rounded-xl border border-base-300 bg-base-100 p-2.5 font-mono text-[11px] text-neutral/85">
                  {selectedItem.rawSql}
                </pre>
              </div>
            )}
          </aside>
        )}
      </div>
    </div>
  );
}
