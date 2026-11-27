import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { api } from "../../../../api";
import type { VirtualView } from "../../../../types";

type VirtualViewModalProps = {
  // 是否打开弹窗。
  open: boolean;
  // 所属数据源 ID。
  sourceId: string;
  // 编辑态传入已有虚拟视图；新建态为 null。
  editingView: VirtualView | null;
  // 关闭弹窗回调。
  onClose: () => void;
  // 保存成功回调（通知左侧树刷新 virtual-views 分组）。
  onSaved: (saved: VirtualView) => void;
};

// 新建/编辑本地自定义虚拟视图弹窗（持久化至 SQLite，不修改远端数据库）。
export function VirtualViewModal({
  open,
  sourceId,
  editingView,
  onClose,
  onSaved
}: VirtualViewModalProps) {
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [sqlText, setSqlText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorText, setErrorText] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(editingView?.name || "");
    setDescription(editingView?.description || "");
    setSqlText(editingView?.sqlText || "SELECT * FROM ");
    setErrorText("");
  }, [editingView, open]);

  if (!open) return null;

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const trimmedName = name.trim();
    const trimmedSql = sqlText.trim();
    if (!trimmedName) {
      setErrorText("请输入虚拟视图名称");
      return;
    }
    if (!trimmedSql) {
      setErrorText("请输入关联 SQL 查询语句");
      return;
    }

    setSubmitting(true);
    setErrorText("");
    try {
      const saved = await api.upsertVirtualView({
        id: editingView?.id || null,
        sourceId,
        name: trimmedName,
        sqlText: trimmedSql,
        description: description.trim() || null
      });
      onSaved(saved);
      onClose();
    } catch (error) {
      setErrorText(String(error));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    /* 弹窗遮罩：居中展示浮岛卡片。 */
    <div className="fixed inset-0 z-[150] flex items-center justify-center bg-black/30 p-4">
      {/* 浮岛弹窗主体。 */}
      <div className="w-full max-w-[540px] rounded-xl border border-base-300 bg-white shadow-xl">
        {/* 弹窗标题栏。 */}
        <div className="flex items-center justify-between border-b border-base-200 px-4 py-3">
          <h3 className="text-[13px] font-semibold text-base-content">
            {editingView ? "编辑虚拟视图" : "新建虚拟视图"}
          </h3>
          <button
            type="button"
            className="btn btn-ghost btn-xs btn-square"
            onClick={onClose}
            aria-label="关闭弹窗"
          >
            <X size={14} />
          </button>
        </div>

        {/* 表单内容区。 */}
        <form onSubmit={handleSubmit} className="space-y-3 p-4 text-[12px]">
          <div>
            <label className="mb-1 block font-medium text-base-content/80">视图名称</label>
            <input
              type="text"
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="例如：active_orders_summary"
              className="input input-bordered input-sm w-full text-[12px]"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-base-content/80">说明（可选）</label>
            <input
              type="text"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="简要描述该虚拟视图的用途"
              className="input input-bordered input-sm w-full text-[12px]"
            />
          </div>

          <div>
            <label className="mb-1 block font-medium text-base-content/80">SQL 查询语句</label>
            <textarea
              value={sqlText}
              onChange={(event) => setSqlText(event.target.value)}
              rows={7}
              placeholder="SELECT * FROM ... LIMIT 100;"
              className="textarea textarea-bordered w-full font-mono text-[12px] leading-[1.45]"
            />
          </div>

          {errorText && (
            <div className="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-[11px] text-error">
              {errorText}
            </div>
          )}

          {/* 底部操作按钮区。 */}
          <div className="flex items-center justify-end gap-2 pt-1">
            <button type="button" className="btn btn-ghost btn-sm text-[12px]" onClick={onClose}>
              取消
            </button>
            <button
              type="submit"
              className="btn btn-primary btn-sm text-[12px]"
              disabled={submitting}
            >
              {submitting ? "保存中..." : "保存"}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
