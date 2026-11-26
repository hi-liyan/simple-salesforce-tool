import { useMemo, useRef, useState } from "react";
import { BookText, Send, Square } from "lucide-react";
import type { AiAssistantMode, AiPromptTemplateRecord, AiSkillAction } from "../../types/ai";

type AiPromptInputProps = {
  // 当前输入文本。
  value: string;
  onChange: (value: string) => void;
  // 当前模式。
  mode: AiAssistantMode;
  onModeChange: (mode: AiAssistantMode) => void;
  // 当前技能标签。
  action: AiSkillAction;
  onActionChange: (action: AiSkillAction) => void;
  // 当前数据源可引用的表/对象名列表。
  availableObjects: string[];
  // 自定义提示词模板。
  promptTemplates: AiPromptTemplateRecord[];
  // 是否正在流式生成。
  streaming: boolean;
  // 发送消息。
  onSend: () => void;
  // 停止生成。
  onStop: () => void;
};

const SKILL_OPTIONS: Array<{ value: AiSkillAction; label: string }> = [
  { value: "general", label: "通用" },
  { value: "generate", label: "生成" },
  { value: "explain", label: "解释" },
  { value: "optimize", label: "优化" },
  { value: "fix", label: "修复" },
  { value: "explore", label: "探索" }
];

// AI 输入区：支持 `@对象/表` 自动补全、Ask/Agent 模式与技能快捷标签、模板插入。
export function AiPromptInput({
  value,
  onChange,
  mode,
  onModeChange,
  action,
  onActionChange,
  availableObjects,
  promptTemplates,
  streaming,
  onSend,
  onStop
}: AiPromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const [templateMenuOpen, setTemplateMenuOpen] = useState(false);

  // 识别末尾 `@关键词` 触发对象/表名补全。
  const mentionMatch = useMemo(() => {
    const match = value.match(/(?:^|\s)@([A-Za-z0-9_]*)$/);
    return match ? match[1].toLowerCase() : null;
  }, [value]);

  const mentionCandidates = useMemo(() => {
    if (mentionMatch === null) return [];
    return availableObjects
      .filter((name) => !mentionMatch || name.toLowerCase().includes(mentionMatch))
      .slice(0, 8);
  }, [availableObjects, mentionMatch]);

  function applyMention(objectName: string) {
    const next = value.replace(/@([A-Za-z0-9_]*)$/, `@${objectName} `);
    onChange(next);
    textareaRef.current?.focus();
  }

  return (
    <div className="relative border-t border-base-300/80 bg-base-100 p-2.5">
      {/* `@` 对象/表名自动补全浮层。 */}
      {mentionCandidates.length > 0 && (
        <div className="absolute bottom-full left-2.5 right-2.5 z-30 mb-1 max-h-44 overflow-y-auto rounded-xl border border-base-300 bg-base-100 p-1 shadow-xl">
          <div className="px-2 py-1 text-[10px] font-medium text-neutral/55">引用当前数据源对象 / 表</div>
          {mentionCandidates.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => applyMention(name)}
              className="flex w-full items-center rounded-lg px-2 py-1 text-left font-mono text-[11px] hover:bg-primary/10 hover:text-primary"
            >
              @{name}
            </button>
          ))}
        </div>
      )}

      {/* 模式切换与快捷技能胶囊条。 */}
      <div className="mb-2 flex flex-wrap items-center gap-1">
        <div className="mr-1 inline-flex rounded-lg border border-base-300 bg-base-200/50 p-0.5 text-[10px]">
          <button
            type="button"
            onClick={() => onModeChange("ask")}
            className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
              mode === "ask" ? "bg-base-100 text-primary shadow-2xs" : "text-neutral/70"
            }`}
          >
            Ask
          </button>
          <button
            type="button"
            onClick={() => onModeChange("agent")}
            className={`rounded-md px-2 py-0.5 font-medium transition-colors ${
              mode === "agent" ? "bg-base-100 text-primary shadow-2xs" : "text-neutral/70"
            }`}
          >
            Agent
          </button>
        </div>

        {SKILL_OPTIONS.map((opt) => (
          <button
            key={opt.value}
            type="button"
            onClick={() => onActionChange(opt.value)}
            className={`rounded-md px-1.5 py-0.5 text-[10px] transition-colors ${
              action === opt.value
                ? "bg-primary/12 font-semibold text-primary"
                : "text-neutral/65 hover:bg-base-200"
            }`}
          >
            {opt.label}
          </button>
        ))}

        {promptTemplates.length > 0 && (
          <div className="relative ml-auto">
            <button
              type="button"
              title="插入提示词模板"
              onClick={() => setTemplateMenuOpen((v) => !v)}
              className="inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] text-neutral/70 hover:bg-base-200"
            >
              <BookText size={11} />
              <span>模板</span>
            </button>
            {templateMenuOpen && (
              <div className="absolute bottom-full right-0 z-30 mb-1 w-48 rounded-xl border border-base-300 bg-base-100 p-1 shadow-xl">
                {promptTemplates.map((tpl) => (
                  <button
                    key={tpl.id}
                    type="button"
                    onClick={() => {
                      onChange(value ? `${value}\n${tpl.content}` : tpl.content);
                      setTemplateMenuOpen(false);
                      textareaRef.current?.focus();
                    }}
                    className="block w-full truncate rounded-lg px-2 py-1 text-left text-[11px] hover:bg-base-200"
                  >
                    {tpl.name}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* 输入框与发送/停止按钮。 */}
      <div className="flex items-end gap-2 rounded-xl border border-base-300 bg-base-200/25 px-2.5 py-2 focus-within:border-primary/60">
        <textarea
          ref={textareaRef}
          rows={2}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              if (!streaming) onSend();
            }
          }}
          placeholder="输入需求（Enter 发送，Shift+Enter 换行，@ 引用表/对象）..."
          className="max-h-32 min-h-[42px] flex-1 resize-none bg-transparent text-[12px] leading-relaxed outline-none"
        />
        {streaming ? (
          <button
            type="button"
            title="停止生成"
            onClick={onStop}
            className="btn btn-error btn-xs h-7 w-7 shrink-0 rounded-lg p-0"
          >
            <Square size={12} />
          </button>
        ) : (
          <button
            type="button"
            title="发送"
            disabled={!value.trim()}
            onClick={onSend}
            className="btn btn-primary btn-xs h-7 w-7 shrink-0 rounded-lg p-0"
          >
            <Send size={12} />
          </button>
        )}
      </div>
    </div>
  );
}
