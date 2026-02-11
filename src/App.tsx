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
  whereClause: string;
  limit: number;
  sortField: string;
  sortDirection: "ASC" | "DESC";
  selectedRecordIds: string[];
  currentSoql: string;
  soqlDraft: string;
  showDrawer: boolean;
  columnVisibility: Record<string, boolean>;
  notice: Notice | null;
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
      patchActiveTabNotice({ type: "error", message: `加载数据源失败：${String(error)}` });
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
      patchActiveTabNotice({ type: "error", message: `拉取对象失败：${String(error)}` });
    } finally {
      setLoading(false);
    }
  }

  function patchTab(objectName: string, updater: (tab: TabState) => TabState) {
    setTabs((current) => current.map((tab) => (tab.objectName === objectName ? updater(tab) : tab)));
  }

  function patchActiveTabNotice(nextNotice: Notice) {
    if (!activeTabObjectName) return;
    patchTab(activeTabObjectName, (item) => ({ ...item, notice: nextNotice }));
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
      whereClause: "",
      limit: 200,
      sortField: "Id",
      sortDirection: "DESC",
      selectedRecordIds: [],
      currentSoql: "",
      soqlDraft: "",
      showDrawer: false,
      columnVisibility: {},
      notice: null,
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

      await queryTabData(objectItem.name, describe, "", defaultSortField, 200, "DESC");
    } catch (error) {
      patchTab(objectItem.name, (tab) => ({ ...tab, loading: false }));
      patchTab(objectItem.name, (item) => ({
        ...item,
        notice: { type: "error", message: `打开对象失败：${String(error)}` }
      }));
    }
  }

  async function queryTabData(
    objectName: string,
    describeOverride?: ObjectDescribe,
    whereOverride?: string,
    sortFieldOverride?: string,
    limitOverride?: number,
    directionOverride?: "ASC" | "DESC"
  ) {
    if (!selectedSourceId) return;
    const tab = tabs.find((item) => item.objectName === objectName);
    if (!tab && !describeOverride) return;

    const describe = describeOverride ?? tab?.describe;
    if (!describe) return;

    const whereClause = (whereOverride ?? tab?.whereClause ?? "").trim();
    const limit = Math.max(1, Math.min(2000, limitOverride ?? tab?.limit ?? 200));
    const sortField = sortFieldOverride ?? tab?.sortField ?? "Id";
    const sortDirection = directionOverride ?? tab?.sortDirection ?? "DESC";
    const visibility = tab?.columnVisibility ?? {};
    const selectedFields = describe.fields
      .map((field) => field.name)
      .filter((name) => (visibility[name] ?? true) === true);

    if (selectedFields.length === 0) {
      patchTab(objectName, (item) => ({
        ...item,
        notice: { type: "error", message: `${objectName} 至少要勾选一个字段。` }
      }));
      patchTab(objectName, (item) => ({ ...item, loading: false }));
      return;
    }

    patchTab(objectName, (item) => ({
      ...item,
      loading: true,
      whereClause,
      limit,
      sortField,
      sortDirection
    }));

    try {
      const soql = buildQuerySoql(objectName, selectedFields, whereClause, sortField, sortDirection, limit);
      const result = await api.queryRecords(selectedSourceId, soql);

      patchTab(objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: soql,
        soqlDraft: soql,
        notice: { type: "success", message: `${objectName} 查询成功，共 ${result.totalSize} 条。` }
      }));
    } catch (error) {
      patchTab(objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `${objectName} 查询失败：${String(error)}` }
      }));
    }
  }

  async function deleteCheckedRecords() {
    if (!selectedSourceId || !activeTab) return;
    if (activeTab.selectedRecordIds.length === 0) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: "请先勾选要删除的记录。" }
      }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));

    try {
      await Promise.all(
        activeTab.selectedRecordIds.map((recordId) => api.deleteRecord(selectedSourceId, activeTab.objectName, recordId))
      );

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "success", message: `已删除 ${activeTab.selectedRecordIds.length} 条记录。` }
      }));
      await queryTabData(activeTab.objectName);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `批量删除失败：${String(error)}` }
      }));
    }
  }

  async function executeCustomSoql() {
    if (!selectedSourceId || !activeTab) return;
    if (!activeTab.soqlDraft.trim()) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        notice: { type: "error", message: "SOQL 不能为空。" }
      }));
      return;
    }

    patchTab(activeTab.objectName, (item) => ({ ...item, loading: true }));
    try {
      const result = await api.queryRecords(selectedSourceId, activeTab.soqlDraft);
      const nextVisibility = buildVisibilityFromSoql(activeTab.soqlDraft, activeTab.describe, activeTab.columnVisibility);

      patchTab(activeTab.objectName, (item) => ({
        ...item,
        result,
        loading: false,
        selectedRecordIds: [],
        currentSoql: activeTab.soqlDraft,
        columnVisibility: nextVisibility,
        whereClause: extractWhereClause(activeTab.soqlDraft, activeTab.objectName) ?? item.whereClause,
        notice: { type: "success", message: `${activeTab.objectName} 执行 SOQL 成功，共 ${result.totalSize} 条。` }
      }));
      saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
    } catch (error) {
      patchTab(activeTab.objectName, (item) => ({
        ...item,
        loading: false,
        notice: { type: "error", message: `执行 SOQL 失败：${String(error)}` }
      }));
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
      {/* 页面主布局：左侧对象区域 + 右侧内容区域 */}
      <div className="grid h-full grid-cols-[340px_1fr] overflow-hidden">
        {/* 左侧 aside：数据源选择与 Object 列表 */}
        <aside className="flex min-h-0 flex-col overflow-hidden border-r border-sky-200 bg-[#f3f8ff] p-3">
          {/* 数据源操作区域：下拉选择 + CLI 刷新 */}
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

          {/* Object 列表区域 */}
          <div className="mt-4 text-xs font-semibold uppercase tracking-wide text-sky-900">Objects</div>
          <div className="mt-2 min-h-0 flex-1">
            <ObjectList
              objects={objects}
              activeObjectName={activeTabObjectName}
              onOpenObject={(objectItem) => void openObjectTab(objectItem)}
            />
          </div>
        </aside>

        {/* 右侧 section：标签页、筛选工具栏、数据列表与抽屉 */}
        <section className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-[#f7fbff]">
          {/* 顶部标签栏：每个打开的 Object 一个 tab */}
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

          {/* 当前 tab 通知条：展示成功/错误信息 */}
          {activeTab?.notice && (
            <div
              className={`mx-3 mt-2 rounded px-3 py-2 text-xs ${
                activeTab.notice.type === "error" ? "bg-red-100 text-red-700" : "bg-emerald-100 text-emerald-700"
              }`}
            >
              {activeTab.notice.message}
            </div>
          )}

          {activeTab && (
            /* 当前激活 tab 的主体内容区域 */
            <div className="flex min-h-0 flex-1 gap-2 p-3">
              {/* 主内容列：筛选工具栏 + 数据列表 */}
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                {/* 查询筛选工具栏：LIMIT、排序、查询与动作按钮 */}
                <div className="mb-2 rounded border border-sky-200 bg-[#edf5ff] p-2 text-xs text-sky-900">
                  <div className="grid grid-cols-[minmax(320px,1fr)_130px_520px_auto] items-center gap-2">
                    <label className="flex items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-sky-700">WHERE</span>
                      <input
                        className="w-full rounded border border-sky-300 bg-white px-2 py-1 text-xs"
                        placeholder="例如 Name LIKE 'Acme%'"
                        value={activeTab.whereClause}
                        onChange={(event) => {
                          const nextWhere = event.target.value;
                          const selectedFields = (activeTab.describe?.fields || [])
                            .map((field) => field.name)
                            .filter((name) => (activeTab.columnVisibility[name] ?? true) === true);
                          const nextSoql = buildQuerySoql(
                            activeTab.objectName,
                            selectedFields,
                            nextWhere,
                            activeTab.sortField,
                            activeTab.sortDirection,
                            activeTab.limit
                          );
                          patchTab(activeTab.objectName, (item) => ({
                            ...item,
                            whereClause: nextWhere,
                            soqlDraft: nextSoql
                          }));
                        }}
                      />
                    </label>

                    <label className="flex items-center gap-2">
                      <span className="shrink-0 whitespace-nowrap text-sky-700">LIMIT</span>
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
                      <span className="shrink-0 whitespace-nowrap text-sky-700">排序字段</span>
                      <select
                        className="w-56 shrink-0 rounded border border-sky-300 bg-white px-2 py-1 text-xs"
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
                      <select
                        className="w-24 shrink-0 rounded border border-sky-300 bg-white px-2 py-1 text-xs"
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
                      <button
                        type="button"
                        className="whitespace-nowrap rounded border border-[#0176d3] bg-[#0176d3] px-3 py-1 text-xs text-white hover:bg-[#025cb2]"
                        disabled={activeTab.loading}
                        onClick={() =>
                          void queryTabData(
                            activeTab.objectName,
                            activeTab.describe || undefined,
                            activeTab.whereClause,
                            activeTab.sortField,
                            activeTab.limit,
                            activeTab.sortDirection
                          )
                        }
                      >
                        查询
                      </button>
                    </label>

                    <div className="flex gap-2">
                      <button
                        type="button"
                        className="whitespace-nowrap rounded border border-sky-300 bg-white px-3 py-1 text-xs text-sky-800 hover:bg-sky-50"
                        onClick={() =>
                          patchTab(activeTab.objectName, (item) => ({
                            ...item,
                            showDrawer: !item.showDrawer
                          }))
                        }
                      >
                        字段与 SOQL
                      </button>
                      <button
                        type="button"
                        className="whitespace-nowrap rounded border border-red-300 bg-white px-3 py-1 text-xs text-red-700 hover:bg-red-50"
                        disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                        onClick={() => void deleteCheckedRecords()}
                      >
                        删除已勾选({activeTab.selectedRecordIds.length})
                      </button>
                    </div>
                  </div>
                </div>

                {/* 数据列表容器 */}
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

              {activeTab.showDrawer && activeTab.describe && (
                /* 右侧抽屉：上方字段元数据，下方 SOQL 执行器 */
                <aside className="flex w-[380px] shrink-0 flex-col gap-2 overflow-hidden rounded border border-sky-200 bg-white p-2">
                  {/* 抽屉上半区：Field 元数据与勾选控制 */}
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-sky-100 bg-[#f9fcff] p-2">
                    <div className="mb-1 flex items-center justify-between text-xs">
                      <span className="font-semibold text-sky-800">Field 元数据（勾选控制 SELECT 与列表列）</span>
                      <div className="flex gap-1">
                        <button
                          type="button"
                          className="rounded border border-sky-300 bg-white px-2 py-0.5 text-[11px] text-sky-800 hover:bg-sky-50"
                          onClick={() => {
                            const allSelected = activeTab.describe!.fields.every(
                              (field) => (activeTab.columnVisibility[field.name] ?? true) === true
                            );
                            const nextChecked = !allSelected;
                            const nextVisibility = activeTab.describe!.fields.reduce((acc, field) => {
                              acc[field.name] = nextChecked;
                              return acc;
                            }, {} as Record<string, boolean>);

                            const selectedFields = nextChecked ? activeTab.describe!.fields.map((item) => item.name) : [];
                            const nextSoql = buildQuerySoql(
                              activeTab.objectName,
                              selectedFields,
                              activeTab.whereClause,
                              activeTab.sortField,
                              activeTab.sortDirection,
                              activeTab.limit
                            );

                            patchTab(activeTab.objectName, (item) => ({
                              ...item,
                              columnVisibility: nextVisibility,
                              soqlDraft: nextSoql
                            }));
                            if (selectedSourceId) {
                              saveColumnVisibility(selectedSourceId, activeTab.objectName, nextVisibility);
                            }
                          }}
                        >
                          {activeTab.describe!.fields.every(
                            (field) => (activeTab.columnVisibility[field.name] ?? true) === true
                          )
                            ? "取消全选"
                            : "全选"}
                        </button>
                      </div>
                    </div>
                    <div className="min-h-0 flex-1 overflow-auto">
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

                                  const selectedFields = activeTab.describe!.fields
                                    .map((item) => item.name)
                                    .filter((name) => (nextVisibility[name] ?? true) === true);
                                  const nextSoql = buildQuerySoql(
                                    activeTab.objectName,
                                    selectedFields,
                                    activeTab.whereClause,
                                    activeTab.sortField,
                                    activeTab.sortDirection,
                                    activeTab.limit
                                  );

                                  patchTab(activeTab.objectName, (item) => ({
                                    ...item,
                                    columnVisibility: nextVisibility,
                                    soqlDraft: nextSoql
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

                  {/* 抽屉下半区：SOQL 执行器 */}
                  <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded border border-sky-100 bg-[#f9fcff] p-2">
                    <div className="mb-1 text-xs font-semibold text-sky-800">SOQL 执行器</div>
                    <textarea
                      className="min-h-0 flex-1 rounded border border-sky-300 bg-white p-2 font-mono text-xs text-sky-900 outline-none focus:border-[#0176d3]"
                      value={activeTab.soqlDraft}
                      onChange={(event) =>
                        patchTab(activeTab.objectName, (item) => ({
                          ...item,
                          soqlDraft: event.target.value
                        }))
                      }
                    />
                    <button
                      type="button"
                      className="mt-2 rounded border border-[#0176d3] bg-[#0176d3] px-3 py-1 text-xs text-white hover:bg-[#025cb2]"
                      disabled={activeTab.loading}
                      onClick={() => void executeCustomSoql()}
                    >
                      执行 SOQL
                    </button>
                  </div>
                </aside>
              )}
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

function extractWhereClause(soql: string, objectName: string): string | null {
  const normalized = soql.replace(/\s+/g, " ").trim();
  const objectEscaped = objectName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = normalized.match(new RegExp(`\\sfrom\\s+${objectEscaped}\\s*(.*)$`, "i"));
  if (!match) return null;
  const tail = match[1].trim();

  const whereMatch = tail.match(/^where\s+(.+?)(\s+order\s+by\s+|\s+limit\s+|$)/i);
  if (!whereMatch) return "";
  return whereMatch[1].trim();
}

function buildQuerySoql(
  objectName: string,
  selectedFields: string[],
  whereClause: string,
  sortField: string,
  sortDirection: "ASC" | "DESC",
  limit: number
): string {
  const fields = selectedFields.length > 0 ? selectedFields : ["Id"];
  const whereSegment = whereClause.trim() ? ` WHERE ${whereClause.trim()}` : "";
  return `SELECT ${fields.join(", ")} FROM ${objectName}${whereSegment} ORDER BY ${sortField} ${sortDirection} LIMIT ${limit}`;
}
