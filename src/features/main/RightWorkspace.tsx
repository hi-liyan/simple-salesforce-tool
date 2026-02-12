import { useEffect, useRef, useState } from "react";
import { PanelRightOpen, Play, Plus, RotateCcw, ScrollText, Search, Trash2, X } from "lucide-react";
import { DataGrid } from "../../components/DataGrid";
import { NoticeAlert } from "../../components/NoticeAlert";
import { SoqlMonacoEditor } from "../../components/SoqlMonacoEditor";
import { Notice, TabState } from "../../types";

type RightWorkspaceProps = {
  // 当前选中的数据源 ID：用于打开外部 Salesforce 页面。
  selectedSourceId: string;
  tabs: TabState[];
  activeTabObjectName: string;
  activeTab: TabState | null;
  workspaceNotice: Notice | null;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  hasPendingChanges: boolean;
  // 待删除记录 Id 列表：用于在表格中高亮“将要删除”的行。
  pendingDeleteRecordIds: string[];
  onActivateTab: (objectName: string) => void;
  onCloseTab: (objectName: string) => void;
  // 关闭当前（右键菜单：关闭当前）。
  onCloseCurrentTab: (objectName: string) => void;
  // 关闭左侧（右键菜单：关闭左侧）。
  onCloseLeftTabs: (objectName: string) => void;
  // 关闭右侧（右键菜单：关闭右侧）。
  onCloseRightTabs: (objectName: string) => void;
  // 关闭其他（右键菜单：关闭其他）。
  onCloseOtherTabs: (objectName: string) => void;
  // 全部关闭（右键菜单：全部关闭）。
  onCloseAllTabs: () => void;
  onCreateRecord: () => void;
  onDeleteCheckedRecords: () => void;
  onApplyPendingChanges: () => void;
  onDiscardPendingChanges: () => void;
  onToggleDrawer: () => void;
  onToggleQueryBar: () => void;
  onToggleLogs: () => void;
  onWhereChange: (value: string) => void;
  onLimitChange: (value: number) => void;
  onSortFieldChange: (value: string) => void;
  onSortDirectionChange: (value: "ASC" | "DESC") => void;
  onQuery: () => void;
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAllRecords: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  onToggleAllFields: () => void;
  onToggleFieldVisibility: (fieldName: string, checked: boolean) => void;
  onSoqlChange: (value: string) => void;
  onExecuteCustomSoql: () => void;
  onCloseWorkspaceNotice: () => void;
  onCloseActiveTabNotice: () => void;
  loadingText: string;
};

