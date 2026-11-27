import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import {
  BookMarked,
  CornerDownLeft,
  GitCompareArrows,
  PencilLine,
  Pin,
  Replace,
  Search,
  TerminalSquare,
  Trash2,
  X
} from "lucide-react";
import { api } from "../../../../api";
import type { SavedSqlQuery } from "../../../../types";

type SavedSqlLibraryModalProps = {
  // 是否打开检索弹窗。
  open: boolean;
  // 当前查询语言（mysql / soql）。
  queryLanguage: string;
  // 当前数据源 ID。
  sourceId: string;
  // 当前数据源名称。
  sourceName?: string;
  // 关闭弹窗回调。
  onClose: () => void;
  // 插入到当前光标位置回调。
  onInsertAtCursor: (item: SavedSqlQuery) => void;
  // 替换当前编辑器全文回调。
  onReplaceEditor: (item: SavedSqlQuery) => void;
  // 在新控制台（标准或 Diff）打开回调。
  onOpenInNewConsole: (item: SavedSqlQuery, mode: "standard" | "diff") => void;
  // 点击编辑条目回调。
  onEditItem: (item: SavedSqlQuery) => void;
};

// 已保存常用 SQL 检索库弹窗：支持按名称/说明/正文搜索、置顶过滤、预览与一键回填/新开控制台。
export function SavedSqlLibraryModal({
  open,
  queryLanguage,
  sourceId,
  sourceName,
  onClose,
  onInsertAtCursor,
  onReplaceEditor,
  onOpenInNewConsole,
  onEditItem
}: SavedSqlLibraryModalProps) {
  const [keyword, setKeyword] = useState("");
  const [onlyCurrentSource, setOnlyCurrentSource] = useState(false);
  const [pinnedOnly, setPinnedOnly] = useState(false);
  const [items, setItems] = useState<SavedSqlQuery[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedId, setSelectedId] = useState("");

  const loadList = useCallback(async () => {
    setLoading(true);
    try {
      const rows = await api.listSavedSql({
        keyword: keyword.trim() || undefined,
        queryLanguage,
        sourceId: sourceId || undefined,
        onlyCurrentSource,
        pinnedOnly
      });
      setItems(rows);
      setSelectedId((prev) => (rows.some((item) => item.id === prev) ? prev : rows[0]?.id || ""));
    } finally {
      setLoading(false);
    }
  }, [keyword, queryLanguage, sourceId, onlyCurrentSource, pinnedOnly]);

  useEffect(() => {
    if (!open) return;
    const timer = window.setTimeout(() => {
      void loadList();
    }, 120);
    return () => window.clearTimeout(timer);
  }, [open, loadList]);

  if (!open) return null;

  const activeItem = items.find((item) => item.id === selectedId) || null;

  async function handleTogglePin(item: SavedSqlQuery) {
    const updated = await api.toggleSavedSqlPin(item.id, !item.isPinned);
    setItems((prev) => prev.map((row) => (row.id === updated.id ? updated : row)));
  }

  async function handleDelete(item: SavedSqlQuery) {
    if (!window.confirm(`确定删除已保存 SQL「${item.name}」吗？`)) return;
    await api.deleteSavedSql(item.id);
    await loadList();
  }

  return createPortal(
    <div className="fixed inset-0 z-[145] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="flex h-[76vh] max-h-[640px] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl">
        {/* 头部搜索栏。 */}
        <div className="flex items-center gap-2 border-b border-base-200 px-4 py-2.5">
          <BookMarked size={16} className="shrink-0 text-primary" />
          <span className="shrink-0 text-[13px] font-semibold text-neutral">已保存 SQL</span>

          <div className="relative ml-2 flex-1">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral/50" />
            <input
              type="text"
              value={keyword}
              onChange={(event) => setKeyword(event.target.value)}
              placeholder="搜索 SQL 名称、SQL 说明或 SQL 正文关键词..."
              className="input input-bordered input-xs h-7 w-full pl-8 text-[12px]"
              autoFocus
            />
          </div>

          <button
            type="button"
            className={`btn btn-xs ${onlyCurrentSource ? "btn-primary" : "btn-ghost"}`}
            disabled={!sourceId}
            onClick={() => setOnlyCurrentSource((prev) => !prev)}
            title={sourceName ? `仅显示 ${sourceName} 的 SQL` : "仅显示当前数据源"}
          >
            仅当前数据源
          </button>
          <button
            type="button"
            className={`btn btn-xs ${pinnedOnly ? "btn-secondary" : "btn-ghost"}`}
            onClick={() => setPinnedOnly((prev) => !prev)}
          >
            <Pin size={11} />
            <span>仅置顶</span>
          </button>

          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle"
            aria-label="关闭已保存 SQL 库"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        {/* 主体左右分栏：左列表 + 右详情预览。 */}
        <div className="flex min-h-0 flex-1">
          {/* 左侧列表。 */}
          <div className="w-[310px] shrink-0 overflow-y-auto border-r border-base-200 p-2">
            {loading && items.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-neutral/60">加载中...</div>
            ) : items.length === 0 ? (
              <div className="py-10 text-center text-[12px] text-neutral/60">
                暂无匹配的已保存 SQL
              </div>
            ) : (
              <div className="space-y-1">
                {items.map((item) => {
                  const active = item.id === selectedId;
                  return (
                    <div
                      key={item.id}
                      onClick={() => setSelectedId(item.id)}
                      className={`group cursor-pointer rounded-lg border px-2.5 py-2 transition-colors ${
                        active
                          ? "border-primary/40 bg-primary/8"
                          : "border-transparent hover:bg-base-200/70"
                      }`}
                    >
                      <div className="flex items-center gap-1.5">
                        {item.isPinned && <Pin size={11} className="shrink-0 text-amber-600" />}
                        <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-neutral">
                          {item.name}
                        </span>
                        <span className="rounded bg-base-200 px-1 py-0.5 text-[10px] uppercase text-neutral/60">
                          {item.queryLanguage}
                        </span>
                      </div>
                      {item.description ? (
                        <p className="mt-0.5 line-clamp-1 text-[11px] text-neutral/65">
                          {item.description}
                        </p>
                      ) : (
                        <p className="mt-0.5 truncate font-mono text-[10.5px] text-neutral/50">
                          {item.sqlText}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* 右侧详情与操作区。 */}
          <div className="flex min-w-0 flex-1 flex-col bg-base-200/20">
            {activeItem ? (
              <>
                <div className="border-b border-base-200 bg-base-100 px-4 py-3">
                  <div className="flex items-center justify-between gap-2">
                    <h4 className="truncate text-[13px] font-semibold text-neutral">
                      {activeItem.name}
                    </h4>
                    <div className="flex items-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => void handleTogglePin(activeItem)}
                        title={activeItem.isPinned ? "取消置顶" : "置顶"}
                      >
                        <Pin size={12} className={activeItem.isPinned ? "text-amber-600" : "text-neutral/60"} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => {
                          onClose();
                          onEditItem(activeItem);
                        }}
                        title="编辑名称、说明或 SQL"
                      >
                        <PencilLine size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs text-error"
                        onClick={() => void handleDelete(activeItem)}
                        title="删除"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                  {activeItem.description && (
                    <p className="mt-1.5 whitespace-pre-wrap rounded-md bg-base-200/55 px-2.5 py-1.5 text-[11.5px] text-neutral/80">
                      {activeItem.description}
                    </p>
                  )}
                </div>

                <div className="min-h-0 flex-1 overflow-auto p-4">
                  <pre className="whitespace-pre-wrap break-all rounded-lg border border-base-300 bg-base-100 p-3 font-mono text-[12px] leading-relaxed text-neutral">
                    {activeItem.sqlText}
                  </pre>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-base-200 bg-base-100 px-4 py-2.5">
                  <span className="text-[11px] text-neutral/55">
                    已使用 {activeItem.useCount} 次 ·{" "}
                    {activeItem.sourceId ? "绑定数据源" : "同语言通用"}
                  </span>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      type="button"
                      className="btn btn-outline btn-xs"
                      onClick={() => {
                        void api.markSavedSqlUsed(activeItem.id).catch(() => {});
                        onInsertAtCursor(activeItem);
                        onClose();
                      }}
                    >
                      <CornerDownLeft size={12} />
                      <span>插入光标处</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-secondary btn-xs"
                      onClick={() => {
                        void api.markSavedSqlUsed(activeItem.id).catch(() => {});
                        onReplaceEditor(activeItem);
                        onClose();
                      }}
                    >
                      <Replace size={12} />
                      <span>替换当前内容</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-xs"
                      onClick={() => {
                        void api.markSavedSqlUsed(activeItem.id).catch(() => {});
                        onOpenInNewConsole(activeItem, "standard");
                        onClose();
                      }}
                    >
                      <TerminalSquare size={12} />
                      <span>新控制台打开</span>
                    </button>
                    <button
                      type="button"
                      className="btn btn-primary btn-xs"
                      onClick={() => {
                        void api.markSavedSqlUsed(activeItem.id).catch(() => {});
                        onOpenInNewConsole(activeItem, "diff");
                        onClose();
                      }}
                    >
                      <GitCompareArrows size={12} />
                      <span>Diff 控制台打开</span>
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="flex flex-1 items-center justify-center text-[12px] text-neutral/55">
                请从左侧选择一条已保存 SQL 查看详情
              </div>
            )}
          </div>
        </div>
      </div>
    </div>,
    document.body
  );
}
