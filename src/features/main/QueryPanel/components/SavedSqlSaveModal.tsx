import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { BookmarkPlus, Pin, X } from "lucide-react";
import { api } from "../../../../api";
import type { SavedSqlQuery } from "../../../../types";

type SavedSqlSaveModalProps = {
  // 是否打开弹窗。
  open: boolean;
  // 编辑模式时传入已有条目；新建时为 null。
  editingItem: SavedSqlQuery | null;
  // 控制台全部 SQL 文本。
  fullSql: string;
  // 控制台当前选中 SQL 文本（为空表示无选区）。
  selectedSql: string;
  // 当前查询语言（mysql / soql）。
  queryLanguage: string;
  // 当前数据源 ID。
  sourceId: string;
  // 当前数据源显示名称。
  sourceName?: string;
  // 关闭弹窗回调。
  onClose: () => void;
  // 保存成功回调。
  onSaved: (saved: SavedSqlQuery) => void;
};

// 控制台保存/编辑常用 SQL 弹窗：支持保存全部 SQL 或选中 SQL，并支持追加 SQL 说明与作用域设置。
export function SavedSqlSaveModal({
  open,
  editingItem,
  fullSql,
  selectedSql,
  queryLanguage,
  sourceId,
  sourceName,
  onClose,
  onSaved
}: SavedSqlSaveModalProps) {
  const hasSelection = Boolean(selectedSql.trim());
  const [scopeMode, setScopeMode] = useState<"selected" | "all">("all");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sqlText, setSqlText] = useState("");
  const [bindCurrentSource, setBindCurrentSource] = useState(false);
  const [isPinned, setIsPinned] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!open) return;
    if (editingItem) {
      setName(editingItem.name);
      setDescription(editingItem.description || "");
      setSqlText(editingItem.sqlText);
      setBindCurrentSource(Boolean(editingItem.sourceId));
      setIsPinned(editingItem.isPinned);
      setErrorText("");
      return;
    }
    const defaultScope = hasSelection ? "selected" : "all";
    setScopeMode(defaultScope);
    setSqlText(defaultScope === "selected" ? selectedSql : fullSql);
    setName("");
    setDescription("");
    setBindCurrentSource(false);
    setIsPinned(false);
    setErrorText("");
  }, [open, editingItem, hasSelection, selectedSql, fullSql]);

  if (!open) return null;

  // 切换保存范围（全部 SQL / 选中 SQL）。
  function handleSwitchScope(nextScope: "selected" | "all") {
    setScopeMode(nextScope);
    setSqlText(nextScope === "selected" ? selectedSql : fullSql);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSql = sqlText.trim();
    if (!trimmedName) {
      setErrorText("请输入 SQL 名称。");
      return;
    }
    if (!trimmedSql) {
      setErrorText("SQL 内容不能为空。");
      return;
    }

    setSubmitting(true);
    setErrorText("");
    try {
      const saved = await api.upsertSavedSql({
        id: editingItem?.id || null,
        name: trimmedName,
        description: description.trim(),
        sqlText: trimmedSql,
        queryLanguage: editingItem?.queryLanguage || queryLanguage,
        sourceId: bindCurrentSource ? sourceId || null : null,
        isPinned
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      setErrorText(String(error));
    } finally {
      setSubmitting(false);
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/35 p-4 backdrop-blur-[1px]">
      <div className="w-full max-w-[560px] overflow-hidden rounded-xl border border-base-300 bg-base-100 shadow-2xl">
        {/* 弹窗标题栏。 */}
        <div className="flex items-center justify-between border-b border-base-200 px-4 py-3">
          <div className="flex items-center gap-2">
            <BookmarkPlus size={15} className="text-primary" />
            <h3 className="text-[13px] font-semibold text-neutral">
              {editingItem ? "编辑已保存 SQL" : "保存常用 SQL"}
            </h3>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-circle"
            aria-label="关闭弹窗"
            onClick={onClose}
          >
            <X size={14} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-3 p-4 text-[12px]">
          {/* 新建模式下支持切换保存“选中 SQL”或“全部 SQL”。 */}
          {!editingItem && (
            <div className="flex items-center justify-between rounded-lg border border-base-200 bg-base-200/40 px-3 py-2">
              <span className="font-medium text-neutral/80">保存范围</span>
              <div className="join">
                <button
                  type="button"
                  disabled={!hasSelection}
                  className={`btn join-item btn-xs ${scopeMode === "selected" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => handleSwitchScope("selected")}
                >
                  仅选中 SQL
                </button>
                <button
                  type="button"
                  className={`btn join-item btn-xs ${scopeMode === "all" ? "btn-primary" : "btn-ghost"}`}
                  onClick={() => handleSwitchScope("all")}
                >
                  控制台全部 SQL
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="mb-1 block font-medium text-neutral/80">SQL 名称 *</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：下单四表联查对账脚本"
              className="input input-bordered input-sm w-full text-[12px]"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-neutral/80">SQL 说明（可选，支持检索）</label>
            <textarea
              rows={2}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="记录该 SQL 的用途、业务背景或注意事项，后续可通过说明关键词搜索..."
              className="textarea textarea-bordered w-full text-[12px] leading-relaxed"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-neutral/80">SQL 正文 *</label>
            <textarea
              rows={6}
              value={sqlText}
              onChange={(event) => setSqlText(event.target.value)}
              className="textarea textarea-bordered w-full font-mono text-[11.5px] leading-relaxed"
            />
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-neutral/80">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={bindCurrentSource}
                disabled={!sourceId}
                onChange={(event) => setBindCurrentSource(event.target.checked)}
              />
              <span>仅限当前数据源{sourceName ? `（${sourceName}）` : ""}</span>
            </label>

            <label className="flex cursor-pointer items-center gap-1.5 text-[11.5px] text-neutral/80">
              <input
                type="checkbox"
                className="checkbox checkbox-xs"
                checked={isPinned}
                onChange={(event) => setIsPinned(event.target.checked)}
              />
              <Pin size={12} className="text-amber-600" />
              <span>置顶常用</span>
            </label>
          </div>

          {errorText && (
            <div className="rounded-lg border border-error/40 bg-error/10 px-3 py-1.5 text-[11.5px] text-error">
              {errorText}
            </div>
          )}

          <div className="flex items-center justify-end gap-2 border-t border-base-200 pt-3">
            <button type="button" className="btn btn-ghost btn-xs" onClick={onClose}>
              取消
            </button>
            <button type="submit" className="btn btn-primary btn-xs" disabled={submitting}>
              {submitting ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>,
    document.body
  );
}
