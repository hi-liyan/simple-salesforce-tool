import { useMemo, useState } from "react";
import { Play, Plus, Table2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { NoticeAlert } from "../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../components/SoqlMonacoEditor";
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

type BottomView = "result" | "logs";

// SOQL 执行器工作区：支持多 Tab、执行、结果展示与查询日志。
export function SoqlExecutorWorkspace({ selectedSourceId, loadingText }: SoqlExecutorWorkspaceProps) {
  // SOQL 执行器的多标签状态。
  const [tabs, setTabs] = useState<SoqlExecutorTab[]>(() => [createSoqlExecutorTab(1)]);
  // 当前激活标签 ID。
  const [activeTabId, setActiveTabId] = useState<string>(tabs[0].id);
  // 底部展示模式：结果 / 日志。
  const [bottomView, setBottomView] = useState<BottomView>("result");

  // 当前激活标签数据。
  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || null,
    [tabs, activeTabId]
  );

  // 结果表专用数据：关系字段扁平化 + 子查询展开为多行。
  const gridResult = useMemo<QueryResult>(() => {
    if (!activeTab) return { totalSize: 0, records: [] };
    return {
      totalSize: activeTab.result.totalSize,
      records: activeTab.result.records.flatMap((record) => expandRecordForGridRows(record))
    };
  }, [activeTab]);

  // 当前标签可见列：从扁平化后的结果记录动态抽取字段。
  const visibleColumns = useMemo(() => {
    if (!activeTab) return [];
    return extractVisibleColumns(gridResult.records);
  }, [activeTab, gridResult.records]);

  // 当前标签字段元数据映射：执行器模式统一只读，避免误编辑。
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
      // 执行成功后自动切换到结果视图。
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
      // 执行失败后切换到日志视图，便于快速定位问题。
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
    // 执行器主容器：顶部标签 + 工具栏 + 编辑器 + 底部结果区。
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

      {/* 顶部工具栏：包含执行按钮。 */}
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
        {/* SOQL 编辑器：统一复用 Monaco 组件，保持与主工作区一致的编辑体验。 */}
        <SoqlMonacoEditor
          value={activeTab.soqlDraft}
          onChange={(value) => {
            patchActiveTab((tab) => ({ ...tab, soqlDraft: value })); // 同步当前标签草稿。
          }}
          placeholder="请输入 SOQL，例如：SELECT Id, Name FROM Account LIMIT 20"
          height="220px"
        />
      </div>

      {/* 底部结果区头部：切换结果 / 日志。 */}
      <div className="flex items-center gap-1 border-b border-base-300 px-3 py-1.5">
        <button
          className={`btn btn-xs ${bottomView === "result" ? "btn-primary" : "btn-ghost"}`}
          onClick={() => setBottomView("result")}
        >
          <Table2 size={12} />
          结果
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
            result={gridResult}
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

// 主记录展开：主记录 1 行 + 每条子查询记录 1 行。
function expandRecordForGridRows(record: Record<string, unknown>): Record<string, unknown>[] {
  const baseRow: Record<string, unknown> = {};
  const childQueries: Array<{ relationKey: string; records: Record<string, unknown>[] }> = [];

  Object.entries(record).forEach(([key, value]) => {
    if (key === "attributes") return;

    if (isSalesforceChildQueryNode(value)) {
      const childRows = Array.isArray((value as { records?: unknown[] }).records)
        ? ((value as { records: Record<string, unknown>[] }).records || [])
        : [];
      childQueries.push({ relationKey: key, records: childRows });
      return;
    }

    // 展开普通字段和父关系字段（如 xxx__r.Name）。
    flattenNodeToColumns(value, key, baseRow);
  });

  const rows: Record<string, unknown>[] = [];

  childQueries.forEach(({ relationKey, records }) => {
    records.forEach((childRecord, index) => {
      // 近似“合并单元格”效果：仅首行保留主记录字段，其余子行清空主字段。
      const childRow = index === 0 ? { ...baseRow } : ({} as Record<string, unknown>);
      // 子查询字段展开为 `Contacts.Name` 这类点路径列。
      flattenNodeToColumns(childRecord, relationKey, childRow);
      rows.push(childRow);
    });
  });

  // 若存在子查询记录，则仅展示子记录行；若无子记录，则回退展示主记录一行。
  if (rows.length === 0) {
    rows.push(baseRow);
  }

  return rows;
}

// 递归展开节点：例如 `YobuzoTicket__TA_applicant__r.Name` -> 值。
function flattenNodeToColumns(node: unknown, prefix: string, output: Record<string, unknown>) {
  if (node === null || node === undefined) {
    if (prefix) output[prefix] = node;
    return;
  }

  if (typeof node !== "object") {
    if (prefix) output[prefix] = node;
    return;
  }

  if (Array.isArray(node)) {
    if (!prefix) return;
    // 非子查询数组不展开多列，保留 JSON 文本便于查看。
    output[prefix] = JSON.stringify(node);
    return;
  }

  const entries = Object.entries(node as Record<string, unknown>).filter(([key]) => key !== "attributes");
  entries.forEach(([key, value]) => {
    const nextPrefix = prefix ? `${prefix}.${key}` : key;
    flattenNodeToColumns(value, nextPrefix, output);
  });
}

// 判断节点是否为 Salesforce 一对多子查询结构（包含 records 数组）。
function isSalesforceChildQueryNode(value: unknown): boolean {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const node = value as Record<string, unknown>;
  return Array.isArray(node.records) && typeof node.totalSize === "number";
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
