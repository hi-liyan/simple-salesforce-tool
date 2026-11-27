import { useEffect, useRef } from "react";
import { BookText, Sparkles, Table2 } from "lucide-react";
import type { AiSlashCommandItem } from "./aiPromptUtils";

type AiPromptPopoversProps = {
  // 是否显示 `@` 对象补全浮层。
  mentionOpen: boolean;
  mentionCandidates: string[];
  mentionSelectedIndex: number;
  onMentionHover: (index: number) => void;
  onSelectMention: (objectName: string) => void;
  // 是否显示 `/` 斜杠命令浮层。
  commandOpen: boolean;
  commandItems: AiSlashCommandItem[];
  commandSelectedIndex: number;
  onCommandHover: (index: number) => void;
  onSelectCommand: (item: AiSlashCommandItem) => void;
};

// `@` 引用补全与 `/` 斜杠命令浮动菜单（支持键盘上下选中自动滚动与 mousedown.prevent 保焦）。
export function AiPromptPopovers({
  mentionOpen,
  mentionCandidates,
  mentionSelectedIndex,
  onMentionHover,
  onSelectMention,
  commandOpen,
  commandItems,
  commandSelectedIndex,
  onCommandHover,
  onSelectCommand
}: AiPromptPopoversProps) {
  const mentionListRef = useRef<HTMLDivElement | null>(null);
  const commandListRef = useRef<HTMLDivElement | null>(null);

  // 键盘移动 `@` 候选高亮项时，确保其滚入可视区域。
  useEffect(() => {
    if (!mentionOpen) return;
    const item = mentionListRef.current?.querySelector<HTMLElement>(
      `[data-mention-index="${mentionSelectedIndex}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [mentionOpen, mentionSelectedIndex]);

  // 键盘移动 `/` 命令高亮项时，确保其滚入可视区域。
  useEffect(() => {
    if (!commandOpen) return;
    const item = commandListRef.current?.querySelector<HTMLElement>(
      `[data-command-index="${commandSelectedIndex}"]`
    );
    item?.scrollIntoView({ block: "nearest" });
  }, [commandOpen, commandSelectedIndex]);

  return (
    <>
      {/* `@` 对象/表名自动补全弹层。 */}
      {mentionOpen && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xl">
          <div className="border-b border-base-300/70 px-2.5 py-1 text-[10px] font-medium text-neutral/55">
            引用当前数据源对象 / 表（↑↓ 选择，Enter/Tab 插入）
          </div>
          {mentionCandidates.length === 0 ? (
            <div className="px-3 py-2 text-[11px] text-neutral/55">未匹配到表或对象</div>
          ) : (
            <div ref={mentionListRef} className="max-h-52 overflow-y-auto p-1">
              {mentionCandidates.map((name, index) => (
                <button
                  key={name}
                  type="button"
                  data-mention-index={index}
                  onMouseDown={(e) => {
                    e.preventDefault();
                    onSelectMention(name);
                  }}
                  onMouseEnter={() => onMentionHover(index)}
                  className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left font-mono text-[11px] ${
                    index === mentionSelectedIndex
                      ? "bg-primary/12 text-primary"
                      : "hover:bg-base-200/70"
                  }`}
                >
                  <Table2 size={12} className="shrink-0 opacity-70" />
                  <span className="truncate">{name}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* `/` 斜杠命令面板弹层。 */}
      {commandOpen && commandItems.length > 0 && (
        <div className="absolute bottom-full left-0 right-0 z-30 mb-1.5 overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-xl">
          <div className="border-b border-base-300/70 px-2.5 py-1 text-[10px] font-medium text-neutral/55">
            快捷斜杠命令（↑↓ 选择，Enter/Tab 执行）
          </div>
          <div ref={commandListRef} className="max-h-52 overflow-y-auto p-1">
            {commandItems.map((item, index) => (
              <button
                key={item.command}
                type="button"
                data-command-index={index}
                onMouseDown={(e) => {
                  e.preventDefault();
                  onSelectCommand(item);
                }}
                onMouseEnter={() => onCommandHover(index)}
                className={`flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left text-[11px] ${
                  index === commandSelectedIndex
                    ? "bg-primary/12 text-primary"
                    : "hover:bg-base-200/70"
                }`}
              >
                {item.type === "template" ? (
                  <BookText size={12} className="shrink-0 opacity-70" />
                ) : (
                  <Sparkles size={12} className="shrink-0 opacity-70" />
                )}
                <span className="font-mono font-medium">{item.command}</span>
                <span className="font-medium">{item.label}</span>
                <span className="ml-auto truncate text-[10px] text-neutral/55">
                  {item.description}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
