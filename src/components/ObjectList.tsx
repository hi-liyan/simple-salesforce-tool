import { useMemo, useState } from "react";
import { SalesforceObject } from "../types";

type Props = {
  objects: SalesforceObject[];
  selectedObjectName: string;
  onSelectObject: (value: string) => void;
};

export function ObjectList({ objects, selectedObjectName, onSelectObject }: Props) {
  const [keyword, setKeyword] = useState("");

  // 本地过滤提升可用性，避免每次输入都触发后端请求。
  const filtered = useMemo(() => {
    const trimmed = keyword.trim().toLowerCase();
    if (!trimmed) return objects;
    return objects.filter(
      (item) => item.name.toLowerCase().includes(trimmed) || item.label.toLowerCase().includes(trimmed)
    );
  }, [keyword, objects]);

  return (
    <div className="mt-3">
      <input
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        value={keyword}
        onChange={(event) => setKeyword(event.target.value)}
        placeholder="搜索 Object 名称"
      />
      <div className="mt-2 h-[72vh] overflow-auto rounded-md border border-slate-200">
        {filtered.map((item) => (
          <button
            key={item.name}
            type="button"
            className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-brand-50 ${
              item.name === selectedObjectName ? "bg-brand-100" : "bg-white"
            }`}
            onClick={() => onSelectObject(item.name)}
          >
            <span className="font-medium text-slate-700">{item.name}</span>
            <span className="text-xs text-slate-500">{item.label}</span>
          </button>
        ))}
      </div>
    </div>
  );
}
