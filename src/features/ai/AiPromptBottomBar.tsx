import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowUp,
  Bot,
  Check,
  ChevronDown,
  Cpu,
  Hourglass,
  MessageSquareText,
  Plus,
  Search,
  Square
} from "lucide-react";
import type { AiAssistantMode, AiConfigView, AiSkillAction } from "../../types/ai";
import { AI_SKILL_OPTIONS } from "./aiPromptUtils";

type AiPromptBottomBarProps = {
  // 当前运行模式（ask / agent）。
  mode: AiAssistantMode;
  onModeChange: (mode: AiAssistantMode) => void;
  // 当前快捷技能动作。
  action: AiSkillAction;
  onActionChange: (action: AiSkillAction) => void;
  // 模型配置列表与当前选中配置 ID。
  configs: AiConfigView[];
  selectedConfigId: string;
  onSelectConfigId: (configId: string) => void;
  // 附件选择点击回调。
  onClickAttach: () => void;
  // 是否正在流式生成、是否可发送、是否有排队中任务。
  streaming: boolean;
  canSubmit: boolean;
  onSend: () => void;
  onQueueSend: () => void;
  onStop: () => void;
};

// 底部动作栏（参考 DBX `data-ai-composer-actions`）：附件按钮、模式/技能合并选择器、模型选择器、发送/排队/停止按钮。
export function AiPromptBottomBar({
  mode,
  onModeChange,
  action,
  onActionChange,
  configs,
  selectedConfigId,
  onSelectConfigId,
  onClickAttach,
  streaming,
  canSubmit,
  onSend,
  onQueueSend,
  onStop
}: AiPromptBottomBarProps) {
  const [modePopoverOpen, setModePopoverOpen] = useState(false);
  const [modelPopoverOpen, setModelPopoverOpen] = useState(false);
  const [modelSearch, setModelSearch] = useState("");
  const modeRootRef = useRef<HTMLDivElement | null>(null);
  const modelRootRef = useRef<HTMLDivElement | null>(null);

  // 点击外部时关闭模式或模型弹层。
  useEffect(() => {
    if (!modePopoverOpen && !modelPopoverOpen) return;
    function handlePointerDown(event: MouseEvent) {
      const target = event.target as Node;
      if (modePopoverOpen && !modeRootRef.current?.contains(target)) {
        setModePopoverOpen(false);
      }
      if (modelPopoverOpen && !modelRootRef.current?.contains(target)) {
        setModelPopoverOpen(false);
      }
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [modePopoverOpen, modelPopoverOpen]);

  const activeSkill = AI_SKILL_OPTIONS.find((opt) => opt.value === action) ?? AI_SKILL_OPTIONS[0];
  const activeConfig =
    configs.find((cfg) => cfg.id === selectedConfigId) ||
    configs.find((cfg) => cfg.isDefault) ||
    configs[0] ||
    null;

  // 按关键词过滤模型配置。
  const filteredConfigs = useMemo(() => {
    const q = modelSearch.trim().toLowerCase();
    if (!q) return configs;
    return configs.filter(
      (cfg) =>
        cfg.name.toLowerCase().includes(q) ||
        cfg.model.toLowerCase().includes(q) ||
        cfg.provider.toLowerCase().includes(q)
    );
  }, [configs, modelSearch]);

  return (
    <div
      data-ai-composer-actions
      className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5"
    >
      {/* 附件上传 `+` 按钮。 */}
      <button
        type="button"
        title="附加文件或图片（支持拖拽/粘贴）"
        onClick={onClickAttach}
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200 hover:text-neutral"
      >
        <Plus size={14} />
      </button>

      {/* 模式 + 技能合并选择器（对齐 DBX Combined mode + action selector）。 */}
      <div ref={modeRootRef} className="relative">
        <button
          type="button"
          title="切换 Ask/Agent 模式与技能动作"
          onClick={() => setModePopoverOpen((v) => !v)}
          className="inline-flex h-7 items-center gap-1 whitespace-nowrap rounded-lg border border-base-300/90 bg-base-100 px-2 text-[11px] text-neutral/80 hover:bg-base-200/70"
        >
          {mode === "agent" ? (
            <Bot size={12} className="shrink-0 text-primary" />
          ) : (
            <MessageSquareText size={12} className="shrink-0 text-primary" />
          )}
          <span className="font-medium">
            {mode === "agent" ? "Agent" : "Ask"} · {activeSkill.label}
          </span>
          <ChevronDown size={11} className="shrink-0 opacity-60" />
        </button>

        {modePopoverOpen && (
          <div className="absolute bottom-full left-0 z-30 mb-1.5 w-56 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-xl">
            {/* Ask / Agent 双模式 Tab。 */}
            <div className="mb-1.5 flex items-center gap-1 rounded-lg bg-base-200/60 p-0.5">
              <button
                type="button"
                onClick={() => onModeChange("ask")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  mode === "ask"
                    ? "bg-base-100 font-semibold text-primary shadow-2xs"
                    : "text-neutral/70 hover:text-neutral"
                }`}
              >
                <MessageSquareText size={11} />
                <span>Ask</span>
              </button>
              <button
                type="button"
                onClick={() => onModeChange("agent")}
                className={`flex flex-1 items-center justify-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors ${
                  mode === "agent"
                    ? "bg-base-100 font-semibold text-primary shadow-2xs"
                    : "text-neutral/70 hover:text-neutral"
                }`}
              >
                <Bot size={11} />
                <span>Agent</span>
              </button>
            </div>

            <div className="my-1 border-t border-base-300/70" />

            {/* 技能动作列表。 */}
            <div className="max-h-52 space-y-0.5 overflow-y-auto">
              {AI_SKILL_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  type="button"
                  onClick={() => {
                    onActionChange(opt.value);
                    setModePopoverOpen(false);
                  }}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${
                    action === opt.value
                      ? "bg-primary/10 font-medium text-primary"
                      : "hover:bg-base-200/70"
                  }`}
                >
                  <span className="flex-1">
                    <span className="block">{opt.label}</span>
                    <span className="block text-[10px] text-neutral/55">{opt.description}</span>
                  </span>
                  {action === opt.value && <Check size={12} className="shrink-0" />}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      <span className="min-w-0 flex-1" />

      {/* 模型配置选择器 Popover（带搜索过滤）。 */}
      {configs.length > 0 && (
        <div ref={modelRootRef} className="relative min-w-0">
          <button
            type="button"
            title={activeConfig ? `${activeConfig.name} (${activeConfig.model})` : "选择模型"}
            onClick={() => setModelPopoverOpen((v) => !v)}
            className="inline-flex h-7 max-w-[160px] items-center gap-1 rounded-lg border border-base-300/90 bg-base-100 px-2 text-[11px] text-neutral/80 hover:bg-base-200/70"
          >
            <Cpu size={11} className="shrink-0 text-primary/80" />
            <span className="truncate">{activeConfig?.model || activeConfig?.name || "选择模型"}</span>
            <ChevronDown size={11} className="shrink-0 opacity-60" />
          </button>

          {modelPopoverOpen && (
            <div className="absolute bottom-full right-0 z-30 mb-1.5 w-64 rounded-xl border border-base-300 bg-base-100 p-1.5 shadow-xl">
              <div className="relative mb-1.5">
                <Search
                  size={12}
                  className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-neutral/45"
                />
                <input
                  type="text"
                  value={modelSearch}
                  onChange={(e) => setModelSearch(e.target.value)}
                  placeholder="搜索模型或配置..."
                  className="w-full rounded-lg border border-base-300 bg-base-200/35 py-1 pl-6 pr-2 text-[11px] outline-none focus:border-primary/60"
                />
              </div>
              <div className="max-h-56 space-y-0.5 overflow-y-auto">
                {filteredConfigs.length === 0 ? (
                  <div className="px-2 py-2 text-center text-[11px] text-neutral/55">
                    无匹配模型配置
                  </div>
                ) : (
                  filteredConfigs.map((cfg) => {
                    const selected = cfg.id === activeConfig?.id;
                    return (
                      <button
                        key={cfg.id}
                        type="button"
                        onClick={() => {
                          onSelectConfigId(cfg.id);
                          setModelPopoverOpen(false);
                        }}
                        className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${
                          selected ? "bg-primary/10 text-primary" : "hover:bg-base-200/70"
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{cfg.name}</span>
                          <span className="block truncate text-[10px] text-neutral/55">
                            {cfg.model}
                          </span>
                        </span>
                        {selected && <Check size={12} className="shrink-0" />}
                      </button>
                    );
                  })
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* 流式生成中：提供排队发送按钮 + 停止按钮。 */}
      {streaming ? (
        <div className="flex shrink-0 items-center gap-1">
          {canSubmit && (
            <button
              type="button"
              title="排队发送（当前回复完成后自动发送）"
              onClick={onQueueSend}
              className="inline-flex h-7 items-center gap-1 rounded-full bg-neutral px-2.5 text-[10px] font-medium text-neutral-content hover:opacity-90"
            >
              <Hourglass size={11} />
              <span>排队</span>
            </button>
          )}
          <button
            type="button"
            title="停止生成"
            onClick={onStop}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-error text-error-content hover:opacity-90"
          >
            <Square size={12} />
          </button>
        </div>
      ) : (
        <button
          type="button"
          title="发送（Enter）"
          disabled={!canSubmit}
          onClick={onSend}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary text-primary-content transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-35"
        >
          <ArrowUp size={14} />
        </button>
      )}
    </div>
  );
}
