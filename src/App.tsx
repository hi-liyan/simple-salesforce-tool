import { useEffect, useMemo, useState } from "react";
import { api } from "./api";
import { DataGrid } from "./components/DataGrid";
import { ObjectList } from "./components/ObjectList";
import { ObjectDescribe, QueryResult, SalesforceObject, SalesforceSource } from "./types";

type Notice = {
  type: "error" | "success";
  message: string;
};

type TabState = {
  objectName: string;
  label: string;
  describe: ObjectDescribe | null;
  result: QueryResult;
  limit: number;
  sortField: string;
  sortDirection: "ASC" | "DESC";
  selectedRecordIds: string[];
  currentSoql: string;
  soqlDraft: string;
  showSoqlExecutor: boolean;
  showFieldMeta: boolean;
  columnVisibility: Record<string, boolean>;
  loading: boolean;
};

// 主应用：左侧对象树 + 右侧多对象标签页。
export default function App() {
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState<string>("");
  const [objects, setObjects] = useState<SalesforceObject[]>([]);
  const [tabs, setTabs] = useState<TabState[]>([]);
  const [activeTabObjectName, setActiveTabObjectName] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [notice, setNotice] = useState<Notice | null>(null);

  const activeTab = useMemo(
    () => tabs.find((item) => item.objectName === activeTabObjectName) || null,
    [tabs, activeTabObjectName]
  );

  useEffect(() => {
    // 启动默认从 CLI 同步数据源。
    void refreshSources(true);
  }, []);

  useEffect(() => {
    if (!selectedSourceId) {
      setObjects([]);
      setTabs([]);
      setActiveTabObjectName("");
      return;
    }

    // 切换数据源后刷新对象列表，并清空已打开标签页。
    setTabs([]);
    setActiveTabObjectName("");
    void refreshObjects(selectedSourceId);
  }, [selectedSourceId]);

  async function refreshSources(syncCli: boolean) {
    setLoading(true);
    try {
      const list = syncCli ? await api.syncCliSources() : await api.listSources();
      setSources(list);

      if (list.length === 0) {
        setSelectedSourceId("");
      } else if (!list.some((item) => item.id === selectedSourceId)) {
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
    try {
      const list = await api.listObjects(sourceId);
      setObjects(list);
    } catch (error) {
      setNotice({ type: "error", message: `拉取对象失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function patchTab(objectName: string, updater: (tab: TabState) => TabState) {
    setTabs((current) => current.map((tab) => (tab.objectName === objectName ? updater(tab) : tab)));
  }

  async function openObjectTab(objectItem: SalesforceObject) {
    if (!selectedSourceId) return;

    const existed = tabs.find((tab) => tab.objectName === objectItem.name);
    if (existed) {
      setActiveTabObjectName(objectItem.name);
      return;
    }

    const newTab: TabState = {
      objectName: objectItem.name,
      label: objectItem.label,
      describe: null,
      result: { totalSize: 0, records: [] },
      limit: 200,
      sortField: "Id",
      sortDirection: "DESC",
      selectedRecordIds: [],
      currentSoql: "",
      soqlDraft: "",
      showSoqlExecutor: false,
      showFieldMeta: false,
      columnVisibility: {},
      loading: true
    };

    setTabs((current) => [...current, newTab]);
    setActiveTabObjectName(objectItem.name);

    try {
      const describe = await api.describeObject(selectedSourceId, objectItem.name);
      const defaultSortField = describe.fields.find((field) => field.name === "LastModifiedDate")
        ? "LastModifiedDate"
        : describe.fields.find((field) => field.name === "CreatedDate")
          ? "CreatedDate"
          : describe.fields.find((field) => field.name === "Name")
            ? "Name"
            : "Id";

      patchTab(objectItem.name, (tab) => ({
        ...tab,
        describe,
        sortField: defaultSortField,
        columnVisibility: loadColumnVisibility(selectedSourceId, objectItem.name, describe)
      }));

      await queryTabData(objectItem.name, describe, defaultSortField, 200, "DESC");
    } catch (error) {
      patchTab(objectItem.name, (tab) => ({ ...tab, loading: false }));
      setNotice({ type: "error", message: `打开对象失败：${String(error)}` });
    }
  }

  async function queryTabData(
    objectName: string,
    describeOverride?: ObjectDescribe,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC"
  ) {
    if (!selectedSourceId) return;
    const tab = tabs.find((item) => item.objectName === objectName);
    if (!tab && !describeOverride) return;

    const describe = describeOverride ?? tab?.describe;
    if (!describe) return;

    const limit = Math.max(1, Math.min(2000, limitOverride ?? tab?.limit ?? 200));
    const sortField = sortFieldOverride ?? tab?.sortField ?? "Id";
    const sortDirection = directionOverride ?? tab?.sortDirection ?? "DESC";

    patchTab(objectName, (item) => ({
      ...item,
      loading: true,
      limit,
      sortField,
      sortDirection
    }));

    try {
      const fieldList = describe.fields.map((field) => field.name).join(", ");
      const soql = `SELECT ${fieldList} FROM ${objectName} ORDER BY ${sortField} ${sortDirection} LIMIT ${limit}`;
      const result = await api.queryRecords(selectedSourceId, soql);

      patchTab(objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: soql,
        soqlDraft: soql
      }));

      setNotice({ type: "success", message: `${objectName} 查询成功，共 ${result.totalSize} 条。` });
    } catch (error) {
      patchTab(objectName, (item) => ({ ...item, loading: false }));
      setNotice({ type: "error", message: `${objectName} 查询失败：${String(error)}` });
    }
  }

  async function deleteCheckedRecords() {
    if (!selectedSourceId || !activeTab) return;
    if (activeTab.selectedRecordIds.length === 0) {
      setNotice({ type: "error", message: "请先勾选要删除的记录。" });
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));

    try {
      await Promise.all(
        activeTab.selectedRecordIds.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId))
      );

      setNotice({ type: "success", message: `已删除 ${activeTab.selectedRecordIds.length} 条记录。` });
      await queryTabData(activeTab.objectName);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({ ...item, loading: false }));
      setNotice({ type: "error", message: `批量删除失败：${String(error)}` });
    }
  }

  async function executeCustomSoql() {
    if (!selectedSourceId || !activeTab) return;
    if (!activeTab.soqlDraft.trim()) {
      setNotice({ type: "error", message: "SOQL 不能为空。" });
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      const result = await api.queryRecords(selectedSourceId, activeTab.soqlDraft);
      const nextVisibility = buildVisibilityFromSoql(
        activeTab.soqlDraft,
        activeTab.describe,
        activeTab.columnVisibility
      );
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility
      }));
      saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
      setNotice({ type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` });
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({ ...item, loading: false }));
      setNotice({ type: "error", message: `执行 SOQL 失败：${String(error)}` });
    }
  }

  function closeTab(objectName: string) {
    setTabs((current) => {
      const next = current.filter((item) => item.objectName !== objectName);
      if (activeTabObjectName === objectName) {
        setActiveTabObjectName(next[0]?.objectName || "");
      }
      return next;
    });
  }

  return (
    <main className="datagrip-shell h-screen overflow-hidden">
      <div className="grid h-full grid-cols-[340px_1fr] overflow-hidden">
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-sky-200 bg-[#f3f8ff] p-3">
          <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-sky-900">Data Source</div>
          <div className="flex gap-2">
            <select
              className="w-full rounded border border-sky-300 bg-white px-2 py-1.5 text-xs text-sky-900 outline-none focus:border-[#0176d3]"
              value={selectedSourceId}
              onChange={(event) => setSelectedSourceId(event.target.value)}
            >
              <option value="">请选择数据源</option>
              {sources.map((source) => (
                <option key={source.id} value={source.id}>
                  {source.name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="rounded border border-[#0176d3] bg-[#0176d3] px-3 py-1 text-xs text-white hover:bg-[#025cb2]"
              disabled={loading}
              onClick={() => void refreshSources(true)}
            >
              刷新
            </button>
          </div>

          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-sky-900">Objects</div>
          <div className="mt-2 min-h-0 flex-1">
            <ObjectList
              objects={objects}
              activeObjectName={activeTabObjectName}
              onOpenObject={(objectItem) => void openObjectTab(objectItem)}
            />
          </div>
        </aside>

        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7fbff]">
          <div className="flex shrink-0 overflow-x-auto border-b border-sky-200 bg-[#eaf3ff] text-xs text-sky-900">
            {tabs.length === 0 && <div className="px-3 py-2 text-sky-600">请选择左侧 Object 打开标签页</div>}
            {tabs.map((tab) => (
              <div
                key={tab.objectName}
                className={`flex items-center gap-2 border-r border-sky-200 px-3 py-2 ${
                  activeTabObjectName === tab.objectName ? "bg-white text-[#0176d3]" : "text-sky-700"
                }`}
              >
                <button type="button" onClick={() => setActiveTabObjectName(tab.objectName)} title={tab.label}>
                  {tab.objectName}
                </button>
                <button
                  type="button"
                  className="rounded px-1 text-sky-600 hover:bg-sky-100 hover:text-sky-900"
                  onClick={() => closeTab(tab.objectName)}
                >
                  x
                </button>
              </div>
            ))}
          </div>

          {notice && (
            <div
              className={`mx-3 mt-2 rounded px-3 py-2 text-xs ${
                notice.type === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {notice.message}
            </div>
          )}

          {activeTab && (
            <div className="flex min-h-0 flex-1 flex-col p-3">
              <div className="mb-2 rounded border border-sky-200 bg-[#edf5ff] p-2 text-xs text-sky-900">
                <div className="grid grid-cols-[120px_240px_140px_auto] items-center gap-2">
                  <label className="flex items-center gap-2">
                    <span className="text-sky-700">LIMIT</span>
                    <input
                      type="number"
                      min={1}
                      max={2000}
                      className="w-20 rounded border border-sky-300 bg-white px-2 py-1 text-xs"
                      value={activeTab.limit}
                      onChange={(event) => {
                        const nextLimit = Number(event.target.value || 200);
                        patchTab(activeTab.objectName, (item) => ({ ...item, limit: nextLimit }));
                      }}
                    />
                  </label>

                  <label className="flex items-center gap-2">
                    <span className="text-sky-700">排序字段</span>
                    <select
                      className="w-full rounded border border-sky-300 bg-white px-2 py-1 text-xs"
                      value={activeTab.sortField}
                      onChange={(event) =>
                        patchTab(activeTab.objectName, (item) => ({ ...item, sortField: event.target.value }))
                      }
                    >
                      {(activeTab.describe?.fields || []).map((field) => (
                        <option key={field.name} value={field.name}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <select
                    className="rounded border border-sky-300 bg-white px-2 py-1 text-xs"
                    value={activeTab.sortDirection}
                    onChange={(event) =>
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        sortDirection: event.target.value as "ASC" | "DESC"
                      }))
                    }
                  >
                    <option value="ASC">ASC</option>
                    <option value="DESC">DESC</option>
                  </select>

                  <div className="flex gap-2">
                    <button
                      type="button"
                      className="rounded border border-[#0176d3] bg-[#0176d3] px-3 py-1 text-xs text-white hover:bg-[#025cb2]"
                      disabled={activeTab.loading}
                      onClick={() =>
                        void queryTabData(
                          activeTab.objectName,
                          activeTab.describe || undefined,
                          activeTab.sortField,
                          activeTab.limit,
                          activeTab.sortDirection
                        )
                      }
                    >
                      查询
                    </button>
                    <button
                      type="button"
                      className="rounded border border-sky-300 bg-white px-3 py-1 text-xs text-sky-800 hover:bg-sky-50"
                      onClick={() =>
                        patchTab(activeTab.objectName, (item) => ({
                          ...item,
                          showSoqlExecutor: !item.showSoqlExecutor
                        }))
                      }
                    >
                      SOQL 执行器
                    </button>
                    <button
                      type="button"
                      className="rounded border border-sky-300 bg-white px-3 py-1 text-xs text-sky-800 hover:bg-sky-50"
                      onClick={() =>
                        patchTab(activeTab.objectName, (item) => ({
                          ...item,
                          showFieldMeta: !item.showFieldMeta
                        }))
                      }
                    >
                      Field 元数据
                    </button>
                    <button
                      type="button"
                      className="rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                      disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                      onClick={() => void deleteCheckedRecords()}
                    >
                      删除已勾选({activeTab.selectedRecordIds.length})
                    </button>
                  </div>
                </div>
              </div>

              {activeTab.showSoqlExecutor && (
                <div className="mb-2 rounded border border-sky-200 bg-white p-2">
                  <div className="mb-1 text-xs font-semibold text-sky-800">SOQL 执行器</div>
                  <textarea
                    className="h-24 w-full rounded border border-sky-300 bg-[#f7fbff] p-2 font-mono text-xs text-sky-900 outline-none focus:border-[#0176d3]"
                    value={activeTab.soqlDraft}
                    onChange={(event) =>
                      patchTab(activeTab.objectName, (item) => ({
                        ...item,
                        soqlDraft: event.target.value
                      }))
                    }
                  />
                  <div className="mt-2 flex items-center gap-2">
                    <button
                      type="button"
                      className="rounded border border-[#0176d3] bg-[#0176d3] px-3 py-1 text-xs text-white hover:bg-[#025cb2]"
                      disabled={activeTab.loading}
                      onClick={() => void executeCustomSoql()}
                    >
                      执行 SOQL
                    </button>
                    <span className="text-[11px] text-sky-600">默认值为当前数据列表查询 SOQL</span>
                  </div>
                </div>
              )}

              {activeTab.showFieldMeta && activeTab.describe && (
                <div className="mb-2 rounded border border-sky-200 bg-white p-2">
                  <div className="mb-1 text-xs font-semibold text-sky-800">Field 元数据（勾选控制列表列显示）</div>
                  <div className="max-h-40 overflow-auto rounded border border-sky-100 bg-[#f9fcff] p-1">
                    {activeTab.describe.fields.map((field) => {
                      const checked = activeTab.columnVisibility[field.name] ?? true;
                      return (
                        <label
                          key={field.name}
                          className="flex items-center justify-between gap-2 rounded px-2 py-1 text-xs text-sky-900 hover:bg-sky-50"
                        >
                          <span className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={(event) => {
                                const nextVisibility = {
                                  ...activeTab.columnVisibility,
                                  [field.name]: event.target.checked
                                };
                                patchTab(activeTab.objectName, (item) => ({
                                  ...item,
                                  columnVisibility: nextVisibility
                                }));
                                if (selectedSourceId) {
                                  saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                                }
                              }}
                            />
                            <span>{field.name}</span>
                          </span>
                          <span className="text-[10px] text-sky-600">
                            {field.label} / {field.dataType}
                          </span>
                        </label>
                      );
                    })}
                  </div>
                </div>
              )}

              <div className="min-h-0 flex-1 overflow-hidden rounded border border-sky-200 bg-white">
                <DataGrid
                  result={activeTab.result}
                  visibleColumns={getVisibleColumns(activeTab)}
                  selectedRecordIds={activeTab.selectedRecordIds}
                  onToggleRecord={(recordId, checked) => {
                    patchTab(activeTab.objectName, (item) => ({
                      ...item,
                      selectedRecordIds: checked
                        ? Array.from(new Set([...item.selectedRecordIds, recordId]))
                        : item.selectedRecordIds.filter((id) => id !== recordId)
                    }));
                  }}
                  onToggleAll={(checked, recordIds) => {
                    patchTab(activeTab.objectName, (item) => ({
                      ...item,
                      selectedRecordIds: checked ? recordIds : []
                    }));
                  }}
                />
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function getVisibilityStorageKey(sourceId: string, objectName: string): string {
  return `column_visibility:${sourceId}:${objectName}`;
}

// 从本地存储读取字段可见性；默认所有字段可见。
function loadColumnVisibility(sourceId: string, objectName: string, describe: ObjectDescribe): Record<string, boolean> {
  const key = getVisibilityStorageKey(sourceId, objectName);
  const defaults = describe.fields.reduce(
    (acc, field) => ({ ...acc, [field.name]: true }),
    {} as Record<string, boolean>
  );

  try {
    const raw = localStorage.getItem(key);
    if (!raw) return defaults;
    const parsed = JSON.parse(raw) as Record<string, boolean>;
    return { ...defaults, ...parsed };
  } catch {
    return defaults;
  }
}

function saveColumnVisibility(sourceId: string, objectName: string, visibility: Record<string, boolean>) {
  const key = getVisibilityStorageKey(sourceId, objectName);
  localStorage.setItem(key, JSON.stringify(visibility));
}

function getVisibleColumns(tab: TabState): string[] {
  if (!tab.describe) return [];
  return tab.describe.fields
    .map((field) => field.name)
    .filter((name) => (tab.columnVisibility[name] ?? true) === true);
}

// 根据 SOQL 语句中的 SELECT 字段生成可见性映射，仅保留被查询字段。
function buildVisibilityFromSoql(
  soql: string,
  describe: ObjectDescribe | null,
  fallback: Record<string, boolean>
): Record<string, boolean> {
  if (!describe) return fallback;
  const selected = extractSelectedFields(soql);
  if (selected.length === 0) return fallback;

  const selectedSet = new Set(selected.map((name) => name.toLowerCase()));
  return describe.fields.reduce((acc, field) => {
    acc[field.name] = selectedSet.has(field.name.toLowerCase());
    return acc;
  }, {} as Record<string, boolean>);
}

function extractSelectedFields(soql: string): string[] {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const match = normalized.match(/^select\s+(.+?)\s+from\s+/i);
  if (!match) return [];

  const fieldSegment = match[1].trim();
  if (!fieldSegment || fieldSegment === "*") return [];
  if (/^count\(/i.test(fieldSegment)) return [];

  return fieldSegment
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const withoutAlias = item.split(/\s+/)[0];
      const dotParts = withoutAlias.split(".");
      return dotParts[dotParts.length - 1];
    });
}

