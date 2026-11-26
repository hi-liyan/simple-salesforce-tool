import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { TableColumnSpec, TableForeignKeySpec } from "../../types";

const FK_ACTIONS = ["RESTRICT", "CASCADE", "SET NULL", "NO ACTION"];

type ForeignKeysEditorTabProps = {
  // 当前外键定义列表。
  foreignKeys: TableForeignKeySpec[];
  // 当前表可用列列表。
  availableColumns: TableColumnSpec[];
  // 是否处于编辑已有表模式。
  isEditMode: boolean;
  // 外键列表变更回调。
  onChange: (next: TableForeignKeySpec[]) => void;
};

// 外键编辑器标签页：支持外键约束名、本表列、关联表/列以及 ON DELETE/ON UPDATE 规则配置。
export function ForeignKeysEditorTab({
  foreignKeys,
  availableColumns,
  isEditMode,
  onChange
}: ForeignKeysEditorTabProps) {
  const columnNames = availableColumns.filter((c) => !c.markedForDrop && c.name.trim()).map((c) => c.name.trim());

  const updateFk = (idx: number, patch: Partial<TableForeignKeySpec>) => {
    onChange(foreignKeys.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  const handleAddFk = () => {
    onChange([
      ...foreignKeys,
      {
        name: `fk_${foreignKeys.length + 1}`,
        column: columnNames[0] || "",
        refTable: "",
        refColumn: "id",
        onDelete: "RESTRICT",
        onUpdate: "RESTRICT",
        markedForDrop: false
      }
    ]);
  };

  const handleRemoveOrToggleDrop = (idx: number) => {
    const target = foreignKeys[idx];
    if (isEditMode && target.originalName) {
      updateFk(idx, { markedForDrop: !target.markedForDrop });
      return;
    }
    onChange(foreignKeys.filter((_, i) => i !== idx));
  };

  return (
    /* 外键编辑区主容器 */
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-neutral/70">
          共 {foreignKeys.filter((f) => !f.markedForDrop).length} 个外键约束
        </span>
        <button type="button" className="btn btn-xs btn-primary gap-1" onClick={handleAddFk}>
          <Plus size={13} />
          新增外键
        </button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-base-300 bg-base-100">
        {foreignKeys.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-[12px] text-neutral/50">
            暂无外键约束，点击右上角“新增外键”添加
          </div>
        ) : (
          <table className="table table-xs w-full">
            <thead className="sticky top-0 z-10 bg-base-200 text-[11px] text-neutral/80">
              <tr>
                <th className="min-w-[130px]">约束名</th>
                <th className="min-w-[120px]">本表列</th>
                <th className="min-w-[120px]">引用表</th>
                <th className="min-w-[110px]">引用列</th>
                <th className="w-28">ON DELETE</th>
                <th className="w-28">ON UPDATE</th>
                <th className="w-14 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {foreignKeys.map((fk, idx) => {
                const dropped = Boolean(fk.markedForDrop);
                return (
                  <tr key={`${fk.originalName || "new-fk"}-${idx}`} className={dropped ? "bg-error/10 opacity-60" : ""}>
                    <td>
                      <input
                        type="text"
                        className={`input input-bordered input-xs w-full font-mono ${dropped ? "line-through" : ""}`}
                        value={fk.name}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { name: e.target.value })}
                      />
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-xs w-full font-mono"
                        value={fk.column}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { column: e.target.value })}
                      >
                        <option value="">选择列</option>
                        {columnNames.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="text"
                        className="input input-bordered input-xs w-full font-mono"
                        value={fk.refTable}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { refTable: e.target.value })}
                        placeholder="target_table"
                      />
                    </td>
                    <td>
                      <input
                        type="text"
                        className="input input-bordered input-xs w-full font-mono"
                        value={fk.refColumn}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { refColumn: e.target.value })}
                        placeholder="id"
                      />
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-xs w-full font-mono"
                        value={fk.onDelete}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { onDelete: e.target.value })}
                      >
                        {FK_ACTIONS.map((act) => (
                          <option key={act} value={act}>
                            {act}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-xs w-full font-mono"
                        value={fk.onUpdate}
                        disabled={dropped}
                        onChange={(e) => updateFk(idx, { onUpdate: e.target.value })}
                      >
                        {FK_ACTIONS.map((act) => (
                          <option key={act} value={act}>
                            {act}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs px-1 ${dropped ? "text-success" : "text-error"}`}
                        title={dropped ? "撤销删除" : "删除外键"}
                        onClick={() => handleRemoveOrToggleDrop(idx)}
                      >
                        {dropped ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
