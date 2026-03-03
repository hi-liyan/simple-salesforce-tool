import { Settings, Table2 } from "lucide-react";
import { SettingsPanel } from "../SettingsPanel";
import { MainLayout } from "../../../layouts/MainLayout";
import { QueryPanelActions, QueryPanelViewState } from "./types";
import { QueryWorkspaceTabs } from "./components/QueryWorkspaceTabs";
import { QuerySidebar } from "./components/QuerySidebar";
import { DataQueryTabPane } from "./components/DataQueryTabPane";
import { ConsoleTabPane } from "./components/ConsoleTabPane";
import { useQueryPanelState } from "./hooks/useQueryPanelState";

type QueryPanelProps = {
  // QueryPanel 视图状态。
  viewState: QueryPanelViewState;
  // QueryPanel 行为回调。
  actions: QueryPanelActions;
};

// QueryPanel：统一承载 Query/SOQL/设置三种视图，降低 MainPage 的 UI 编排复杂度。
export function QueryPanel({ viewState, actions }: QueryPanelProps) {
  // QueryPanel 派生视图状态：集中管理按钮高亮、工作区模式与对象补全集合。
  const { inWorkspaceMode, queryRailActive, queryableObjectNames } = useQueryPanelState(viewState);

  return (
    // 主布局：左侧导航 + 右侧内容区。
    <MainLayout
      navRail={
        // 导航栏按钮区。
        <div className="flex flex-col items-center gap-1 py-2">
          {/* Query 工作区入口。 */}
          <button
            className={`tool-rail-btn ${queryRailActive ? "tool-rail-btn--active" : ""}`}
            title="Query 布局"
            onClick={() => actions.onSetViewMode("query")}
          >
            <Table2 size={16} />
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
          {/* 统一工作区：对象树 + 混合 Tab（data/console）。 */}
          {inWorkspaceMode && (
            <div className="grid h-full w-full grid-cols-[320px_1fr] overflow-hidden">
              <div className="flex min-h-0 flex-col border-r border-base-300">
                <QuerySidebar
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
              </div>
              <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
                {/* 统一工作区 Tab 栏：data 与 console 混合显示。 */}
                <QueryWorkspaceTabs
                  tabs={viewState.workspaceTabs}
                  activeTabId={viewState.activeWorkspaceTabId}
                  onActivateTab={actions.onActivateWorkspaceTab}
                  onCloseTab={actions.onCloseWorkspaceTab}
                />
                {/* 统一工作区内容：按激活 Tab 类型切换 data 面板或 console 面板。 */}
                {viewState.activeWorkspaceTabKind === "console" ? (
                  <ConsoleTabPane viewState={viewState} actions={actions} />
                ) : (
                  <DataQueryTabPane
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
                    objectNames={queryableObjectNames}
                    hideTabBar
                  />
                )}
              </div>
            </div>
          )}

          {/* 设置视图。 */}
          {viewState.viewMode === "settings" && <SettingsPanel />}
        </>
      }
    />
  );
}

export type { QueryPanelActions, QueryPanelViewState } from "./types";
