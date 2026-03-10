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

// QueryPanel：仅承载 Query 工作区（对象树 + data/console 混合 Tab）。
export function QueryPanel({ viewState, actions }: QueryPanelProps) {
  // QueryPanel 派生视图状态：集中管理对象补全集合。
  const { queryableObjectNames } = useQueryPanelState(viewState);

  return (
    // Query 统一工作区：对象树 + 混合 Tab（data/console）。
    <div className="grid h-full w-full grid-cols-[320px_1fr] overflow-hidden">
      {/* 左侧对象树侧栏。 */}
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
      {/* 右侧工作区：Tab 栏 + 内容区。 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">
        {/* 统一工作区 Tab 栏：data 与 console 混合显示。 */}
        <QueryWorkspaceTabs
          tabs={viewState.workspaceTabs}
          activeTabId={viewState.activeWorkspaceTabId}
          onActivateTab={actions.onActivateWorkspaceTab}
          onCloseTab={actions.onCloseWorkspaceTab}
          onCloseTabs={actions.onCloseWorkspaceTabs}
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
  );
}

export type { QueryPanelActions, QueryPanelViewState } from "./types";
