import { useEffect, useRef } from "react";
import { BookText, Check, ChevronDown, Database, Layers } from "lucide-react";
import type { AiPromptTemplateRecord } from "../../types/ai";

type AiPromptContextBarProps = {
  // 当前绑定数据源名称。
  sourceName: string;
  // 当前数据源查询语言（如 sql / soql）。
  queryLanguage: string;
  // 自定义提示词模板列表。
  promptTemplates: AiPromptTemplateRecord[];
  // 当前已勾选作为上下文指令的模板 ID 列表。
  selectedTemplateIds: string[];
  // 切换模板选中状态。
  onToggleTemplateId: (templateId: string) => void;
  // 取消全选模板。
  onDeselectAllTemplates: () => void;
  // 模板选择器是否展开（受控，支持 `/template` 命令呼出）。
  templatePopoverOpen: boolean;
  // 变更模板选择器展开状态。
  onTemplatePopoverOpenChange: (open: boolean) => void;
  // 当前选中的上下文项总数（@对象 + 选区 + 附件）。
  contextItemCount: number;
};

// 顶部上下文栏（参考 DBX `data-ai-composer-context-row`）：展示当前数据源上下文、模板多选与引用计数。
export function AiPromptContextBar({
  sourceName,
  queryLanguage,
  promptTemplates,
  selectedTemplateIds,
  onToggleTemplateId,
  onDeselectAllTemplates,
  templatePopoverOpen,
  onTemplatePopoverOpenChange,
  contextItemCount
}: AiPromptContextBarProps) {
  const popoverRootRef = useRef<HTMLDivElement | null>(null);

  // 点击弹层外部时自动关闭模板选择器。
  useEffect(() => {
    if (!templatePopoverOpen) return;
    function handlePointerDown(event: MouseEvent) {
      if (!popoverRootRef.current?.contains(event.target as Node)) {
        onTemplatePopoverOpenChange(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [templatePopoverOpen, onTemplatePopoverOpenChange]);

  const templateLabel =
    selectedTemplateIds.length > 0 ? `模板 (${selectedTemplateIds.length})` : "模板";

  return (
    <div
      data-ai-composer-context-row
      className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-neutral/75"
    >
      {/* 当前绑定数据源与语言标识。 */}
      <div
        title={sourceName ? `${sourceName} (${queryLanguage.toUpperCase()})` : "未选择数据源"}
        className="inline-flex min-w-0 max-w-[170px] items-center gap-1 rounded-md border border-base-300/80 bg-base-200/45 px-2 py-0.5 text-[10px]"
      >
        <Database size={11} className="shrink-0 text-primary/80" />
        <span className="truncate font-medium">{sourceName || "未绑定数据源"}</span>
        {queryLanguage && (
          <span className="shrink-0 rounded bg-base-100 px-1 text-[9px] uppercase text-neutral/60">
            {queryLanguage}
          </span>
        )}
      </div>

      {/* 上下文引用数量徽章（仅在存在结构化 Chip 或附件时显示）。 */}
      {contextItemCount > 0 && (
        <span
          title="已挂载的结构化上下文数量（@对象 / 选区 / 附件）"
          className="inline-flex items-center gap-1 rounded-md bg-primary/10 px-1.5 py-0.5 text-[10px] font-medium text-primary"
        >
          <Layers size={10} />
          <span>上下文 {contextItemCount}</span>
        </span>
      )}

      {/* 提示词模板多选 Popover（对齐 DBX 模板上下文勾选）。 */}
      {promptTemplates.length > 0 && (
        <div ref={popoverRootRef} className="relative ml-auto">
          <button
            type="button"
            title="选择附加到本轮对话的提示词模板"
            onClick={() => onTemplatePopoverOpenChange(!templatePopoverOpen)}
            className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors ${
              selectedTemplateIds.length > 0
                ? "border-primary/40 bg-primary/10 font-medium text-primary"
                : "border-base-300/80 text-neutral/70 hover:bg-base-200/70"
            }`}
          >
            <BookText size={11} className="shrink-0" />
            <span>{templateLabel}</span>
            <ChevronDown size={11} className="shrink-0 opacity-70" />
          </button>

          {templatePopoverOpen && (
            <div className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-xl">
              <div className="px-2 py-1 text-[10px] font-medium text-neutral/55">
                勾选模板作为本轮指令上下文
              </div>
              <div className="max-h-56 overflow-y-auto">
                {promptTemplates.map((tpl) => {
                  const checked = selectedTemplateIds.includes(tpl.id);
                  return (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => onToggleTemplateId(tpl.id)}
                      className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-base-200/70"
                    >
                      <span
                        className={`mt-0.5 flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border ${
                          checked
                            ? "border-primary bg-primary text-primary-content"
                            : "border-base-300 bg-base-100"
                        }`}
                      >
                        {checked && <Check size={10} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{tpl.name}</span>
                        <span className="block truncate text-[10px] text-neutral/55">
                          {tpl.content.slice(0, 60)}
                        </span>
                      </span>
                    </button>
                  );
                })}
              </div>
              {selectedTemplateIds.length > 0 && (
                <div className="mt-1 border-t border-base-300/70 pt-1">
                  <button
                    type="button"
                    onClick={onDeselectAllTemplates}
                    className="w-full rounded-lg px-2 py-1 text-left text-[10px] text-neutral/70 hover:bg-base-200/70"
                  >
                    取消全部模板
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
