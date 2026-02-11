import { FormEvent, useMemo, useState } from "react";
import { api } from "../api";
import { SalesforceSource } from "../types";

// 数据源管理面板：使用紧凑风格支持数据源维护。
type Props = {
  sources: SalesforceSource[];
  selectedSourceId: string;
  loading: boolean;
  onChangeSelectedSource: (sourceId: string) => void;
  onSourcesChanged: (syncCli?: boolean) => Promise<void>;
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
        setMessage("数据源更新成功");
      } else {
        await api.createSource(form);
        setMessage("数据源创建成功");
      }
      await onSourcesChanged(false);
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
      await onSourcesChanged(false);
      setMessage("数据源删除成功");
    } catch (error) {
      setMessage(`删除失败：${String(error)}`);
    }
  }

  async function onSyncCli() {
    setMessage("");
    try {
      await onSourcesChanged(true);
      setMessage("已从 Salesforce CLI 同步认证数据源");
    } catch (error) {
      setMessage(`CLI 同步失败：${String(error)}`);
    }
  }

  return (
    // 面板容器：数据源管理整体布局。
    <div className="space-y-2 text-xs">
      {/* 操作按钮行。 */}
      <div className="flex gap-1">
        {/* CLI 同步按钮。 */}
        <button
          type="button"
          className="rounded border border-emerald-700 bg-emerald-700 px-2 py-1 text-white"
          onClick={() => void onSyncCli()}
          disabled={loading}
        >
          从 CLI 同步
        </button>
        {/* 刷新按钮。 */}
        <button
          type="button"
          className="rounded border border-slate-600 px-2 py-1 text-slate-200"
          onClick={() => void onSourcesChanged(false)}
          disabled={loading}
        >
          刷新
        </button>
      </div>

      {/* 数据源选择下拉。 */}
      <select
        className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1.5 text-slate-100 outline-none focus:border-sky-500"
        value={selectedSourceId}
        onChange={(event) => onChangeSelectedSource(event.target.value)}
      >
        <option value="">请选择数据源</option>
        {sources.map((source) => (
          <option key={source.id} value={source.id}>
            {source.name}
          </option>
        ))}
      </select>

      {/* 数据源表单。 */}
      <form className="space-y-1" onSubmit={onSubmit}>
        {/* 名称输入。 */}
        <input
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          placeholder="名称"
          value={form.name}
          onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
          required
        />
        {/* Instance URL 输入。 */}
        <input
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          placeholder="Instance URL"
          value={form.instanceUrl}
          onChange={(event) => setForm((state) => ({ ...state, instanceUrl: event.target.value }))}
          required
        />
        {/* Access Token 输入。 */}
        <input
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          placeholder="Access Token"
          value={form.accessToken}
          onChange={(event) => setForm((state) => ({ ...state, accessToken: event.target.value }))}
          required
        />
        {/* API Version 输入。 */}
        <input
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          placeholder="API Version"
          value={form.apiVersion}
          onChange={(event) => setForm((state) => ({ ...state, apiVersion: event.target.value }))}
          required
        />
        {/* 表单操作按钮行。 */}
        <div className="flex gap-1">
          {/* 保存/更新按钮。 */}
          <button className="rounded border border-sky-700 bg-sky-700 px-2 py-1 text-white" disabled={loading}>
            {editingId ? "更新" : "保存"}
          </button>
          {/* 清空按钮。 */}
          <button type="button" className="rounded border border-slate-600 px-2 py-1 text-slate-200" onClick={resetForm}>
            清空
          </button>
        </div>
      </form>

      {/* 已选数据源信息卡片。 */}
      {selectedSource && (
        <div className="rounded border border-slate-700 p-2 text-slate-300">
          {/* 数据源名称。 */}
          <div className="truncate">{selectedSource.name}</div>
          {/* 数据源 URL。 */}
          <div className="mt-1 truncate text-[10px] text-slate-500">{selectedSource.instanceUrl}</div>
          {/* 编辑/删除按钮行。 */}
          <div className="mt-1 flex gap-1">
            {/* 编辑按钮。 */}
            <button
              type="button"
              className="rounded border border-slate-600 px-2 py-0.5"
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
            {/* 删除按钮。 */}
            <button
              type="button"
              className="rounded border border-red-700 px-2 py-0.5 text-red-300"
              onClick={() => void onDelete(selectedSource.id)}
            >
              删除
            </button>
          </div>
        </div>
      )}

      {/* 结果提示信息。 */}
      {message && <p className="text-[10px] text-slate-400">{message}</p>}
    </div>
  );
}
