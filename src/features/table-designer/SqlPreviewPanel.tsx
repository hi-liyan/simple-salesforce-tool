import { Check, Copy } from "lucide-react";
import { useState } from "react";
import { copyTextToClipboard } from "../data-export/formatters";

type SqlPreviewPanelProps = {
  // 待预览的 SQL 语句列表。
  statements: string[];
  // 预览生成错误信息。
  previewError: string;
  // 是否正在计算预览。
  loading: boolean;
};

// SQL 实时预览面板：展示新建表或编辑表 Diff 生成的 DDL 语句并支持一键复制。
export function SqlPreviewPanel({ statements, previewError, loading }: SqlPreviewPanelProps) {
  const [copied, setCopied] = useState(false);
  const fullSql = statements.map((stmt) => (stmt.trim().endsWith(";") ? stmt : `${stmt};`)).join("\n\n");

  const handleCopy = async () => {
    if (!fullSql) return;
    await copyTextToClipboard(fullSql);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    /* SQL 预览浮岛面板 */
    <div className="flex h-full flex-col rounded-xl border border-base-300 bg-base-100">
      <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
        <div className="flex items-center gap-2">
          <span className="text-[12px] font-semibold text-neutral">SQL 预览</span>
          <span className="badge badge-ghost badge-xs">{statements.length} 条语句</span>
          {loading && <span className="loading loading-spinner loading-xs text-primary" />}
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-xs gap-1"
          disabled={!fullSql}
          onClick={() => void handleCopy()}
        >
          {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
          {copied ? "已复制" : "复制 SQL"}
        </button>
      </div>

      <div className="flex-1 overflow-auto p-3">
        {previewError ? (
          <div className="rounded-lg border border-error/40 bg-error/10 p-2.5 text-[12px] text-error">
            {previewError}
          </div>
        ) : fullSql ? (
          <pre className="whitespace-pre-wrap break-words font-mono text-[12px] leading-relaxed text-neutral">
            {fullSql}
          </pre>
        ) : (
          <div className="flex h-24 items-center justify-center text-[12px] text-neutral/50">
            当前表结构无待执行的变更
          </div>
        )}
      </div>
    </div>
  );
}
