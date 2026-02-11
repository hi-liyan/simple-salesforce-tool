import { useMemo, useState } from "react";
import { SalesforceObject } from "../types";

type Props = {
  objects: SalesforceObject[];
  activeObjectName: string;
  onOpenObject: (objectItem: SalesforceObject) => void;
};

// 对象列表：鼠标悬停显示完整信息，点击打开对象标签页。
export function ObjectList({ objects, activeObjectName, onOpenObject }: Props) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter(
      (item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed)
    );
  }, [keyword, objects]);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <input
        className="w-full rounded border border-sky-300 bg-white px-2 py-1.5 text-xs text-sky-900 outline-none focus:border-[#0176d3]"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="筛选 Object"
      />

      <div className="mt-2 min-h-0 flex-1 overflow-auto rounded border border-sky-200 bg-white">
        {filtered.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`w-full border-b border-sky-100 px-2 py-1.5 text-left text-xs hover:bg-sky-50 ${
              item.name === activeObjectName ? "bg-sky-100 text-[#0176d3]" : "text-sky-900"
            }`}
            onClick={() => onOpenObject(item)}
            title={`名称: ${item.name}\n标签: ${item.label}\n可查询: ${item.queryable}\n可新增: ${item.createable}\n可更新: ${item.updateable}\n可删除: ${item.deletable}`}
          >
            <div className="truncate font-medium">{item.name}</div>
            <div className="truncate text-[10px] text-sky-600">{item.label}</div>
          </button>
        ))}
      </div>
    </div>
  );
}
