import { FormEvent, useEffect, useMemo, useState } from "react";
import { ObjectDescribe } from "../types";

type Props = {
  describe: ObjectDescribe | null;
  selectedRecord: Record<string, unknown> | null;
  onCreate: (values: Record<string, unknown>) => Promise<void>;
  onUpdate: (values: Record<string, unknown>) => Promise<void>;
};

export function RecordEditor({ describe, selectedRecord, onCreate, onUpdate }: Props) {
  const [values, setValues] = useState<Record<string, string>>({});
  const editableFields = useMemo(
    () =>
      (describe?.fields || []).filter((field) => field.name !== "Id" && (field.createable || field.updateable)).slice(0, 10),
    [describe]
  );

  useEffect(() => {
    // 选中记录变化时，回填可编辑字段值到表单。
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
    return <div className="mt-4 rounded-md bg-slate-50 p-3 text-sm text-slate-500">请选择对象后编辑记录。</div>;
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
    <div className="mt-4 rounded-lg border border-slate-200 p-3">
      <h3 className="text-sm font-semibold text-slate-700">记录编辑器（字段最多展示 10 个）</h3>
      <div className="mt-2 text-xs text-slate-500">对象：{describe.name}</div>
      <form className="mt-3 grid grid-cols-1 gap-2 md:grid-cols-2" onSubmit={selectedRecord ? onSubmitUpdate : onSubmitCreate}>
        {editableFields.map((field) => (
          <label key={field.name} className="flex flex-col gap-1 text-xs text-slate-600">
            <span>{field.label || field.name}</span>
            <input
              className="rounded border border-slate-300 px-2 py-1.5 text-sm"
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
        <div className="col-span-full flex gap-2 pt-1">
          <button className="rounded bg-brand-700 px-3 py-2 text-sm text-white hover:bg-brand-800">
            {selectedRecord ? "更新选中记录" : "创建新记录"}
          </button>
          <button
            type="button"
            className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
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
