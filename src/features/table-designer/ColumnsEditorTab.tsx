import { ArrowDown, ArrowUp, Plus, RotateCcw, Trash2 } from "lucide-react";
import type { TableColumnSpec } from "../../types";

// 常用 MySQL 字段类型预设列表。
const COMMON_MYSQL_TYPES = [
  "bigint",
  "bigint unsigned",
  "int",
  "tinyint(1)",
  "varchar(64)",
  "varchar(128)",
  "varchar(255)",
  "text",
  "longtext",
  "decimal(12,2)",
  "datetime",
  "timestamp",
  "date",
  "json",
  "blob"
];

type ColumnsEditorTabProps = {
  // 当前列定义列表。
  columns: TableColumnSpec[];
  // 是否处于编辑已有表模式。
  isEditMode: boolean;
  // 列列表变更回调。
  onChange: (next: TableColumnSpec[]) => void;
};

// 列结构编辑器标签页：支持新增、删除/标记删除、排序、类型/主键/自增/默认值编辑。
export function ColumnsEditorTab({ columns, isEditMode, onChange }: ColumnsEditorTabProps) {
  // 更新指定索引列的局部属性。
  const updateColumn = (index: number, patch: Partial<TableColumnSpec>) => {
    const next = columns.map((col, idx) => (idx === index ? { ...col, ...patch } : col));
    onChange(next);
  };

  // 新增默认列定义。
  const handleAddColumn = () => {
    onChange([
      ...columns,
      {
        name: `col_${columns.length + 1}`,
        dataType: "varchar(128)",
        nullable: true,
        isPrimaryKey: false,
        autoIncrement: false,
        defaultValue: null,
        comment: "",
        markedForDrop: false
      }
    ]);
  };

  // 上下移动列位置。
  const handleMove = (index: number, delta: -1 | 1) => {
    const target = index + delta;
    if (target < 0 || target >= columns.length) return;
    const next = [...columns];
    const [item] = next.splice(index, 1);
    next.splice(target, 0, item);
    onChange(next);
  };

  // 删除新建列，或对已有列切换“标记删除”状态。
  const handleRemoveOrToggleDrop = (index: number) => {
    const target = columns[index];
    if (isEditMode && target.originalName) {
      updateColumn(index, { markedForDrop: !target.markedForDrop });
      return;
    }
    onChange(columns.filter((_, idx) => idx !== index));
  };

  return (
    /* 列编辑区主容器 */
    <div className="flex h-full flex-col gap-2">
      {/* 顶部操作栏与快捷列类型 datalist */}
      <div className="flex items-center justify-between">
        <span className="text-[12px] text-neutral/70">
          共 {columns.filter((c) => !c.markedForDrop).length} 个有效列
          {isEditMode ? "（已有列删除会先标记并在预览中生成 DROP COLUMN）" : ""}
        </span>
        <button
          type="button"
          className="btn btn-xs btn-primary gap-1"
          onClick={handleAddColumn}
        >
          <Plus size={13} />
          新增列
        </button>
      </div>

      <datalist id="mysql-column-type-presets">
        {COMMON_MYSQL_TYPES.map((typeName) => (
          <option key={typeName} value={typeName} />
        ))}
      </datalist>

      {/* 可滚动列定义表格 */}
      <div className="flex-1 overflow-auto rounded-lg border border-base-300 bg-base-100">
        <table className="table table-xs w-full">
          <thead className="sticky top-0 z-10 bg-base-200 text-[11px] text-neutral/80">
            <tr>
              <th className="w-8">#</th>
              <th className="min-w-[140px]">列名</th>
              <th className="min-w-[140px]">数据类型</th>
              <th className="w-14 text-center">允许空</th>
              <th className="w-12 text-center">主键</th>
              <th className="w-12 text-center">自增</th>
              <th className="min-w-[120px]">默认值</th>
              <th className="min-w-[150px]">注释</th>
              <th className="w-24 text-center">操作</th>
            </tr>
          </thead>
          <tbody>
            {columns.map((col, idx) => {
              const dropped = Boolean(col.markedForDrop);
              return (
                <tr key={`${col.originalName || "new"}-${idx}`} className={dropped ? "bg-error/10 opacity-60" : ""}>
                  <td className="text-[11px] text-neutral/60">{idx + 1}</td>
                  <td>
                    <input
                      type="text"
                      className={`input input-bordered input-xs w-full font-mono ${dropped ? "line-through" : ""}`}
                      value={col.name}
                      disabled={dropped}
                      onChange={(e) => updateColumn(idx, { name: e.target.value })}
                      placeholder="column_name"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      list="mysql-column-type-presets"
                      className="input input-bordered input-xs w-full font-mono"
                      value={col.dataType}
                      disabled={dropped}
                      onChange={(e) => updateColumn(idx, { dataType: e.target.value })}
                      placeholder="varchar(128)"
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={col.nullable}
                      disabled={dropped || col.isPrimaryKey}
                      onChange={(e) => updateColumn(idx, { nullable: e.target.checked })}
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs checkbox-primary"
                      checked={col.isPrimaryKey}
                      disabled={dropped}
                      onChange={(e) =>
                        updateColumn(idx, {
                          isPrimaryKey: e.target.checked,
                          nullable: e.target.checked ? false : col.nullable
                        })
                      }
                    />
                  </td>
                  <td className="text-center">
                    <input
                      type="checkbox"
                      className="checkbox checkbox-xs"
                      checked={col.autoIncrement}
                      disabled={dropped}
                      onChange={(e) => updateColumn(idx, { autoIncrement: e.target.checked })}
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input input-bordered input-xs w-full font-mono"
                      value={col.defaultValue ?? ""}
                      disabled={dropped}
                      onChange={(e) =>
                        updateColumn(idx, {
                          defaultValue: e.target.value === "" ? null : e.target.value
                        })
                      }
                      placeholder="无 / CURRENT_TIMESTAMP"
                    />
                  </td>
                  <td>
                    <input
                      type="text"
                      className="input input-bordered input-xs w-full"
                      value={col.comment}
                      disabled={dropped}
                      onChange={(e) => updateColumn(idx, { comment: e.target.value })}
                      placeholder="字段说明"
                    />
                  </td>
                  <td>
                    <div className="flex items-center justify-center gap-1">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        title="上移"
                        disabled={idx === 0 || dropped}
                        onClick={() => handleMove(idx, -1)}
                      >
                        <ArrowUp size={12} />
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs px-1"
                        title="下移"
                        disabled={idx === columns.length - 1 || dropped}
                        onClick={() => handleMove(idx, 1)}
                      >
                        <ArrowDown size={12} />
                      </button>
                      <button
                        type="button"
                        className={`btn btn-ghost btn-xs px-1 ${dropped ? "text-success" : "text-error"}`}
                        title={dropped ? "撤销删除" : "删除列"}
                        onClick={() => handleRemoveOrToggleDrop(idx)}
                      >
                        {dropped ? <RotateCcw size={12} /> : <Trash2 size={12} />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
