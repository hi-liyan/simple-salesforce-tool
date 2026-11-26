import { Plus, RotateCcw, Trash2 } from "lucide-react";
import type { TableColumnSpec, TableIndexSpec } from "../../types";

type IndexesEditorTabProps = {
  // 当前索引定义列表。
  indexes: TableIndexSpec[];
  // 当前表可用列名列表。
  availableColumns: TableColumnSpec[];
  // 是否为编辑已有表模式。
  isEditMode: boolean;
  // 索引列表变更回调。
  onChange: (next: TableIndexSpec[]) => void;
};

// 索引编辑器标签页：支持新增、切换唯一性、多列组合与删除/撤销删除。
export function IndexesEditorTab({
  indexes,
  availableColumns,
  isEditMode,
  onChange
}: IndexesEditorTabProps) {
  // 可选的有效列名。
  const columnNames = availableColumns.filter((c) => !c.markedForDrop && c.name.trim()).map((c) => c.name.trim());

  // 更新指定索引的局部字段。
  const updateIndex = (idx: number, patch: Partial<TableIndexSpec>) => {
    onChange(indexes.map((item, i) => (i === idx ? { ...item, ...patch } : item)));
  };

  // 新增空索引。
  const handleAddIndex = () => {
    const firstCol = columnNames[0] ? [columnNames[0]] : [];
    onChange([
      ...indexes,
      {
        name: `idx_${indexes.length + 1}`,
        columns: firstCol,
        unique: false,
        indexType: "BTREE",
        markedForDrop: false
      }
    ]);
  };

  // 切换索引包含的列名。
  const toggleColumnInIndex = (idx: number, colName: string) => {
    const target = indexes[idx];
    const exists = target.columns.includes(colName);
    const nextCols = exists
      ? target.columns.filter((c) => c !== colName)
      : [...target.columns, colName];
    updateIndex(idx, { columns: nextCols });
  };

  // 删除或标记删除索引。
  const handleRemoveOrToggleDrop = (idx: number) => {
    const target = indexes[idx];
    if (isEditMode && target.originalName) {
      updateIndex(idx, { markedForDrop: !target.markedForDrop });
      return;
    }
    onChange(indexes.filter((_, i) => i !== idx));
  };

  return (
    /* 索引编辑区主容器 */
    <div className="flex h-full flex-col gap-2">
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-neutral/70">
          共 {indexes.filter((i) => !i.markedForDrop).length} 个二级索引（主键索引由列编辑器中的主键勾选自动生成）
        </span>
        <button type="button" className="btn btn-xs btn-primary gap-1" onClick={handleAddIndex}>
          <Plus size={13} />
          新增索引
        </button>
      </div>

      <div className="flex-1 overflow-auto rounded-lg border border-base-300 bg-base-100">
        {indexes.length === 0 ? (
          <div className="flex h-36 items-center justify-center text-[12px] text-neutral/50">
            暂无二级索引，点击右上角“新增索引”添加
          </div>
        ) : (
          <table className="table table-xs w-full">
            <thead className="sticky top-0 z-10 bg-base-200 text-[11px] text-neutral/80">
              <tr>
                <th className="min-w-[160px]">索引名</th>
                <th className="w-16 text-center">唯一</th>
                <th className="w-28">索引类型</th>
                <th className="min-w-[260px]">包含列（按点击顺序）</th>
                <th className="w-16 text-center">操作</th>
              </tr>
            </thead>
            <tbody>
              {indexes.map((item, idx) => {
                const dropped = Boolean(item.markedForDrop);
                return (
                  <tr key={`${item.originalName || "new-idx"}-${idx}`} className={dropped ? "bg-error/10 opacity-60" : ""}>
                    <td>
                      <input
                        type="text"
                        className={`input input-bordered input-xs w-full font-mono ${dropped ? "line-through" : ""}`}
                        value={item.name}
                        disabled={dropped}
                        onChange={(e) => updateIndex(idx, { name: e.target.value })}
                        placeholder="idx_name"
                      />
                    </td>
                    <td className="text-center">
                      <input
                        type="checkbox"
                        className="checkbox checkbox-xs checkbox-primary"
                        checked={item.unique}
                        disabled={dropped}
                        onChange={(e) => updateIndex(idx, { unique: e.target.checked })}
                      />
                    </td>
                    <td>
                      <select
                        className="select select-bordered select-xs w-full font-mono"
                        value={item.indexType || "BTREE"}
                        disabled={dropped}
                        onChange={(e) => updateIndex(idx, { indexType: e.target.value })}
                      >
                        <option value="BTREE">BTREE</option>
                        <option value="HASH">HASH</option>
                        <option value="FULLTEXT">FULLTEXT</option>
                      </select>
                    </td>
                    <td>
                      <div className="flex flex-wrap gap-1 py-0.5">
                        {columnNames.map((colName) => {
                          const selected = item.columns.includes(colName);
                          return (
                            <button
                              key={colName}
                              type="button"
                              disabled={dropped}
                              className={`rounded border px-1.5 py-0.5 font-mono text-[11px] transition-colors ${
                                selected
                                  ? "border-primary bg-primary/15 text-primary"
                                  : "border-base-300 bg-base-100 text-neutral/70 hover:bg-base-200"
                              }`}
                              onClick={() => toggleColumnInIndex(idx, colName)}
                            >
                              {colName}
                            </button>
                          );
                        })}
                      </div>
                    </td>
                    <td className="text-center">
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs px-1 ${dropped ? "text-success" : "text-error"}`}
                        title={dropped ? "撤销删除" : "删除索引"}
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
