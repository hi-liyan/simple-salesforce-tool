import { useMemo, useState } from "react";
import { SalesforceObject } from "../types";

type Props = {
  objects: SalesforceObject[];
  activeObjectName: string;
  onOpenObject: (objectItem: SalesforceObject) => void;
};

// 对象列表：紧凑模式对象树。
export function ObjectList({ objects, activeObjectName, onOpenObject }: Props) {
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
              {/* 列表项：点击后打开对象 Tab。 */}
              <button
                className={`w-full px-3 py-1.5 text-left ${selected ? "bg-primary/10 text-primary" : "hover:bg-base-100"}`}
                title={tooltip}
                onClick={() => onOpenObject(item)}
              >
                <div className="truncate text-[12px]">{item.name}</div>
                <div className="truncate text-[11px] text-neutral/70">{item.label}</div>
              </button>
              {/* 分割线。 */}
              <div className="border-b border-base-300" />
            </div>
          );
        })}
      </div>
    </div>
  );
}
