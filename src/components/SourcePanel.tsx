import { FormEvent, useMemo, useState } from "react";
import { api } from "../api";
import { SalesforceSource } from "../types";

// 数据源管理面板：负责数据源的创建、更新、删除与切换。
type Props = {
  sources: SalesforceSource[];
  selectedSourceId: string;
  loading: boolean;
  onChangeSelectedSource: (sourceId: string) => void;
  onSourcesChanged: () => Promise<void>;
};

type FormState = {
  name: string;
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
};

const initialForm: FormState = {
  name: "",
  instanceUrl: "",
  accessToken: "",
  apiVersion: "v61.0"
};

export function SourcePanel({
  sources,
  selectedSourceId,
  loading,
  onChangeSelectedSource,
  onSourcesChanged
}: Props) {
  const [form, setForm] = useState<FormState>(initialForm);
  const [editingId, setEditingId] = useState<string>("");
  const [message, setMessage] = useState<string>("");

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  function resetForm() {
    setEditingId("");
    setForm(initialForm);
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");

    try {
      if (editingId) {
        await api.updateSource(editingId, form);
        setMessage("数据源更新成功。");
      } else {
        await api.createSource(form);
        setMessage("数据源创建成功。");
      }
      await onSourcesChanged();
      resetForm();
    } catch (error) {
      setMessage(`提交失败：${String(error)}`);
    }
  }

  async function onDelete(id: string) {
    setMessage("");
    try {
      await api.deleteSource(id);
      if (selectedSourceId === id) {
        onChangeSelectedSource("");
      }
      await onSourcesChanged();
      setMessage("数据源删除成功。");
    } catch (error) {
      setMessage(`删除失败：${String(error)}`);
    }
  }

  return (
    <div className="mt-4 space-y-3">
      <label className="block text-sm font-medium text-slate-700">当前数据源</label>
      <select
        className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm outline-none focus:border-brand-500"
        value={selectedSourceId}
        onChange={(event) => onChangeSelectedSource(event.target.value)}
      >
        <option value="">请选择</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>

      <div className="rounded-lg border border-slate-200 p-3">
        <h3 className="text-sm font-semibold text-slate-700">新增/编辑数据源</h3>
        <form className="mt-3 space-y-2" onSubmit={onSubmit}>
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="数据源名称"
            value={form.name}
            onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Instance URL，如 https://xxx.my.salesforce.com"
            value={form.instanceUrl}
            onChange={(event) => setForm((state) => ({ ...state, instanceUrl: event.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="Access Token"
            value={form.accessToken}
            onChange={(event) => setForm((state) => ({ ...state, accessToken: event.target.value }))}
            required
          />
          <input
            className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            placeholder="API Version，如 v61.0"
            value={form.apiVersion}
            onChange={(event) => setForm((state) => ({ ...state, apiVersion: event.target.value }))}
            required
          />
          <div className="flex gap-2">
            <button className="rounded bg-brand-700 px-3 py-2 text-sm text-white hover:bg-brand-800" disabled={loading}>
              {editingId ? "更新" : "保存"}
            </button>
            <button
              type="button"
              className="rounded border border-slate-300 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
              onClick={resetForm}
            >
              清空
            </button>
          </div>
        </form>
      </div>

      {selectedSource && (
        <div className="rounded-lg border border-slate-200 p-3 text-sm text-slate-700">
          <div className="font-medium">已选：{selectedSource.name}</div>
          <div className="mt-1 truncate">{selectedSource.instanceUrl}</div>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              className="rounded border border-slate-300 px-2 py-1 text-xs hover:bg-slate-50"
              onClick={() => {
                setEditingId(selectedSource.id);
                setForm({
                  name: selectedSource.name,
                  instanceUrl: selectedSource.instanceUrl,
                  accessToken: selectedSource.accessToken,
                  apiVersion: selectedSource.apiVersion
                });
              }}
            >
              编辑
            </button>
            <button
              type="button"
              className="rounded border border-red-300 px-2 py-1 text-xs text-red-600 hover:bg-red-50"
              onClick={() => void onDelete(selectedSource.id)}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {message && <p className="text-xs text-slate-600">{message}</p>}
    </div>
  );
}
