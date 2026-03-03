import { useEffect, useRef, useState } from "react";
import { Braces, Settings, Table2 } from "lucide-react";
import { LeftSidebar } from "../LeftSidebar";
import { RightWorkspace } from "../RightWorkspace";
import { SettingsPanel } from "../SettingsPanel";
import { SoqlExecutorWorkspace } from "../SoqlExecutorWorkspace";
import { MainLayout } from "../../../layouts/MainLayout";
import { QueryPanelActions, QueryPanelViewState } from "./types";

type QueryPanelProps = {
  // QueryPanel 视图状态。
  viewState: QueryPanelViewState;
  // QueryPanel 行为回调。
  actions: QueryPanelActions;
};

// QueryPanel：统一承载 Query/SOQL/设置三种视图，降低 MainPage 的 UI 编排复杂度。
export function QueryPanel({ viewState, actions }: QueryPanelProps) {
  // SOQL 模式左侧栏拖拽状态。
  const [soqlSidebarResizing, setSoqlSidebarResizing] = useState(false);
  // 拖拽起始点 X。
  const soqlResizeStartXRef = useRef(0);
  // 拖拽起始宽度。
  const soqlResizeStartWidthRef = useRef(viewState.soqlSidebarWidth);
  // 拖拽前 body 的 user-select 样式。
  const prevBodyUserSelectRef = useRef("");
  // 拖拽前 body 的 cursor 样式。
  const prevBodyCursorRef = useRef("");

  // 拖拽侧栏宽度：仅在 SOQL 工作区使用。
  useEffect(() => {
    if (!soqlSidebarResizing) return;

    prevBodyUserSelectRef.current = document.body.style.userSelect;
    prevBodyCursorRef.current = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - soqlResizeStartXRef.current;
      const rawWidth = soqlResizeStartWidthRef.current + deltaX;
      const maxWidth = Math.max(420, Math.floor(window.innerWidth * 0.6));
      const nextWidth = Math.max(240, Math.min(maxWidth, rawWidth));
      actions.onSetSoqlSidebarWidth(nextWidth); // 将宽度更新委托给外层 store。
    };

    const onMouseUp = () => {
      setSoqlSidebarResizing(false); // 结束拖拽状态。
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = prevBodyUserSelectRef.current;
      document.body.style.cursor = prevBodyCursorRef.current;
    };
  }, [soqlSidebarResizing, actions]);

  return (
    // 主布局：左侧导航 + 右侧内容区。
    <MainLayout
      navRail={
        // 导航栏按钮区。
        <div className="flex flex-col items-center gap-1 py-2">
          {/* Query 工作区入口。 */}
          <button
            className={`tool-rail-btn ${viewState.viewMode === "query" ? "tool-rail-btn--active" : ""}`}
            title="Query 布局"
            onClick={() => actions.onSetViewMode("query")}
          >
            <Table2 size={16} />
          </button>
          {/* 查询控制台入口。 */}
          <button
            className={`tool-rail-btn ${viewState.viewMode === "soqlExecutor" ? "tool-rail-btn--active" : ""}`}
            title="查询控制台"
            onClick={() => actions.onSetViewMode("soqlExecutor")}
          >
            <Braces size={16} />
          </button>
          {/* 设置入口。 */}
          <button
            className={`tool-rail-btn ${viewState.viewMode === "settings" ? "tool-rail-btn--active" : ""}`}
            title="设置"
            onClick={() => actions.onSetViewMode("settings")}
          >
            <Settings size={16} />
          </button>
        </div>
      }
      content={
        <>
          {/* Query 视图：对象列表 + 数据工作区。 */}
          {viewState.viewMode === "query" && (
            <div className="grid h-full w-full grid-cols-[320px_1fr] overflow-hidden">
              <div className="flex min-h-0 flex-col border-r border-base-300">
                <LeftSidebar
                  sources={viewState.sources}
                  selectedSourceId={viewState.selectedSourceId}
                  pageLoading={viewState.pageLoading}
                  objectsLoading={viewState.objectsLoading}
                  onOpenAuthWindow={actions.onOpenAuthWindow}
                  onChangeSource={actions.onChangeSource}
                  onRefreshSources={actions.onRefreshSources}
                  onOpenConsole={actions.onOpenConsole}
                  objects={viewState.objects}
                  activeTabObjectName={viewState.activeTabObjectName}
                  onOpenObject={actions.onOpenObject}
                  onNotQueryableObjectClick={actions.onNotQueryableObjectClick}
                  objectListMode="list"
                />
              </div>
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                <RightWorkspace
                  selectedSourceId={viewState.selectedSourceId}
                  selectedSourceType={viewState.selectedSourceType}
                  salesforceTimezone={viewState.salesforceTimezone}
                  mysqlDdl={viewState.mysqlDdl}
                  mysqlDdlLoading={viewState.mysqlDdlLoading}
                  mysqlDdlError={viewState.mysqlDdlError}
                  tabs={viewState.tabs}
                  activeTabObjectName={viewState.activeTabObjectName}
                  activeTab={viewState.activeTab}
                  workspaceNotice={viewState.workspaceNotice}
                  visibleColumns={viewState.visibleColumns}
                  fieldMetadataMap={viewState.fieldMetadataMap}
                  hasPendingChanges={viewState.hasPendingChanges}
                  pendingDeleteRecordIds={viewState.pendingDeleteRecordIds}
                  onActivateTab={actions.onActivateTab}
                  onCloseTab={actions.onCloseTab}
                  onCloseCurrentTab={actions.onCloseCurrentTab}
                  onCloseLeftTabs={actions.onCloseLeftTabs}
                  onCloseRightTabs={actions.onCloseRightTabs}
                  onCloseOtherTabs={actions.onCloseOtherTabs}
                  onCloseAllTabs={actions.onCloseAllTabs}
                  onCreateRecord={actions.onCreateRecord}
                  onDeleteCheckedRecords={actions.onDeleteCheckedRecords}
                  onApplyPendingChanges={actions.onApplyPendingChanges}
                  onDiscardPendingChanges={actions.onDiscardPendingChanges}
                  onToggleDrawer={actions.onToggleDrawer}
                  onRefreshMysqlDdl={actions.onRefreshMysqlDdl}
                  onToggleQueryBar={actions.onToggleQueryBar}
                  onToggleLogs={actions.onToggleLogs}
                  onWhereChange={actions.onWhereChange}
                  onLimitChange={actions.onLimitChange}
                  onSortFieldChange={actions.onSortFieldChange}
                  onSortDirectionChange={actions.onSortDirectionChange}
                  onSortClauseChange={actions.onSortClauseChange}
                  onQuery={actions.onQuery}
                  onToggleRecord={actions.onToggleRecord}
                  onToggleAllRecords={actions.onToggleAllRecords}
                  onEditCell={actions.onEditCell}
                  onShowMessage={actions.onShowMessage}
                  onToggleAllFields={actions.onToggleAllFields}
                  onToggleFieldVisibility={actions.onToggleFieldVisibility}
                  onSoqlChange={actions.onSoqlChange}
                  onExecuteCustomSoql={actions.onExecuteCustomSoql}
                  onCloseWorkspaceNotice={actions.onCloseWorkspaceNotice}
                  onCloseActiveTabNotice={actions.onCloseActiveTabNotice}
                  loadingText={viewState.loadingText}
                  objectNames={viewState.objects.filter((item) => item.queryable).map((item) => item.name)}
                />
              </div>
            </div>
          )}

          {/* SOQL 执行器面板：常驻挂载，切换时只隐藏。 */}
          <div className={viewState.viewMode === "soqlExecutor" ? "flex h-full w-full overflow-hidden" : "hidden h-full w-full"}>
            {/* 左侧对象树区：SOQL 模式采用 tree。 */}
            <div className="relative flex min-h-0 flex-col border-r border-base-300" style={{ width: viewState.soqlSidebarWidth }}>
              <LeftSidebar
                sources={viewState.sources}
                selectedSourceId={viewState.selectedSourceId}
                pageLoading={viewState.pageLoading}
                objectsLoading={viewState.objectsLoading}
                onOpenAuthWindow={actions.onOpenAuthWindow}
                onChangeSource={actions.onChangeSource}
                onRefreshSources={actions.onRefreshSources}
                onOpenConsole={actions.onOpenConsole}
                objects={viewState.objects}
                activeTabObjectName={viewState.activeTabObjectName}
                onOpenObject={actions.onOpenObject}
                onNotQueryableObjectClick={actions.onNotQueryableObjectClick}
                objectListMode="tree"
              />
              {/* 侧栏宽度拖拽热区。 */}
              <div
                className="absolute -right-[3px] top-0 z-20 h-full w-[6px] cursor-col-resize"
                role="separator"
                aria-orientation="vertical"
                aria-label="拖拽调整侧栏宽度"
                onMouseDown={(event) => {
                  event.preventDefault();
                  soqlResizeStartXRef.current = event.clientX;
                  soqlResizeStartWidthRef.current = viewState.soqlSidebarWidth;
                  setSoqlSidebarResizing(true); // 进入拖拽状态。
                }}
              />
            </div>
            {/* 右侧执行器工作区。 */}
            <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
              <SoqlExecutorWorkspace
                selectedSourceId={viewState.selectedSourceId}
                selectedSourceType={viewState.selectedSourceType}
                salesforceTimezone={viewState.salesforceTimezone}
                loadingText={viewState.loadingText}
                objects={viewState.objects}
                workspaceNotice={viewState.workspaceNotice}
                onCloseWorkspaceNotice={actions.onCloseWorkspaceNotice}
              />
            </div>
          </div>

          {/* 设置视图。 */}
          {viewState.viewMode === "settings" && <SettingsPanel />}
        </>
      }
    />
  );
}
