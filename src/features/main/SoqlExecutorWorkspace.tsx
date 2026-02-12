import { useMemo, useState } from "react";
import { Play, Plus, Table2, TreePine, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { NoticeAlert } from "../../components/NoticeAlert";
import { api } from "../../api";
import { Notice, QueryResult, TabLog } from "../../types";

type SoqlExecutorTab = {
  id: string;
  name: string;
  soqlDraft: string;
  result: QueryResult;
  loading: boolean;
  notice: Notice | null;
  logs: TabLog[];
  selectedRecordIds: string[];
};

type SoqlExecutorWorkspaceProps = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 加载遮罩文案。
  loadingText: string;
};

type BottomView = "result" | "hierarchy" | "logs";

// SOQL 执行器工作区：支持多 Tab、执行、结果展示、层级展示与查询日志。
export function SoqlExecutorWorkspace({ selectedSourceId, loadingText }: SoqlExecutorWorkspaceProps) {
  // SOQL 执行器的多标签状态。
  const [tabs, setTabs] = useState<SoqlExecutorTab[]>(() => [createSoqlExecutorTab(1)]);
  // 当前激活标签 ID。
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  // 底部展示模式：结果 / 层级 / 日志。
  const [bottomView, setBottomView] = useState<BottomView>("result");

  // 当前激活标签数据。
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId]
  );

  // 当前标签的可见列：从结果记录动态抽取顶层字段。
  const visibleColumns = useMemo(() => {
    if (!activeTab) return [];
    return extractVisibleColumns(activeTab.result.records);
  }, [activeTab]);

  // 当前标签的字段元数据映射：执行器模式统一只读，避免误编辑。
  const fieldMetadataMap = useMemo(() => {
    return visibleColumns.reduce((acc, fieldName) => {
      acc[fieldName] = {
        // 禁止更新：DataGrid 将据此禁用编辑。
        updateable: false,
        // 禁止创建：DataGrid 将据此禁用新建场景编辑。
        createable: false
      };
      return acc;
    }, {} as Record<string, Record<string, unknown>>);
  }, [visibleColumns]);

  // 新建一个 SOQL 标签。
  function createTab() {
    const nextIndex = tabs.length + 1;
    const nextTab = createSoqlExecutorTab(nextIndex);
    setTabs((current) => [...current, nextTab]);
    setActiveTabId(nextTab.id);
  }

  // 关闭指定标签，并收敛激活项到可用标签。
  function closeTab(tabId: string) {
    setTabs((current) => {
      const nextTabs = current.filter((item) => item.id !== tabId);
      if (nextTabs.length === 0) {
        const fallback = createSoqlExecutorTab(1);
        setActiveTabId(fallback.id);
        return [fallback];
      }

      if (activeTabId === tabId) {
        setActiveTabId(nextTabs[0].id);
      }
      return nextTabs;
    });
  }

  // 更新当前激活标签（复用函数式更新，避免并发状态覆盖）。
  function patchActiveTab(updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) {
    if (!activeTab) return;
    setTabs((current) => current.map((tab) => (tab.id === activeTab.id ? updater(tab) : tab)));
  }

  // 执行当前标签中的 SOQL 并写入结果与日志。
  async function executeActiveTabSoql() {
    if (!activeTab) return;
    if (!selectedSourceId) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "请先在左侧选择数据源。" }
      }));
      return;
    }

    const trimmedSoql = activeTab.soqlDraft.trim();
    if (!trimmedSoql) {
      patchActiveTab((tab) => ({
        ...tab,
        notice: { type: "error", message: "SOQL 不能为空。" }
      }));
      return;
    }

    patchActiveTab((tab) => ({ ...tab, loading: true, notice: null }));

    try {
      // 调用后端统一查询命令，支持常规查询与复杂子查询。
      const result = await api.queryRecords(selectedSourceId, trimmedSoql);
      const normalizedResult = normalizeQueryResult(result);

      patchActiveTab((tab) => ({
        ...tab,
        result: normalizedResult,
        loading: false,
        selectedRecordIds: [],
        notice: { type: "success", message: `执行成功，返回 ${normalizedResult.totalSize} 条。` },
        logs: [
          buildSoqlLog(true, trimmedSoql, `执行成功，返回 ${normalizedResult.totalSize} 条。`),
          ...tab.logs
        ].slice(0, 200)
      }));
      // 执行成功后自动切到结果视图，提升连续查询效率。
      setBottomView("result");
    } catch (error) {
      patchActiveTab((tab) => ({
        ...tab,
        loading: false,
        notice: { type: "error", message: `执行失败：${String(error)}` },
        logs: [
          buildSoqlLog(false, trimmedSoql, "执行 SOQL 失败。", String(error)),
          ...tab.logs
        ].slice(0, 200)
      }));
      // 执行失败后切到日志视图，便于快速定位问题。
      setBottomView("logs");
    }
  }

  if (!activeTab) {
    return (
      // 防御分支：理论上不会触发，兜底给出可操作入口。
      <div className="flex h-full items-center justify-center">
        <button className="btn btn-primary btn-sm" onClick={createTab}>
          <Plus size={14} />
          新建 SOQL Tab
        </button>
      </div>
    );
  }

  return (
    // 执行器主容器：顶部标签 + 工具条 + 编辑器 + 底部结果区。
    <div className="relative flex h-full min-h-0 flex-col overflow-hidden">
      {/* Tab 栏：支持切换、关闭与右侧新增。 */}
      <div className="flex items-center border-b border-base-300">
        <div className="flex min-w-0 flex-1 overflow-x-auto">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            return (
              <div key={tab.id} className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}>
                <button
                  className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                  onClick={() => setActiveTabId(tab.id)}
                >
                  {tab.name}
                </button>
                <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => closeTab(tab.id)} aria-label={`关闭 ${tab.name}`}>
                  <X size={13} />
                </button>
              </div>
            );
          })}
        </div>
        <button className="btn btn-ghost btn-sm mx-1" onClick={createTab} aria-label="新建 SOQL Tab">
          <Plus size={14} />
        </button>
      </div>

      {/* 当前标签提示。 */}
      {activeTab.notice && (
        <NoticeAlert
          tone={activeTab.notice.type === "error" ? "error" : "success"}
          message={activeTab.notice.message}
          onClose={() => {
            patchActiveTab((tab) => ({ ...tab, notice: null }));
          }}
          className="absolute right-3 top-12 z-30 max-w-[420px] shadow"
        />
      )}

      {/* 顶部工具条：包含执行按钮。 */}
      <div className="border-b border-base-300 px-3 py-2">
        <div className="flex items-center gap-2">
          <button className="btn btn-primary btn-sm" disabled={activeTab.loading} onClick={() => void executeActiveTabSoql()}>
            <Play size={14} />
            执行
          </button>
          <span className="text-[12px] text-neutral/70">支持复杂 SOQL（含子查询），结果展示在底部。</span>
        </div>
      </div>

      {/* SOQL 编辑器区域。 */}
      <div className="border-b border-base-300 p-3">
        <div className="border border-base-300 bg-base-100">
          <textarea
            value={activeTab.soqlDraft}
            onChange={(event) => {
              patchActiveTab((tab) => ({ ...tab, soqlDraft: event.target.value }));
            }}
            className="h-[220px] w-full resize-none overflow-auto border-none bg-base-100 p-2 text-[12px] outline-none"
            style={{ fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace", lineHeight: 1.5 }}
            placeholder="请输入 SOQL，例如：SELECT Id, Name FROM Account LIMIT 20"
          />
        </div>
      </div>

      {/* 底部结果区头部：切换结果 / 层级 / 日志。 */}
      <div className="flex items-center gap-1 border-b border-base-300 px-3 py-1.5">
        <button
          className={`btn btn-xs ${bottomView === "result" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setBottomView("result")}
        >
          <Table2 size={12} />
          结果
        </button>
        <button
          className={`btn btn-xs ${bottomView === "hierarchy" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setBottomView("hierarchy")}
        >
          <TreePine size={12} />
          层级
        </button>
        <button
          className={`btn btn-xs ${bottomView === "logs" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setBottomView("logs")}
        >
          日志
        </button>
      </div>

      {/* 底部结果内容区。 */}
      <div className="min-h-0 flex-1">
        {bottomView === "result" ? (
          <DataGrid
            result={activeTab.result}
            visibleColumns={visibleColumns}
            fieldMetadataMap={fieldMetadataMap}
            dirtyCellKeys={[]}
            selectedRecordIds={activeTab.selectedRecordIds}
            pendingDeleteRecordIds={[]}
            onToggleRecord={(recordId, checked) => {
              patchActiveTab((tab) => ({
                ...tab,
                selectedRecordIds: checked
                  ? Array.from(new Set([...tab.selectedRecordIds, recordId]))
                  : tab.selectedRecordIds.filter((id) => id !== recordId)
              }));
            }}
            onToggleAll={(checked, recordIds) => {
              patchActiveTab((tab) => ({
                ...tab,
                selectedRecordIds: checked ? recordIds : []
              }));
            }}
            onEditCell={() => {
              // 执行器结果表为只读，保持空实现。
            }}
            onShowMessage={(message) => {
              patchActiveTab((tab) => ({
                ...tab,
                notice: { type: "error", message }
              }));
            }}
          />
        ) : bottomView === "hierarchy" ? (
          <div className="h-full overflow-auto p-3">
            {activeTab.result.records.length === 0 ? (
              <span className="text-[12px] text-neutral/70">暂无查询结果。</span>
            ) : (
              <div className="space-y-2">
                {activeTab.result.records.map((record, index) => (
                  <details key={`hier-${index}`} className="rounded border border-base-300 bg-base-100 p-2" open={index === 0}>
                    <summary className="cursor-pointer text-[12px] font-medium">
                      记录 {index + 1} {record.Id ? `(Id: ${String(record.Id)})` : ""}
                    </summary>
                    <div className="mt-2">
                      <HierarchyTree data={record} level={0} />
                    </div>
                  </details>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="h-full overflow-auto p-3">
            {activeTab.logs.length === 0 ? (
              <span className="text-[12px] text-neutral/70">暂无日志。</span>
            ) : (
              activeTab.logs.map((log) => (
                <div key={log.id} className="mb-2 border border-base-300 bg-base-100 p-2">
                  <p className={`mb-1 block text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                    {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                  </p>
                  <p className="block text-[12px]">请求: {log.request}</p>
                  <p className="block text-[12px]">响应: {log.summary}</p>
                  {log.errorMessage && <p className="block text-[12px] text-error">错误: {log.errorMessage}</p>}
                </div>
              ))
            )}
          </div>
        )}
      </div>

      {/* 加载遮罩：执行 SOQL 时展示。 */}
      {activeTab.loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-2 bg-white/70">
          <span className="loading loading-spinner" style={{ width: 42, height: 42 }} />
          <span className="text-[12px] text-neutral/70">{loadingText}</span>
        </div>
      )}
    </div>
  );
}

