import { FormEvent, useMemo, useState } from "react";
import { api } from "../api";
import { DataSourceType, SalesforceSource } from "../types";

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
  // 数据源类型：用于切换不同连接表单。
  sourceType: DataSourceType;
  // 通用配置：按 sourceType 填充不同字段。
  configJson: {
    host?: string;
    port?: number;
    database?: string;
    username?: string;
    password?: string;
    primaryKey?: string;
  };
  instanceUrl: string;
  accessToken: string;
  apiVersion: string;
};

const initialForm: FormState = {
  name: "",
  sourceType: "salesforce",
  configJson: {},
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
  // 按序号升序渲染下拉项，确保与设置页排序一致。
  const sortedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const sortDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
        if (sortDiff !== 0) return sortDiff;
        return a.name.localeCompare(b.name, "zh-CN");
      }),
    [sources]
  );

  function resetForm() {
    setEditingId("");
    setForm(initialForm);
  }

  // 将当前表单状态转换为后端 SourceUpsertPayload。
  function buildPayloadFromForm(state: FormState) {
    if (state.sourceType === "mysql") {
      const host = (state.configJson.host || "").trim();
      const port = Number(state.configJson.port || 3306);
      const database = (state.configJson.database || "").trim();
      const username = (state.configJson.username || "").trim();
      const password = state.configJson.password || "";
      const primaryKey = (state.configJson.primaryKey || "").trim();
      return {
        name: state.name.trim(),
        sourceType: "mysql" as const,
        configJson: {
          host,
          port,
          database,
          username,
          password,
          ...(primaryKey ? { primaryKey } : {})
        },
        // 兼容当前后端通用字段（M2 仍保留）。
        instanceUrl: `mysql://${host}:${port}/${database}`,
        accessToken: "",
        apiVersion: "mysql"
      };
    }
    return {
      name: state.name.trim(),
      sourceType: "salesforce" as const,
      configJson: state.configJson || {},
      instanceUrl: state.instanceUrl.trim(),
      accessToken: state.accessToken.trim(),
      apiVersion: state.apiVersion.trim()
    };
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    const payload = buildPayloadFromForm(form);

    try {
      if (editingId) {
        await api.updateSource(editingId, payload);
        setMessage("数据源更新成功");
      } else {
        await api.createSource(payload);
        setMessage("数据源创建成功");
      }
      await onSourcesChanged(false);
      resetForm();
    } catch (error) {
      setMessage(`提交失败：${String(error)}`);
    }
  }

  // 主动测试连接：不落库，只验证配置可用性。
  async function onTestConnection() {
    setMessage("");
    try {
      await api.testSourceConnection(buildPayloadFromForm(form));
      setMessage("连接测试成功");
    } catch (error) {
      setMessage(`连接测试失败：${String(error)}`);
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
        {sortedSources.map((source) => (
          <option key={source.id} value={source.id}>
            [{source.sortOrder || 0}] {source.name}
          </option>
        ))}
      </select>

      {/* 数据源表单。 */}
      <form className="space-y-1" onSubmit={onSubmit}>
        {/* 数据源类型选择。 */}
        <select
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          value={form.sourceType}
          onChange={(event) =>
            setForm((state) => ({
              ...state,
              sourceType: event.target.value as DataSourceType,
              configJson: event.target.value === "mysql" ? { port: 3306 } : {},
              instanceUrl: event.target.value === "mysql" ? "" : state.instanceUrl,
              accessToken: event.target.value === "mysql" ? "" : state.accessToken,
              apiVersion: event.target.value === "mysql" ? "mysql" : "v61.0"
            }))
          }
          disabled={loading}
        >
          <option value="salesforce">Salesforce</option>
          <option value="mysql">MySQL</option>
        </select>
        {/* 名称输入。 */}
        <input
          className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
          placeholder="名称"
          value={form.name}
          onChange={(event) => setForm((state) => ({ ...state, name: event.target.value }))}
          required
        />
        {/* Salesforce 表单项。 */}
        {form.sourceType === "salesforce" && (
          <>
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
          </>
        )}
        {/* MySQL 表单项。 */}
        {form.sourceType === "mysql" && (
          <>
            {/* Host 输入。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Host"
              value={form.configJson.host || ""}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, host: event.target.value }
                }))
              }
              required
            />
            {/* Port 输入。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Port"
              type="number"
              value={String(form.configJson.port ?? 3306)}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, port: Number(event.target.value || 3306) }
                }))
              }
              required
            />
            {/* Database 输入。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Database"
              value={form.configJson.database || ""}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, database: event.target.value }
                }))
              }
              required
            />
            {/* Username 输入。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Username"
              value={form.configJson.username || ""}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, username: event.target.value }
                }))
              }
              required
            />
            {/* Password 输入。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Password"
              type="password"
              value={form.configJson.password || ""}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, password: event.target.value }
                }))
              }
            />
            {/* 主键字段输入（可选）。 */}
            <input
              className="w-full rounded border border-slate-700 bg-slate-950 px-2 py-1 text-slate-100"
              placeholder="Primary Key（可选，默认自动检测）"
              value={form.configJson.primaryKey || ""}
              onChange={(event) =>
                setForm((state) => ({
                  ...state,
                  configJson: { ...state.configJson, primaryKey: event.target.value }
                }))
              }
            />
          </>
        )}
        {/* 表单操作按钮行。 */}
        <div className="flex gap-1">
          {/* 测试连接按钮。 */}
          <button
            type="button"
            className="rounded border border-emerald-700 bg-emerald-700 px-2 py-1 text-white"
            disabled={loading}
            onClick={() => void onTestConnection()}
          >
            测试连接
          </button>
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
                const sourceType = ((selectedSource.sourceType || "salesforce") as DataSourceType) || "salesforce";
                setForm({
                  name: selectedSource.name,
                  sourceType,
                  configJson: selectedSource.configJson || {},
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
