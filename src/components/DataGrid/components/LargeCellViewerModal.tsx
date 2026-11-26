import { useMemo, useState } from "react";
import { Braces, Check, Copy, FileText, X } from "lucide-react";

type LargeCellViewerModalProps = {
  // 当前查看的大字段状态，为 null 时不渲染。
  target: {
    columnName: string;
    totalChars: number;
    previewText: string;
    loading: boolean;
    fullText: string | null;
    error: string;
  } | null;
  // 关闭弹窗回调。
  onClose: () => void;
};

// 大字段按需加载检视弹窗：展示截断大字段的完整内容并支持 JSON 美化与复制。
export function LargeCellViewerModal({ target, onClose }: LargeCellViewerModalProps) {
  const [prettyJson, setPrettyJson] = useState(false);
  const [copied, setCopied] = useState(false);

  const rawContent = target ? (target.fullText ?? target.previewText) : "";

  const displayContent = useMemo(() => {
    if (!prettyJson) return rawContent;
    try {
      return JSON.stringify(JSON.parse(rawContent), null, 2);
    } catch {
      return rawContent;
    }
  }, [rawContent, prettyJson]);

  if (!target) return null;

  function handleCopy() {
    void navigator.clipboard.writeText(displayContent).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
      onClick={onClose}
    >
      <div
        className="flex h-[560px] max-h-[88vh] w-[760px] max-w-[92vw] flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 弹窗顶栏。 */}
        <div className="flex h-11 shrink-0 items-center justify-between border-b border-base-300/80 px-4">
          <div className="flex items-center gap-2">
            <FileText size={15} className="text-primary" />
            <span className="text-[13px] font-semibold text-neutral">{target.columnName}</span>
            <span className="rounded bg-base-200 px-1.5 py-0.5 font-mono text-[10.5px] text-neutral/70">
              {target.totalChars.toLocaleString()} 字符
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setPrettyJson((prev) => !prev)}
              className={`btn btn-xs gap-1 rounded-lg ${prettyJson ? "btn-primary" : "btn-ghost"}`}
              title="尝试格式化为 JSON"
            >
              <Braces size={12} />
              <span>JSON 美化</span>
            </button>
            <button
              type="button"
              onClick={handleCopy}
              disabled={target.loading}
              className="btn btn-outline btn-xs gap-1 rounded-lg"
            >
              {copied ? <Check size={12} className="text-success" /> : <Copy size={12} />}
              <span>{copied ? "已复制" : "复制完整内容"}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
            >
              <X size={15} />
            </button>
          </div>
        </div>

        {/* 内容区。 */}
        <div className="relative min-h-0 flex-1 overflow-auto p-4">
          {target.loading && (
            <div className="mb-2 flex items-center gap-2 rounded-lg bg-primary/10 px-3 py-1.5 text-[12px] text-primary">
              <span className="loading loading-spinner loading-xs" />
              <span>正在按主键按需拉取完整字段内容...</span>
            </div>
          )}
          {target.error && (
            <div className="mb-2 rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-[12px] text-error">
              拉取完整内容失败（当前展示截断预览）：{target.error}
            </div>
          )}
          <pre className="whitespace-pre-wrap break-all rounded-xl border border-base-300/80 bg-base-200/35 p-3 font-mono text-[12px] leading-relaxed text-neutral">
            {displayContent}
          </pre>
        </div>
      </div>
    </div>
  );
}