type HierarchyTreeProps = {
  data: unknown;
  level: number;
};

// 层级树渲染：用于展示复杂 SOQL 返回的一对多结构（子查询 records）。
function HierarchyTree({ data, level }: HierarchyTreeProps) {
  if (data === null || data === undefined) {
    return <p className="text-[12px] text-neutral/70">null</p>;
  }

  if (typeof data !== "object") {
    return <p className="text-[12px]">{String(data)}</p>;
  }

  if (Array.isArray(data)) {
    if (data.length === 0) {
      return <p className="text-[12px] text-neutral/70">[]</p>;
    }
    return (
      <div className="space-y-1">
        {data.map((item, index) => (
          <div key={`arr-${level}-${index}`} className="pl-4">
            <p className="text-[12px] text-neutral/70">[{index}]</p>
            <HierarchyTree data={item} level={level + 1} />
          </div>
        ))}
      </div>
    );
  }

  const entries = Object.entries(data as Record<string, unknown>).filter(([key]) => key !== "attributes");
  if (entries.length === 0) {
    return <p className="text-[12px] text-neutral/70">{"{}"}</p>;
  }

  return (
    <div className="space-y-1">
      {entries.map(([key, value]) => {
        const isChildQueryNode = isSalesforceChildQueryNode(value);
        if (isChildQueryNode) {
          const childRecords = Array.isArray((value as { records?: unknown[] }).records)
            ? ((value as { records: unknown[] }).records || [])
            : [];
          return (
            <details key={`${level}-${key}`} className="rounded border border-base-300 bg-base-100 p-2" open={level < 1}>
              <summary className="cursor-pointer text-[12px]">
                {key}（子记录 {childRecords.length} 条）
              </summary>
              <div className="mt-2 pl-4">
                <HierarchyTree data={childRecords} level={level + 1} />
              </div>
            </details>
          );
        }

        if (value && typeof value === "object") {
          return (
            <details key={`${level}-${key}`} className="rounded border border-base-300 bg-base-100 p-2" open={level < 1}>
              <summary className="cursor-pointer text-[12px]">{key}</summary>
              <div className="mt-2 pl-4">
                <HierarchyTree data={value} level={level + 1} />
              </div>
            </details>
          );
        }

        return (
          <p key={`${level}-${key}`} className="text-[12px]">
            <span className="text-neutral/70">{key}:</span> {String(value)}
          </p>
        );
      })}
    </div>
  );
}

