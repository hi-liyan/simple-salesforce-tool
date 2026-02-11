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

// 主应用：采用 DataGrip 风格三段式工作区。
export default function App() {
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [selectedObjectName, setSelectedObjectName] = useState<string>("");
  const [describe, setDescribe] = useState<ObjectDescribe | null>(null);
  const [query, setQuery] = useState<string>("SELECT Id, Name FROM Account LIMIT 50");
  const [result, setResult] = useState<QueryResult>({ totalSize: 0, records: [] });
  const [selectedRecordId, setSelectedRecordId] = useState<string>("");
  const [activeBottomTab, setActiveBottomTab] = useState<"result" | "editor">("result");
  const [loading, setLoading] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const selectedSource = useMemo(
    () => sources.find((source) => source.id === selectedSourceId) || null,
    [sources, selectedSourceId]
  );

  useEffect(() => {
    // 启动时读取本地保存的数据源。
    void refreshSources();
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      setObjects([]);
      return;
    }

    // 数据源切换后，刷新左侧对象树。
    void refreshObjects(selectedSourceId);
  }, [selectedSourceId]);

  useEffect(() => {
    if (!selectedSourceId || !selectedObjectName) {
      setDescribe(null);
      return;
    }

    // 当前对象变化时，刷新字段描述并设置默认查询。
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

  async function executeQuery(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!selectedSourceId) {
      setNotice({ type: "error", message: "请先选择数据源。" });
      return;
    }

    setLoading(true);
    try {
      const payload = await api.queryRecords(selectedSourceId, query);
      setResult(payload);
      setActiveBottomTab("result");
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
      setActiveBottomTab("result");
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
      setActiveBottomTab("result");
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

  async function onOpenObject(objectName: string) {
    // 双击对象时模拟 DataGrip 的“直接打开数据”行为。
    setSelectedObjectName(objectName);
    const nextQuery = `SELECT Id, Name FROM ${objectName} LIMIT 200`;
    setQuery(nextQuery);

    if (!selectedSourceId) return;

    setLoading(true);
    try {
      const payload = await api.queryRecords(selectedSourceId, nextQuery);
      setResult(payload);
      setActiveBottomTab("result");
      setNotice({ type: "success", message: `已打开 ${objectName}，共 ${payload.totalSize} 条。` });
    } catch (error) {
      setNotice({ type: "error", message: `打开对象失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="datagrip-shell min-h-screen">
      <header className="border-b border-slate-700 bg-slate-900 px-4 py-2 text-xs text-slate-300">
        Salesforce Workspace | 数据源：{selectedSource?.name || "未选择"} | 对象：{selectedObjectName || "未选择"}
      </header>

      <div className="grid min-h-[calc(100vh-34px)] grid-cols-[52px_320px_1fr]">
        <aside className="border-r border-slate-700 bg-slate-900">
          <div className="flex h-full flex-col items-center gap-2 pt-3">
            <button type="button" className="tool-rail-btn tool-rail-btn--active" title="Database">
              DB
            </button>
            <button type="button" className="tool-rail-btn" title="Query Console">
              SQL
            </button>
          </div>
        </aside>

        <aside className="border-r border-slate-700 bg-slate-800 p-3">
          <div className="mb-3 text-xs font-semibold uppercase tracking-wide text-slate-300">Database Explorer</div>

          <div className="rounded-md border border-slate-700 bg-slate-900 p-2">
            <SourcePanel
              loading={loading}
              selectedSourceId={selectedSourceId}
              sources={sources}
              onChangeSelectedSource={setSelectedSourceId}
              onSourcesChanged={refreshSources}
            />
          </div>

          <div className="mt-3 rounded-md border border-slate-700 bg-slate-900 p-2">
            <div className="mb-2 flex items-center justify-between text-xs text-slate-300">
              <span>Objects</span>
              <button
                type="button"
                className="rounded border border-slate-600 px-2 py-0.5 hover:bg-slate-700"
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
              onOpenObject={onOpenObject}
            />
          </div>
        </aside>

        <section className="flex min-w-0 flex-col bg-slate-950">
          <div className="border-b border-slate-700 bg-slate-900 px-3 py-2 text-sm text-slate-200">Query Console 1</div>

          <form onSubmit={executeQuery} className="border-b border-slate-700 bg-slate-950 p-3">
            <div className="mb-2 flex items-center gap-2">
              <button
                className="rounded border border-emerald-600 bg-emerald-700 px-3 py-1 text-xs text-white hover:bg-emerald-600"
                disabled={loading || !selectedSourceId}
                type="submit"
              >
                执行(Ctrl+Enter)
              </button>
              <button
                className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                type="button"
                disabled={loading || !selectedSourceId}
                onClick={() => void onRefreshData()}
              >
                重新运行
              </button>
              <button
                className="rounded border border-slate-600 px-3 py-1 text-xs text-slate-200 hover:bg-slate-800"
                type="button"
                disabled={!selectedSourceId || loading}
                onClick={() => setActiveBottomTab("editor")}
              >
                打开编辑器
              </button>
            </div>

            <textarea
              className="h-44 w-full rounded border border-slate-700 bg-slate-900 p-3 font-mono text-sm text-slate-100 outline-none focus:border-sky-500"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="输入 SOQL，例如 SELECT Id, Name FROM Account LIMIT 50"
            />
          </form>

          {notice && (
            <div
              className={`mx-3 mt-2 rounded px-3 py-2 text-xs ${
                notice.type === "error" ? "bg-red-950 text-red-200" : "bg-emerald-950 text-emerald-200"
              }`}
            >
              {notice.message}
            </div>
          )}

          <div className="mt-2 flex min-h-0 flex-1 flex-col px-3 pb-3">
            <div className="flex border-b border-slate-700 text-xs text-slate-300">
              <button
                type="button"
                className={`px-3 py-2 ${activeBottomTab === "result" ? "border-b-2 border-sky-500 text-white" : ""}`}
                onClick={() => setActiveBottomTab("result")}
              >
                Result
              </button>
              <button
                type="button"
                className={`px-3 py-2 ${activeBottomTab === "editor" ? "border-b-2 border-sky-500 text-white" : ""}`}
                onClick={() => setActiveBottomTab("editor")}
              >
                Data Editor
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-auto bg-slate-900">
              {activeBottomTab === "result" ? (
                <DataGrid
                  result={result}
                  selectedRecordId={selectedRecordId}
                  onSelectRecord={(id) => {
                    setSelectedRecordId(id);
                    setActiveBottomTab("editor");
                  }}
                  onDelete={handleDelete}
                />
              ) : (
                <RecordEditor
                  describe={describe}
                  selectedRecord={result.records.find((item) => String(item.Id || "") === selectedRecordId) || null}
                  onCreate={handleCreate}
                  onUpdate={handleUpdate}
                />
              )}
            </div>
          </div>
        </section>
      </div>
    </main>
  );
}