// 右侧工作区：包含 Tab、查询工具栏、数据表格、日志面板和字段抽屉。
export function RightWorkspace({
  selectedSourceId,
  tabs,
  activeTabObjectName,
  activeTab,
  workspaceNotice,
  visibleColumns,
  fieldMetadataMap,
  hasPendingChanges,
  pendingDeleteRecordIds,
  onActivateTab,
  onCloseTab,
  onCloseCurrentTab,
  onCloseLeftTabs,
  onCloseRightTabs,
  onCloseOtherTabs,
  onCloseAllTabs,
  onCreateRecord,
  onDeleteCheckedRecords,
  onApplyPendingChanges,
  onDiscardPendingChanges,
  onToggleDrawer,
  onToggleQueryBar,
  onToggleLogs,
  onWhereChange,
  onLimitChange,
  onSortFieldChange,
  onSortDirectionChange,
  onQuery,
  onToggleRecord,
  onToggleAllRecords,
  onEditCell,
  onShowMessage,
  onToggleAllFields,
  onToggleFieldVisibility,
  onSoqlChange,
  onExecuteCustomSoql,
  onCloseWorkspaceNotice,
  onCloseActiveTabNotice,
  loadingText
}: RightWorkspaceProps) {
  // 日志面板高度状态。
  const [logPanelHeight, setLogPanelHeight] = useState(220);
  // 是否正在拖拽日志面板分隔条。
  const [draggingLogResize, setDraggingLogResize] = useState(false);
  const dragStartYRef = useRef(0);
  const dragStartHeightRef = useRef(220);
  // Tab 右键菜单状态：记录显示位置和目标 Tab。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; objectName: string } | null>(null);

  // 日志面板拖拽调整高度。
  useEffect(() => {
    if (!draggingLogResize) return;

    const onMouseMove = (event: MouseEvent) => {
      const delta = dragStartYRef.current - event.clientY;
      const next = dragStartHeightRef.current + delta;
      const max = Math.max(260, Math.floor(window.innerHeight * 0.72));
      setLogPanelHeight(Math.max(140, Math.min(max, next)));
    };

    const onMouseUp = () => {
      setDraggingLogResize(false);
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [draggingLogResize]);

  // 全局关闭右键菜单：点击空白、滚动、按下 ESC 时关闭菜单。
  useEffect(() => {
    if (!tabContextMenu) return;

    const closeMenu = () => {
      setTabContextMenu(null); // 关闭菜单，避免残留浮层。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabContextMenu]);

  // 当前对象可排序字段：仅展示字段元数据中 sortable=true 的字段。
  const sortableFields = (activeTab?.describe?.fields || []).filter((field) => field.metadata?.sortable === true);

  return (
    <>
      {/* 工作区全局提示。 */}
      {workspaceNotice && (
        <NoticeAlert
          tone={workspaceNotice.type === "error" ? "error" : "success"}
          message={workspaceNotice.message}
          onClose={onCloseWorkspaceNotice}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      )}

      {/* Tab 栏。 */}
      <div className="flex overflow-x-auto border-b border-base-300">
        {tabs.length === 0 && <span className="px-2 py-1.5 text-[12px] text-neutral/70">请选择左侧 Object 打开标签页</span>}
        {tabs.map((tab) => {
          const active = tab.objectName === activeTabObjectName;
          const tabIndex = tabs.findIndex((item) => item.objectName === tab.objectName);
          const hasLeftTabs = tabIndex > 0;
          const hasRightTabs = tabIndex >= 0 && tabIndex < tabs.length - 1;
          const hasOtherTabs = tabs.length > 1;
          return (
            <div
              key={tab.objectName}
              className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
              onContextMenu={(event) => {
                event.preventDefault(); // 阻止浏览器默认右键菜单。
                onActivateTab(tab.objectName); // 右键时先切换到目标 Tab，避免操作目标不一致。
                setTabContextMenu({ x: event.clientX, y: event.clientY, objectName: tab.objectName }); // 打开自定义菜单。
              }}
            >
              <button
                className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                onClick={() => onActivateTab(tab.objectName)}
              >
                {tab.objectName}
              </button>
              <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => onCloseTab(tab.objectName)}>
                <X size={13} />
              </button>
              {/* Tab 右键菜单：提供常见批量关闭操作。 */}
              {tabContextMenu?.objectName === tab.objectName && (
                <div
                  className="fixed z-[80] min-w-[132px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
                  style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                  onClick={(event) => event.stopPropagation()}
                >
                  <button
                    className="btn btn-ghost btn-xs w-full justify-start"
                    onClick={() => {
                      onCloseCurrentTab(tab.objectName); // 关闭当前 Tab。
                      setTabContextMenu(null); // 执行后关闭菜单。
                    }}
                  >
                    关闭当前
                  </button>
                  <button
                    className="btn btn-ghost btn-xs w-full justify-start"
                    disabled={!hasLeftTabs}
                    onClick={() => {
                      onCloseLeftTabs(tab.objectName); // 关闭目标 Tab 左侧所有 Tab。
                      setTabContextMenu(null); // 执行后关闭菜单。
                    }}
                  >
                    关闭左侧
                  </button>
                  <button
                    className="btn btn-ghost btn-xs w-full justify-start"
                    disabled={!hasRightTabs}
                    onClick={() => {
                      onCloseRightTabs(tab.objectName); // 关闭目标 Tab 右侧所有 Tab。
                      setTabContextMenu(null); // 执行后关闭菜单。
                    }}
                  >
                    关闭右侧
                  </button>
                  <button
                    className="btn btn-ghost btn-xs w-full justify-start"
                    disabled={!hasOtherTabs}
                    onClick={() => {
                      onCloseOtherTabs(tab.objectName); // 仅保留目标 Tab，关闭其它 Tab。
                      setTabContextMenu(null); // 执行后关闭菜单。
                    }}
                  >
                    关闭其他
                  </button>
                  <button
                    className="btn btn-ghost btn-xs w-full justify-start"
                    disabled={tabs.length === 0}
                    onClick={() => {
                      onCloseAllTabs(); // 关闭全部 Tab。
                      setTabContextMenu(null); // 执行后关闭菜单。
                    }}
                  >
                    全部关闭
                  </button>
                </div>
              )}
            </div>
          );
        })}
      </div>

      {activeTab && (
        // 主工作区。
        <div className="relative flex min-h-0 flex-1 overflow-hidden">
          {/* 当前 Tab 提示。 */}
          {activeTab.notice && (
            <NoticeAlert
              tone={activeTab.notice.type === "error" ? "error" : "success"}
              message={activeTab.notice.message}
              onClose={onCloseActiveTabNotice}
              className="absolute right-3 top-2.5 z-40 max-w-[380px] shadow"
            />
          )}

          {/* 左侧主内容区：工具栏 + 查询栏 + 表格 + 日志。 */}
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="border-b border-base-300 px-3 py-1.5">
              <div className="flex flex-row items-center gap-1">
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onCreateRecord}>
                  <Plus size={14} />
                  新建记录
                </button>
                <button
                  className="btn btn-outline btn-error btn-sm h-10"
                  disabled={activeTab.loading || activeTab.selectedRecordIds.length === 0}
                  onClick={onDeleteCheckedRecords}
                >
                  <Trash2 size={14} />
                  删除勾选({activeTab.selectedRecordIds.length})
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading || !hasPendingChanges} onClick={onApplyPendingChanges}>
                  <Play size={14} />
                  执行更新
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading || !hasPendingChanges} onClick={onDiscardPendingChanges}>
                  <RotateCcw size={14} />
                  撤回修改
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleQueryBar}>
                  <Search size={14} />
                  {activeTab.showQueryBar ? "隐藏查询栏" : "显示查询栏"}
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleDrawer}>
                  <PanelRightOpen size={14} />
                  字段与SOQL
                </button>
                <button className="btn btn-outline btn-sm h-10" disabled={activeTab.loading} onClick={onToggleLogs}>
                  <ScrollText size={14} />
                  日志
                </button>
              </div>
            </div>

            {/* 查询栏。 */}
            {activeTab.showQueryBar && (
              <div className="border-b border-base-300 px-3 py-2">
                <div className="flex flex-row items-center gap-2 flex-nowrap">
                  <div className="w-[320px]">
                    <label className="mb-1 block text-[12px]">WHERE</label>
                    <div className="relative">
                      <input
                        className="input input-bordered input-sm w-full pr-8"
                        value={activeTab.whereClause}
                        onChange={(event) => onWhereChange(event.target.value)}
                      />
                      {activeTab.whereClause ? (
                        <button
                          className="btn btn-circle btn-ghost btn-xs absolute right-1 top-1/2 -translate-y-1/2"
                          aria-label="清空 WHERE 条件"
                          onClick={() => onWhereChange("")}
                        >
                          <X size={13} />
                        </button>
                      ) : null}
                    </div>
                  </div>

                  <div className="w-[90px]">
                    <label className="mb-1 block text-[12px]">LIMIT</label>
                    <input
                      className="input input-bordered input-sm w-full"
                      type="number"
                      value={activeTab.limit}
                      onChange={(event) => onLimitChange(Number(event.target.value || 200))}
                    />
                  </div>

                  <div className="w-[200px]">
                    <label className="mb-1 block text-[12px]">排序字段</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={activeTab.sortField}
                      disabled={sortableFields.length === 0}
                      onChange={(event) => onSortFieldChange(event.target.value)}
                    >
                      {sortableFields.length === 0 && <option value="">无可排序字段</option>}
                      {sortableFields.map((field) => (
                        <option key={field.name} value={field.name}>
                          {field.name}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div className="w-[92px]">
                    <label className="mb-1 block text-[12px]">排序</label>
                    <select
                      className="select select-bordered select-sm w-full"
                      value={activeTab.sortDirection}
                      disabled={!activeTab.sortField}
                      onChange={(event) => onSortDirectionChange(event.target.value as "ASC" | "DESC")}
                    >
                      <option value="ASC">ASC</option>
                      <option value="DESC">DESC</option>
                    </select>
                  </div>

                  <button className="btn btn-primary btn-sm mt-5 h-[35px]" disabled={activeTab.loading} onClick={onQuery}>
                    <Search size={14} />
                    查询
                  </button>
                </div>
              </div>
            )}

            {/* 数据网格区。 */}
            <div className="min-h-0 flex-1">
              <DataGrid
                result={activeTab.result}
                visibleColumns={visibleColumns}
                fieldMetadataMap={fieldMetadataMap}
                dirtyCellKeys={activeTab.dirtyCellKeys}
                selectedRecordIds={activeTab.selectedRecordIds}
                pendingDeleteRecordIds={pendingDeleteRecordIds}
                sourceId={selectedSourceId}
                objectName={activeTab.objectName}
                onToggleRecord={onToggleRecord}
                onToggleAll={onToggleAllRecords}
                onEditCell={onEditCell}
                onShowMessage={onShowMessage}
              />
            </div>

            {/* 日志面板。 */}
            {activeTab.showLogs && (
              <div className="relative flex min-h-0 flex-col border-t border-base-300" style={{ height: logPanelHeight }}>
                <div
                  className="absolute left-0 right-0 top-0 z-[1] h-[6px] cursor-row-resize"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    dragStartYRef.current = event.clientY;
                    dragStartHeightRef.current = logPanelHeight;
                    setDraggingLogResize(true);
                  }}
                />
                <div className="border-b border-base-300 px-3 py-1.5">
                  <div className="flex items-center justify-between">
                    <span className="text-[12px] text-neutral/70">操作日志（当前 Tab）</span>
                    <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleLogs} aria-label="关闭日志">
                      <X size={14} />
                    </button>
                  </div>
                </div>
                <div className="min-h-0 flex-1 overflow-auto px-3 py-2">
                  {activeTab.logs.length === 0 && <span className="text-[12px] text-neutral/70">暂无日志。</span>}
                  {activeTab.logs.map((log) => (
                    <div key={log.id} className="mb-2 border border-base-300 bg-base-100 p-2">
                      <p className={`mb-1 block text-[12px] ${log.success ? "text-success" : "text-error"}`}>
                        {formatLogTime(log.timestamp)} [{log.action}] {log.success ? "成功" : "失败"}
                      </p>
                      <p className="block text-[12px]">请求: {log.request}</p>
                      <p className="block text-[12px]">响应: {log.summary}</p>
                      {log.errorMessage && <p className="block text-[12px] text-error">错误: {log.errorMessage}</p>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* 右侧抽屉：字段列表 + SOQL 编辑器。 */}
          {activeTab.showDrawer && (
            <div className="flex min-h-0 w-[360px] min-w-[360px] flex-col border-l border-base-300">
              <div className="flex min-h-0 flex-[1_1_50%] flex-col border-b border-base-300">
                <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                  <span className="text-[12px] text-neutral/70">Field 元数据</span>
                  <div className="flex flex-row items-center gap-1">
                    <button className="btn btn-ghost btn-xs" disabled={activeTab.loading || !activeTab.describe} onClick={onToggleAllFields}>
                      {activeTab.describe?.fields.every((field) => (activeTab.columnVisibility[field.name] ?? true) === true) ? "取消全选" : "全选"}
                    </button>
                    <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleDrawer} aria-label="关闭字段与SOQL">
                      <X size={14} />
                    </button>
                  </div>
                </div>

                <div className="min-h-0 flex-1 overflow-auto">
                  {!activeTab.describe && (
                    <div className="px-3 py-2">
                      <span className="text-[12px] text-neutral/70">正在加载字段元数据...</span>
                    </div>
                  )}
                  {activeTab.describe && activeTab.describe.fields.length === 0 && (
                    <div className="px-3 py-2">
                      <span className="text-[12px] text-neutral/70">未获取到字段元数据。</span>
                    </div>
                  )}

                  {activeTab.describe?.fields.map((field) => {
                    const checked = activeTab.columnVisibility[field.name] ?? true;
                    return (
                      <div key={field.name} className="px-3 py-2">
                        <div className="flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <input
                              type="checkbox"
                              className="checkbox checkbox-sm"
                              checked={checked}
                              disabled={activeTab.loading}
                              onChange={(event) => onToggleFieldVisibility(field.name, event.target.checked)}
                            />
                            <span className="text-[12px]">{field.name}</span>
                          </div>
                          <span className="truncate text-[12px] text-neutral/70">{field.label} / {field.dataType}</span>
                        </div>
                        <div className="mt-2 border-b border-base-300" />
                      </div>
                    );
                  })}
                </div>
              </div>

              <div className="flex min-h-0 flex-[1_1_50%] flex-col">
                <div className="flex items-center justify-between border-b border-base-300 px-3 py-2">
                  <span className="text-[12px] text-neutral/70">SOQL 执行器</span>
                  <button className="btn btn-circle btn-ghost btn-xs" onClick={onToggleDrawer} aria-label="关闭字段与SOQL">
                    <X size={14} />
                  </button>
                </div>
                <div className="flex min-h-0 flex-1 flex-col overflow-hidden p-3">
                  {/* 编辑器容器：占满剩余空间，避免挤压底部执行按钮。 */}
                  <div className="min-h-0 flex-1">
                    {/* SOQL 编辑器：使用 Monaco 提供语法高亮与自动补全。 */}
                    <SoqlMonacoEditor
                      value={activeTab.soqlDraft}
                      onChange={(value) => onSoqlChange(value)}
                      height="100%"
                      className="h-full"
                      // 当前对象字段名补全。
                      fieldNames={activeTab.describe?.fields.map((field) => field.name) || []}
                      // 当前对象名补全，便于 FROM 子句输入。
                      objectNames={[activeTab.objectName]}
                    />
                  </div>
                  <button className="btn btn-primary btn-sm mt-2 self-start" disabled={activeTab.loading || !activeTab.soqlDraft} onClick={onExecuteCustomSoql}>
                    <Play size={14} />
                    执行 SOQL
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 加载遮罩。 */}
          {activeTab.loading && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-2 bg-white/70">
              <span className="loading loading-spinner" style={{ width: 42, height: 42 }} />
              <span className="text-[12px] text-neutral/70">{loadingText}</span>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// 日志时间格式化。
function formatLogTime(timestamp: string): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) return timestamp;
  return date.toLocaleString();
}