// 判断节点是否为 Salesforce 一对多子查询结构（包含 records 数组）。
function isSalesforceChildQueryNode(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return Array.isArray(node.records) && typeof node.totalSize === "number";
}

// 创建新的 SOQL 执行器标签默认值。
function createSoqlExecutorTab(index: number): SoqlExecutorTab {
  return {
    id: `soql-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `SOQL ${index}`,
    soqlDraft: "",
    result: { totalSize: 0, records: [] },
    loading: false,
    notice: null,
    logs: [],
    selectedRecordIds: []
  };
}

// 构建 SOQL 执行日志条目。
function buildSoqlLog(success: boolean, request: string, summary: string, errorMessage?: string): TabLog {
  return {
    id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    action: "SOQL",
    success,
    request,
    summary,
    errorMessage
  };
}

// 抽取可见列：合并所有记录的顶层键，并过滤 Salesforce attributes。
function extractVisibleColumns(records: Record<string, unknown>[]): string[] {
  const columnSet = new Set<string>();
  records.forEach((record) => {
    Object.keys(record).forEach((key) => {
      if (key === "attributes") return;
      columnSet.add(key);
    });
  });
  return Array.from(columnSet);
}

// 归一化查询结果，避免后端异常格式影响 UI。
function normalizeQueryResult(input: QueryResult): QueryResult {
  const records = Array.isArray(input?.records) ? input.records : [];
  const totalSize = typeof input?.totalSize === "number" ? input.totalSize : records.length;
  return { totalSize, records };
}

// 日志时间格式化。
function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}
