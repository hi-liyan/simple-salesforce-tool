import { useEffect, useMemo, useRef, useState } from "react";
import { BookText, Check, ChevronDown, Database, Layers, Link2, Lock } from "lucide-react";
import { getDataSourceDriver } from "../../drivers/registry";
import type { AiPromptTemplateRecord } from "../../types/ai";
import type { SalesforceSource } from "../../types";

type AiPromptContextBarProps = {
  // 全部可用数据源列表。
  sources: SalesforceSource[];
  // 当前 AI 助手实际生效的数据源 ID。
  effectiveSourceId: string;
  // 当前绑定数据源名称。
  sourceName: string;
  // 当前数据源类型。
  sourceType: string;
  // 当前数据源查询语言（如 sql / soql）。
  queryLanguage: string;
  // 当前会话是否处于“跟随工作区”模式。
  sourceFollowsWorkspace: boolean;
  // 主工作区当前数据源名称（用于“跟随当前工作区”选项提示）。
  workspaceSourceName: string;
  // 是否正在流式生成（流式生成期间禁用切换数据源）。
  streaming: boolean;
  // 切换数据源回调（传入空字符串表示恢复跟随当前工作区）。
  onSelectSourceId: (sourceId: string) => void;
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
  sources,
  effectiveSourceId,
  sourceName,
  sourceType,
  queryLanguage,
  sourceFollowsWorkspace,
  workspaceSourceName,
  streaming,
  onSelectSourceId,
  promptTemplates,
  selectedTemplateIds,
  onToggleTemplateId,
  onDeselectAllTemplates,
  templatePopoverOpen,
  onTemplatePopoverOpenChange,
  contextItemCount
}: AiPromptContextBarProps) {
  const popoverRootRef = useRef<HTMLDivElement | null>(null);
  const sourcePopoverRef = useRef<HTMLDivElement | null>(null);
  const [sourcePopoverOpen, setSourcePopoverOpen] = useState(false);

  // 按 sortOrder 与名称稳定排序数据源列表。
  const sortedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const diff = (a.sortOrder || 0) - (b.sortOrder || 0);
        if (diff !== 0) return diff;
        return a.name.localeCompare(b.name, "zh-CN");
      }),
    [sources]
  );

  // 点击弹层外部时自动关闭模板选择器或数据源选择器。
  useEffect(() => {
    if (!templatePopoverOpen && !sourcePopoverOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (templatePopoverOpen && !popoverRootRef.current?.contains(target)) {
        onTemplatePopoverOpenChange(false);
      }
      if (sourcePopoverOpen && !sourcePopoverRef.current?.contains(target)) {
        setSourcePopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [templatePopoverOpen, sourcePopoverOpen, onTemplatePopoverOpenChange]);

  const activeDriver = sourceType ? getDataSourceDriver(sourceType) : null;
  const templateLabel =
    selectedTemplateIds.length > 0 ? `模板 (${selectedTemplateIds.length})` : "模板";

  return (
    <div
      data-ai-composer-context-row
      className="mb-1.5 flex min-w-0 flex-wrap items-center gap-1.5 text-[11px] text-neutral/75"
    >
      {/* 独立数据源切换选择器（默认新建会话跟随工作区，手动切换后锁定到目标源）。 */}
      <div ref={sourcePopoverRef} className="relative min-w-0">
        <button
          type="button"
          disabled={streaming}
          title={
            sourceName
              ? `${sourceName} (${queryLanguage.toUpperCase()}) · ${
                  sourceFollowsWorkspace ? "跟随当前工作区" : "已锁定数据源"
                }（点击切换）`
              : "点击选择数据源"
          }
          onClick={() => setSourcePopoverOpen((v) => !v)}
          className={`inline-flex min-w-0 max-w-[210px] items-center gap-1 rounded-md border px-2 py-0.5 text-[10px] transition-colors disabled:cursor-not-allowed disabled:opacity-60 ${
            sourcePopoverOpen
              ? "border-primary/50 bg-primary/10 text-primary"
              : "border-base-300/80 bg-base-200/45 hover:bg-base-200/80"
          }`}
        >
          {activeDriver ? (
            <span
              className={`inline-flex shrink-0 items-center rounded px-1 py-[0.5px] text-[8.5px] font-semibold ${activeDriver.badgeClassName}`}
            >
              {activeDriver.badgeLabel}
            </span>
          ) : (
            <Database size={11} className="shrink-0 text-primary/80" />
          )}
          <span className="truncate font-medium">{sourceName || "选择数据源"}</span>
          {!sourceFollowsWorkspace && effectiveSourceId && (
            <Lock size={9} className="shrink-0 text-primary/80" />
          )}
          <ChevronDown size={10} className="shrink-0 opacity-60" />
        </button>

        {sourcePopoverOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-1.5 w-64 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-xl">
            <div className="px-2 py-1 text-[10px] font-medium text-neutral/55">
              切换当前会话数据源
            </div>
            {/* 跟随当前工作区选项 */}
            <button
              type="button"
              onClick={() => {
                onSelectSourceId("");
                setSourcePopoverOpen(false);
              }}
              className={`mb-1 flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-base-200/70 ${
                sourceFollowsWorkspace ? "bg-primary/10 font-medium text-primary" : ""
              }`}
            >
              <span className="flex min-w-0 items-center gap-1.5">
                <Link2 size={11} className="shrink-0 text-primary" />
                <span className="truncate">
                  跟随当前工作区{workspaceSourceName ? ` (${workspaceSourceName})` : ""}
                </span>
              </span>
              {sourceFollowsWorkspace && <Check size={11} className="shrink-0" />}
            </button>
            <div className="my-1 border-t border-base-300/70" />
            <div className="max-h-56 space-y-0.5 overflow-y-auto">
              {sortedSources.length === 0 && (
                <div className="px-2 py-2 text-center text-[10px] text-neutral/55">
                  暂无可用数据源
                </div>
              )}
              {sortedSources.map((src) => {
                const driver = getDataSourceDriver(src.sourceType);
                const selected = !sourceFollowsWorkspace && src.id === effectiveSourceId;
                return (
                  <button
                    key={src.id}
                    type="button"
                    onClick={() => {
                      onSelectSourceId(src.id);
                      setSourcePopoverOpen(false);
                    }}
                    className={`flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] hover:bg-base-200/70 ${
                      selected ? "bg-primary/10 font-medium text-primary" : ""
                    }`}
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <span
                        className={`inline-flex min-w-[38px] shrink-0 items-center justify-center rounded px-1 py-[1px] text-[9px] font-semibold ${driver.badgeClassName}`}
                      >
                        {driver.badgeLabel}
                      </span>
                      <span className="truncate">{src.name}</span>
                    </span>
                    {selected && <Check size={11} className="shrink-0" />}
                  </button>
                );
              })}
            </div>
          </div>
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
