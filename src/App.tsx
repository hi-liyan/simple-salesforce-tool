import { FormEvent, useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { DataGrid } from "./components/DataGrid";
import { ObjectList } from "./components/ObjectList";
import { RecordEditor } from "./components/RecordEditor";
import { SourcePanel } from "./components/SourcePanel";
import { ObjectDescribe, QueryResult, SalesforceObject, SalesforceSource } from "./types";

type Notice = {
  type: "error" | "success";
  message: string;
};

export default function App() {
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [selectedObjectName, setSelectedObjectName] = useState<string>("");
  const [describe, setDescribe] = useState<ObjectDescribe | null>(null);
  const [query, setQuery] = useState<string>("");
  const [result, setResult] = useState<QueryResult>({ totalSize: 0, records: [] });
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  useEffect(() => {
    // 初次加载本地数据源配置。
    void refreshSources();
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      setObjects([]);
      return;
    }

    // 数据源切换时刷新对象列表。
    void refreshObjects(selectedSourceId);
  }, [selectedSourceId]);

  useEffect(() => {
    if (!selectedSourceId || !selectedObjectName) {
      setDescribe(null);
      return;
    }

    // 对象切换时拉取字段描述并生成默认查询。
    void loadDescribe(selectedSourceId, selectedObjectName);
    setQuery(`SELECT Id, Name FROM ${selectedObjectName} LIMIT 50`);
  }, [selectedSourceId, selectedObjectName]);

  async function refreshSources() {
    setLoading(true);
    try {
      const list = await api.listSources();
      setSources(list);
      if (list.length > 0 && !selectedSourceId) {
        setSelectedSourceId(list[0].id);
      }
    } catch (error) {
      setNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function refreshObjects(sourceId: string) {
    setLoading(true);
    setSelectedObjectName("");
    setResult({ totalSize: 0, records: [] });
    try {
      const list = await api.listObjects(sourceId);
      setObjects(list);
      if (list.length > 0) {
        setSelectedObjectName(list[0].name);
      }
    } catch (error) {
      setNotice({ type: "error", message: `拉取对象失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function loadDescribe(sourceId: string, objectName: string) {
    try {
      const payload = await api.describeObject(sourceId, objectName);
      setDescribe(payload);
    } catch (error) {
      setDescribe(null);
      setNotice({ type: "error", message: `获取对象字段失败：${String(error)}` });
    }
  }

  async function onQuerySubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedSourceId) {
      setNotice({ type: "error", message: "请先选择数据源。" });
      return;
    }

    setLoading(true);
    try {
      const payload = await api.queryRecords(selectedSourceId, query);
      setResult(payload);
      setNotice({ type: "success", message: `查询成功，共 ${payload.totalSize} 条。` });
    } catch (error) {
      setNotice({ type: "error", message: `执行查询失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleCreate(values: Record<string, unknown>) {
    if (!selectedSourceId || !selectedObjectName) return;

    setLoading(true);
    try {
      const recordId = await api.createRecord({ sourceId: selectedSourceId, objectName: selectedObjectName, values });
      setNotice({ type: "success", message: `创建成功，记录ID：${recordId}` });
      await onRefreshData();
    } catch (error) {
      setNotice({ type: "error", message: `创建失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleUpdate(values: Record<string, unknown>) {
    if (!selectedSourceId || !selectedObjectName || !selectedRecordId) return;

    setLoading(true);
    try {
      await api.updateRecord(selectedSourceId, selectedObjectName, selectedRecordId, values);
      setNotice({ type: "success", message: "更新成功。" });
      await onRefreshData();
    } catch (error) {
      setNotice({ type: "error", message: `更新失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(recordId: string) {
    if (!selectedSourceId || !selectedObjectName) return;

    setLoading(true);
    try {
      await api.deleteRecord(selectedSourceId, selectedObjectName, recordId);
      setSelectedRecordId("");
      setNotice({ type: "success", message: "删除成功。" });
      await onRefreshData();
    } catch (error) {
      setNotice({ type: "error", message: `删除失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  async function onRefreshData() {
    if (!selectedSourceId || !query.trim()) return;
    const payload = await api.queryRecords(selectedSourceId, query);
    setResult(payload);
  }

  return (
    <main className="min-h-screen p-4 md:p-6">
      <div className="mx-auto grid max-w-[1680px] grid-cols-1 gap-4 md:grid-cols-[280px_360px_1fr]">
        <section className="rounded-2xl bg-white p-4 shadow-panel">
          <h1 className="text-xl font-bold text-brand-800">Simple Salesforce Tool</h1>
          <p className="mt-1 text-sm text-slate-600">多数据源 Salesforce 查询与 CRUD 工作台</p>
          <SourcePanel
            loading={loading}
            selectedSourceId={selectedSourceId}
            sources={sources}
            onChangeSelectedSource={setSelectedSourceId}
            onSourcesChanged={refreshSources}
          />
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-panel">
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold text-brand-800">Objects</h2>
            <button
              type="button"
              className="rounded-md bg-brand-700 px-3 py-1.5 text-sm text-white hover:bg-brand-800"
              disabled={!selectedSourceId || loading}
              onClick={() => void refreshObjects(selectedSourceId)}
            >
              刷新
            </button>
          </div>
          <ObjectList
            objects={objects}
            selectedObjectName={selectedObjectName}
            onSelectObject={setSelectedObjectName}
          />
        </section>

        <section className="rounded-2xl bg-white p-4 shadow-panel">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-brand-800">Query</h2>
            <span className="text-sm text-slate-600">
              数据源：{selectedSource?.name || "未选择"} / 对象：{selectedObjectName || "未选择"}
            </span>
          </div>

          <form onSubmit={onQuerySubmit} className="space-y-2">
            <textarea
              className="h-24 w-full rounded-md border border-slate-300 p-3 font-mono text-sm outline-none focus:border-brand-500"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入 SOQL，例如 SELECT Id, Name FROM Account LIMIT 50"
            />
            <div className="flex gap-2">
              <button
                className="rounded-md bg-brand-700 px-4 py-2 text-white hover:bg-brand-800"
                disabled={loading || !selectedSourceId}
                type="submit"
              >
                执行查询
              </button>
              <button
                className="rounded-md border border-slate-300 px-4 py-2 text-slate-700 hover:bg-slate-50"
                type="button"
                disabled={loading || !selectedSourceId}
                onClick={() => void onRefreshData()}
              >
                刷新结果
              </button>
            </div>
          </form>

          {notice && (
            <div
              className={`mt-3 rounded-md px-3 py-2 text-sm ${
                notice.type === "error" ? "bg-red-50 text-red-700" : "bg-emerald-50 text-emerald-700"
              }`}
            >
              {notice.message}
            </div>
          )}

          <DataGrid
            result={result}
            selectedRecordId={selectedRecordId}
            onSelectRecord={setSelectedRecordId}
            onDelete={handleDelete}
          />

          <RecordEditor
            describe={describe}
            selectedRecord={result.records.find((item) => String(item.Id || "") === selectedRecordId) || null}
            onCreate={handleCreate}
            onUpdate={handleUpdate}
          />
        </section>
      </div>
    </main>
  );
}
