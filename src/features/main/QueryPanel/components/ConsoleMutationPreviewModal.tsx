import { createPortal } from "react-dom";
import { Check, Loader2, X } from "lucide-react";
import type { MutationPreviewSqlItem } from "../../../../types";

type ConsoleMutationPreviewModalProps = {
  // 是否打开预览弹窗。
  open: boolean;
  // 目标对象/表名列表摘要。
  targetTitle: string;
  // 是否正在加载或提交。
  loading: boolean;
  // 错误提示文本。
  error: string;
  // 待执行 SQL 预览条目列表。
  items: MutationPreviewSqlItem[];
  // 变更统计摘要。
  summary: { creates: number; updates: number; deletes: number };
  // 关闭/取消弹窗回调。
  onClose: () => void;
  // 确认提交执行回调。
  onConfirm: () => void;
};

// 控制台结果变更预览弹窗：严格执行两阶段提交（prepareMutationPlan -> 预览 -> commitMutationPlan）。
export function ConsoleMutationPreviewModal({
  open,
  targetTitle,
  loading,
  error,
  items,
  summary,
  onClose,
  onConfirm
}: ConsoleMutationPreviewModalProps) {
  if (!open) return null;

  return createPortal(
    <div className="fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      {/* 浮岛弹窗主体：展示结构化变更统计与即将下发的 SQL 清单。 */}
      <div className="flex max-h-[82vh] w-full max-w-[720px] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl">
        {/* 弹窗头部。 */}
        <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold text-neutral">确认提交控制台变更</span>
            {targetTitle && (
              <span className="rounded bg-base-200 px-2 py-0.5 font-mono text-[11px] text-neutral/80">
                {targetTitle}
              </span>
            )}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle"
            aria-label="关闭变更预览弹窗"
            onClick={onClose}
            disabled={loading}
          >
            <X size={14} />
          </button>
        </div>

        {/* 统计栏。 */}
        <div className="flex items-center gap-3 border-b border-base-200 bg-base-200/40 px-4 py-2 text-[12px]">
          <span className="text-neutral/75">即将执行：</span>
          {summary.creates > 0 && (
            <span className="rounded bg-emerald-500/15 px-2 py-0.5 font-medium text-emerald-700">
              新增 {summary.creates}
            </span>
          )}
          {summary.updates > 0 && (
            <span className="rounded bg-amber-500/15 px-2 py-0.5 font-medium text-amber-700">
              更新 {summary.updates}
            </span>
          )}
          {summary.deletes > 0 && (
            <span className="rounded bg-rose-500/15 px-2 py-0.5 font-medium text-rose-700">
              删除 {summary.deletes}
            </span>
          )}
        </div>

        {/* 预览 SQL 列表区域。 */}
        <div className="min-h-[160px] flex-1 space-y-2 overflow-y-auto p-4">
          {error && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
              {error}
            </div>
          )}

          {loading && items.length === 0 ? (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-neutral/70">
              <Loader2 size={14} className="animate-spin" />
              <span>正在生成待执行 SQL 预览...</span>
            </div>
          ) : items.length === 0 ? (
            <div className="py-8 text-center text-[12px] text-neutral/60">
              暂无需要执行的 SQL 变更语句。
            </div>
          ) : (
            items.map((item, idx) => (
              <div
                key={`${item.op}-${item.operationIndex}-${idx}`}
                className="rounded-lg border border-base-300 bg-base-200/35 p-2.5"
              >
                <div className="mb-1 flex items-center gap-2 text-[11px] font-medium text-neutral/70">
                  <span className="uppercase">{item.op}</span>
                  <span>#{item.operationIndex + 1}</span>
                </div>
                <pre className="whitespace-pre-wrap break-all font-mono text-[11.5px] text-neutral">
                  {item.previewSql}
                </pre>
              </div>
            ))
          )}
        </div>

        {/* 弹窗底部操作栏。 */}
        <div className="flex items-center justify-end gap-2 border-t border-base-300 px-4 py-2.5">
          <button
            type="button"
            className="btn btn-ghost btn-xs"
            onClick={onClose}
            disabled={loading}
          >
            取消
          </button>
          <button
            type="button"
            className="btn btn-primary btn-xs"
            onClick={onConfirm}
            disabled={loading || Boolean(error) || items.length === 0}
          >
            {loading ? <Loader2 size={12} className="animate-spin" /> : <Check size={12} />}
            <span>确认执行 ({items.length})</span>
          </button>
        </div>
      </div>
    </div>,
    document.body
  );
}
