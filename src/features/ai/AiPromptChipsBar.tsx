import { FileCode, FileText, Hourglass, Image as ImageIcon, Pencil, Table2, X } from "lucide-react";
import {
  formatAttachmentBytes,
  type AiEditorSelectionChip,
  type AiPromptAttachment,
  type AiPromptMentionChip,
  type AiQueuedPrompt
} from "./aiPromptUtils";

type AiPromptChipsBarProps = {
  // 编辑器选区 Chips。
  selectedSelections: AiEditorSelectionChip[];
  onRemoveSelection: (id: string) => void;
  // `@` 对象/表引用 Chips。
  selectedMentions: AiPromptMentionChip[];
  onRemoveMention: (raw: string) => void;
  // 文本/图片附件列表。
  attachments: AiPromptAttachment[];
  onRemoveAttachment: (id: string) => void;
  onPreviewImage: (attachment: AiPromptAttachment) => void;
  // 当前排队的待发送输入。
  queuedPrompt: AiQueuedPrompt | null;
  onEditQueuedPrompt: () => void;
  onCancelQueuedPrompt: () => void;
};

// 结构化上下文 Chips 与附件展示区（参考 DBX：选区、@引用、附件独立成 Chip 挂在输入框上方，不污染正文）。
export function AiPromptChipsBar({
  selectedSelections,
  onRemoveSelection,
  selectedMentions,
  onRemoveMention,
  attachments,
  onRemoveAttachment,
  onPreviewImage,
  queuedPrompt,
  onEditQueuedPrompt,
  onCancelQueuedPrompt
}: AiPromptChipsBarProps) {
  const hasAnything =
    selectedSelections.length > 0 ||
    selectedMentions.length > 0 ||
    attachments.length > 0 ||
    queuedPrompt !== null;

  if (!hasAnything) return null;

  return (
    <div className="mb-1.5 space-y-1.5">
      {/* 编辑器选区 Chips（来自“发送选中 SQL 到 AI”）。 */}
      {selectedSelections.length > 0 && (
        <div className="flex flex-wrap gap-1" data-ai-selection-chips>
          {selectedSelections.map((sel) => (
            <button
              key={sel.id}
              type="button"
              title={sel.sql}
              onClick={() => onRemoveSelection(sel.id)}
              className={`group inline-flex max-w-full items-center gap-1 rounded-md border bg-base-200/60 px-1.5 py-0.5 text-[11px] hover:bg-base-200 ${
                sel.truncated ? "border-warning/60" : "border-base-300"
              }`}
            >
              <FileCode size={11} className="shrink-0 text-primary" />
              <span className="truncate">{sel.label}</span>
              {sel.truncated && <span className="shrink-0 text-[9px] text-warning-content">已截断</span>}
              <X size={11} className="shrink-0 text-neutral/50 group-hover:text-neutral" />
            </button>
          ))}
        </div>
      )}

      {/* `@` 对象/表引用 Chips。 */}
      {selectedMentions.length > 0 && (
        <div className="flex flex-wrap gap-1" data-ai-mention-chips>
          {selectedMentions.map((mention) => (
            <button
              key={mention.raw}
              type="button"
              title={`引用对象 ${mention.name}（点击移除）`}
              onClick={() => onRemoveMention(mention.raw)}
              className="group inline-flex max-w-full items-center gap-1 rounded-md border border-base-300 bg-base-200/60 px-1.5 py-0.5 font-mono text-[11px] hover:bg-base-200"
            >
              <Table2 size={11} className="shrink-0 text-primary" />
              <span className="truncate">{mention.name}</span>
              <X size={11} className="shrink-0 text-neutral/50 group-hover:text-neutral" />
            </button>
          ))}
        </div>
      )}

      {/* 文本与图片附件卡片列表。 */}
      {attachments.length > 0 && (
        <div className="flex max-h-24 flex-wrap gap-1.5 overflow-y-auto pr-0.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="inline-flex max-w-[210px] items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/45 px-2 py-1 text-[10px]"
            >
              {att.kind === "image" && att.dataUrl ? (
                <button
                  type="button"
                  title="预览图片"
                  onClick={() => onPreviewImage(att)}
                  className="flex min-w-0 items-center gap-1.5 text-left hover:opacity-85"
                >
                  <img
                    src={att.dataUrl}
                    alt={att.name}
                    className="h-5 w-5 shrink-0 rounded object-cover"
                  />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{att.name}</span>
                    <span className="block text-[9px] text-neutral/55">
                      {formatAttachmentBytes(att.sizeBytes)}
                    </span>
                  </span>
                </button>
              ) : (
                <div className="flex min-w-0 items-center gap-1.5">
                  {att.kind === "image" ? (
                    <ImageIcon size={12} className="shrink-0 text-primary" />
                  ) : (
                    <FileText size={12} className="shrink-0 text-primary" />
                  )}
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{att.name}</span>
                    <span className="block text-[9px] text-neutral/55">
                      {formatAttachmentBytes(att.sizeBytes)}
                      {att.truncated ? " · 已截断" : ""}
                    </span>
                  </span>
                </div>
              )}
              <button
                type="button"
                title="移除附件"
                onClick={() => onRemoveAttachment(att.id)}
                className="ml-0.5 shrink-0 rounded p-0.5 text-neutral/50 hover:text-error"
              >
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}

      {/* 排队发送提示横幅（当 AI 正在流式生成时提前提交下一条提问）。 */}
      {queuedPrompt && (
        <div
          role="status"
          className="flex items-center gap-1.5 rounded-lg border border-primary/30 bg-primary/10 px-2 py-1 text-[11px] text-primary"
        >
          <Hourglass size={12} className="shrink-0" />
          <span className="min-w-0 flex-1 truncate">
            已排队，本轮结束后自动发送：{queuedPrompt.text || "[上下文引用]"}
          </span>
          <button
            type="button"
            title="撤回队列并继续编辑"
            onClick={onEditQueuedPrompt}
            className="shrink-0 rounded p-0.5 hover:bg-primary/15"
          >
            <Pencil size={11} />
          </button>
          <button
            type="button"
            title="取消排队"
            onClick={onCancelQueuedPrompt}
            className="shrink-0 rounded p-0.5 hover:text-error"
          >
            <X size={11} />
          </button>
        </div>
      )}
    </div>
  );
}
