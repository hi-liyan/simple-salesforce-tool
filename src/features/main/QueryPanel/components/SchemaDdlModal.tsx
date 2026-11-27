import { Check, Copy, X } from "lucide-react";
import { useState } from "react";

type SchemaDdlModalProps = {
  // 是否打开弹窗。
  open: boolean;
  // 标题文本（例如 "存储过程 xxx 定义"）。
  title: string;
  // DDL 源码文本。
  ddlText: string;
  // 是否处于加载中。
  loading: boolean;
  // 加载失败错误信息。
  errorText: string;
  // 关闭弹窗回调。
  onClose: () => void;
};

// 只读 DDL 定义查看弹窗（用于存储过程/函数、触发器、定时事件）。
export function SchemaDdlModal({
  open,
  title,
  ddlText,
  loading,
  errorText,
  onClose
}: SchemaDdlModalProps) {
  const [copied, setCopied] = useState(false);

  if (!open) return null;

  const handleCopy = async () => {
    if (!ddlText) return;
    await navigator.clipboard.writeText(ddlText);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1500);
  };

  return (
    /* 弹窗遮罩。 */
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4">
      {/* 浮岛弹窗主体。 */}
      <div className="flex max-h-[80vh] w-full max-w-[680px] flex-col rounded-xl border border-base-300 bg-white shadow-xl">
        {/* 标题栏与复制按钮。 */}
        <div className="flex items-center justify-between border-b border-base-200 px-4 py-3">
          <h3 className="truncate text-[13px] font-semibold text-base-content">{title}</h3>
          <div className="flex items-center gap-1.5">
            {ddlText && !loading && (
              <button
                type="button"
                className="btn btn-ghost btn-xs gap-1 text-[11px]"
                onClick={() => void handleCopy()}
              >
                {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                {copied ? "已复制" : "复制 DDL"}
              </button>
            )}
            <button
              type="button"
              className="btn btn-ghost btn-xs btn-square"
              onClick={onClose}
              aria-label="关闭弹窗"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* 内容展示区。 */}
        <div className="min-h-[180px] flex-1 overflow-auto p-4">
          {loading ? (
            <div className="flex h-40 items-center justify-center gap-2 text-[12px] text-base-content/60">
              <span className="loading loading-spinner loading-sm" />
              正在加载 DDL 定义...
            </div>
          ) : errorText ? (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2.5 text-[12px] text-error">
              {errorText}
            </div>
          ) : (
            <pre className="whitespace-pre-wrap break-words rounded-lg border border-base-200 bg-base-100 p-3 font-mono text-[12px] leading-[1.5] text-base-content">
              {ddlText}
            </pre>
          )}
        </div>
      </div>
    </div>
  );
}
