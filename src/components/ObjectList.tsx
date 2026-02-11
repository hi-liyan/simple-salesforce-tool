import { useMemo, useState } from "react";
import { SalesforceObject } from "../types";

type Props = {
  objects: SalesforceObject[];
  selectedObjectName: string;
  onSelectObject: (value: string) => void;
  onOpenObject: (value: string) => Promise<void>;
};

// 对象树组件：单击选中对象，双击直接打开数据。
export function ObjectList({ objects, selectedObjectName, onSelectObject, onOpenObject }: Props) {
  const [keyword, setKeyword] = useState("");

  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter(
      (item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed)
    );
  }, [keyword, objects]);

  return (
    <div>
      <input
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-xs text-slate-100 outline-none focus:border-sky-500"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="筛选 Object"
      />
      <div className="mt-2 h-[40vh] overflow-auto rounded border border-slate-700 bg-slate-950">
        {filtered.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`flex w-full items-center justify-between border-b border-slate-800 px-2 py-1.5 text-left text-xs hover:bg-slate-800 ${
              item.name === selectedObjectName ? "bg-slate-700 text-white" : "text-slate-300"
            }`}
            onClick={() => onSelectObject(item.name)}
            onDoubleClick={() => void onOpenObject(item.name)}
          >
            <span className="truncate font-medium">{item.name}</span>
            <span className="ml-2 truncate text-[10px] text-slate-500">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
