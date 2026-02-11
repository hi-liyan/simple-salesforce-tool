import { FormEvent, useEffect, useMemo, useState } from "react";
import { ObjectDescribe } from "../types";

type Props = {
  describe: ObjectDescribe | null;
  selectedRecord: Record<string, unknown> | null;
  onCreate: (values: Record<string, unknown>) => Promise<void>;
  onUpdate: (values: Record<string, unknown>) => Promise<void>;
};

// 记录编辑器：对当前对象进行新增或更新。
export function RecordEditor({ describe, selectedRecord, onCreate, onUpdate }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const editableFields = useMemo(
    () =>
      (describe?.fields || []).filter((field) => field.name !== "Id" && (field.createable || field.updateable)).slice(0, 16),
    [describe]
  );

  useEffect(() => {
    if (!selectedRecord) {
      setValues({});
      return;
    }

    const next: Record<string, string> = {};
    editableFields.forEach((field) => {
      next[field.name] = String(selectedRecord[field.name] ?? "");
    });
    setValues(next);
  }, [selectedRecord, editableFields]);

  if (!describe) {
    return <div className="p-3 text-xs text-slate-400">请选择对象后编辑记录。</div>;
  }

  async function onSubmitCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onCreate(stripEmpty(values));
    setValues({});
  }

  async function onSubmitUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onUpdate(stripEmpty(values));
  }

  return (
    <div className="p-3 text-xs text-slate-200">
      <div className="mb-2 text-[11px] text-slate-400">对象：{describe.name}</div>
      <form className="grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={selectedRecord ? onSubmitUpdate : onSubmitCreate}>
        {editableFields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1">
            <span className="text-[11px] text-slate-400">{field.label || field.name}</span>
            <input
              className="rounded border border-slate-700 bg-slate-950 px-2 py-1 text-xs text-slate-100"
              value={values[field.name] ?? ""}
              onChange={(event) =>
                setValues((state) => ({
                  ...state,
                  [field.name]: event.target.value
                }))
              }
            />
          </label>
        ))}
        <div className="col-span-full flex gap-2">
          <button className="rounded border border-sky-700 bg-sky-700 px-3 py-1 text-xs text-white">
            {selectedRecord ? "更新记录" : "创建记录"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200"
            onClick={() => setValues({})}
          >
            清空
          </button>
        </div>
      </form>
    </div>
  );
}

function stripEmpty(values: Record<string, string>): Record<string, unknown> {
  return Object.entries(values).reduce((acc, [key, value]) => {
    if (value.trim() !== "") acc[key] = value;
    return acc;
  }, {} as Record<string, unknown>);
}
