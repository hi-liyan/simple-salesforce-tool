import { useMemo, useState } from "react";
import { SalesforceObject } from "../types";

type Props = {
  // 对象数据列表。
  objects: SalesforceObject[];
  // 当前激活对象名称。
  activeObjectName: string;
  // 打开对象回调。
  onOpenObject: (objectItem: SalesforceObject) => void;
  // 不可查询徽标点击回调：用于提示当前对象不可查询。
  onNotQueryableClick?: (objectItem: SalesforceObject) => void;
};

// 对象列表：紧凑模式对象树。
export function ObjectList({ objects, activeObjectName, onOpenObject, onNotQueryableClick }: Props) {
  // 关键字：用于对象过滤。
  const [keyword, setKeyword] = useState("");

  // 过滤结果：按对象名和标签模糊匹配。
  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter((item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed));
  }, [keyword, objects]);

  return (
    // 容器：保持原布局为输入框 + 可滚动列表。
    <div className="flex h-full min-h-0 flex-col">
      {/* 筛选输入框。 */}
      <input
        className="input input-bordered input-sm w-full"
        placeholder="筛选 Object"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
      />

      {/* 列表容器：支持滚动。 */}
      <div className="mt-2 min-h-0 flex-1 overflow-auto border-t border-base-300">
        {filtered.map((item) => {
          const tooltip = `名称: ${item.name}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`;
          const selected = item.name === activeObjectName;
          return (
            <div key={item.name}>
              {/* 列表项容器：左侧主按钮打开对象，右侧可选“不可查询”徽标。 */}
              <div className={`flex items-start gap-2 px-3 py-1.5 ${selected ? "bg-primary/10 text-primary" : "hover:bg-base-100"}`}>
                {/* 主按钮：点击后打开对象 Tab。 */}
                <button
                  className="min-w-0 flex-1 text-left"
                  title={tooltip}
                  type="button"
                  onClick={() => {
                    if (!item.queryable) {
                      onNotQueryableClick?.(item); // 不可查询对象：仅提示，不打开对象。
                      return;
                    }
                    onOpenObject(item); // 可查询对象：正常打开对象 Tab。
                  }}
                >
                  <div className="truncate text-[12px]">{item.name}</div>
                  <div className="truncate text-[11px] text-neutral/70">{item.label}</div>
                </button>
                {!item.queryable && (
                  <span
                    className="badge badge-sm mt-[1px] shrink-0 select-none border-0 bg-base-300 text-[10px] text-base-content"
                    title={`${item.name} 不可查询`}
                  >
                    不可查询
                  </span>
                )}
              </div>
              {/* 分割线。 */}
              <div className="border-b border-base-300" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
