import { useMemo, useState } from "react";
import { MessageSquare, Search, Trash2, X } from "lucide-react";
import type { AiConversationRecord } from "../../types/ai";

type AiConversationDrawerProps = {
  conversations: AiConversationRecord[];
  activeConversationId: string;
  onSelect: (record: AiConversationRecord) => void;
  onDelete: (conversationId: string) => void;
  onClose: () => void;
};

// AI 历史会话抽屉：支持关键词搜索、一键恢复会话与删除。
export function AiConversationDrawer({
  conversations,
  activeConversationId,
  onSelect,
  onDelete,
  onClose
}: AiConversationDrawerProps) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.sourceName.toLowerCase().includes(q)
    );
  }, [conversations, keyword]);

  return (
    <div className="absolute inset-0 z-20 flex flex-col bg-base-100">
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300/70 px-3 text-[12px]">
        <span className="font-semibold">历史对话 ({conversations.length})</span>
        <button
          type="button"
          onClick={onClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
        >
          <X size={13} />
        </button>
      </div>

      <div className="border-b border-base-300/60 p-2">
        <label className="flex items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/35 px-2 py-1 text-[11px]">
          <Search size={12} className="text-neutral/50" />
          <input
            type="text"
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
            placeholder="搜索历史会话标题或数据源..."
            className="w-full bg-transparent outline-none"
          />
        </label>
      </div>

      <div className="flex-1 space-y-1 overflow-y-auto p-2 text-[12px]">
        {filtered.length === 0 && (
          <p className="py-8 text-center text-[11px] text-neutral/55">暂无匹配的历史会话</p>
        )}
        {filtered.map((item) => {
          const active = item.id === activeConversationId;
          return (
            <div
              key={item.id}
              className={`group flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2 transition-colors ${
                active
                  ? "border-primary/40 bg-primary/8"
                  : "border-transparent hover:border-base-300 hover:bg-base-200/50"
              }`}
            >
              <button
                type="button"
                onClick={() => {
                  onSelect(item);
                  onClose();
                }}
                className="flex min-w-0 flex-1 items-start gap-2 text-left"
              >
                <MessageSquare size={13} className="mt-0.5 shrink-0 text-primary/70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate font-medium">{item.title}</div>
                  <div className="mt-0.5 flex items-center gap-1.5 text-[10px] text-neutral/55">
                    <span>{item.sourceName || "未绑定数据源"}</span>
                    <span>·</span>
                    <span className="uppercase">{item.mode}</span>
                  </div>
                </div>
              </button>
              <button
                type="button"
                title="删除会话"
                onClick={() => onDelete(item.id)}
                className="hidden h-6 w-6 shrink-0 items-center justify-center rounded text-error/80 hover:bg-error/10 group-hover:flex"
              >
                <Trash2 size={12} />
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
