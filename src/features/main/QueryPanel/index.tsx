import { QueryPanelActions, QueryPanelViewState } from "./types";
import { QueryWorkspaceTabs } from "./components/QueryWorkspaceTabs";
import { QuerySidebar } from "./components/QuerySidebar";
import { DataQueryTabPane } from "./components/DataQueryTabPane";
import { ConsoleTabPane } from "./components/ConsoleTabPane";
import { useQueryPanelState } from "./hooks/useQueryPanelState";
import { useEffect, useMemo, useState } from "react";
import { parseWorkspaceTabId } from "./logic/workspaceTabs";
import { getVisibleColumns, hasPendingChanges } from "./logic/queryUtils";
import { SoqlExecutorGlobalEffects } from "./components/SoqlExecutorWorkspace";

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
  // 已常驻挂载的工作区 Tab ID：首次访问时挂载，后续仅隐藏/显示，避免切换时销毁内部状态。
  const [mountedWorkspaceTabIds, setMountedWorkspaceTabIds] = useState<string[]>([]);

  // 工作区焦点变化时：确保当前激活 Tab 被纳入常驻挂载集合。
  useEffect(() => {
    if (!viewState.activeWorkspaceTabId) return;
    setMountedWorkspaceTabIds((current) => {
      if (current.includes(viewState.activeWorkspaceTabId)) return current;
      return [...current, viewState.activeWorkspaceTabId];
    });
  }, [viewState.activeWorkspaceTabId]);

  // Tab 列表变化时：移除已关闭 Tab 的常驻挂载记录，避免内存与事件监听泄漏。
  useEffect(() => {
    const aliveSet = new Set(viewState.workspaceTabs.map((tab) => tab.id));
    setMountedWorkspaceTabIds((current) => {
      // 关键修复：双击侧边栏打开对象时，会先写入 activeWorkspaceTabId，再异步把新 tab 追加到 workspaceTabs。
      // 若这里直接按 aliveSet 过滤，会把“刚激活但尚未出现在 workspaceTabs 的 tabId”删掉，导致 pane 未挂载而出现空白。
      const next = current.filter((tabId) => aliveSet.has(tabId) || tabId === viewState.activeWorkspaceTabId);
      // 当 activeWorkspaceTabId 已出现在 workspaceTabs 时，确保它一定被纳入常驻挂载集合（即使 active 没变化）。
      if (viewState.activeWorkspaceTabId && aliveSet.has(viewState.activeWorkspaceTabId) && !next.includes(viewState.activeWorkspaceTabId)) {
        return [...next, viewState.activeWorkspaceTabId];
      }
      return next;
    });
  }, [viewState.workspaceTabs]);

  // 常驻挂载 Tab 集合：用于快速判断是否需要渲染对应 pane。
  const mountedWorkspaceTabIdSet = useMemo(() => new Set(mountedWorkspaceTabIds), [mountedWorkspaceTabIds]);
  // 按展示顺序输出“已挂载的工作区 Tab”：保证 DOM 顺序稳定，避免不必要的卸载/重建。
  const mountedWorkspaceTabs = useMemo(
    () => viewState.workspaceTabs.filter((tab) => mountedWorkspaceTabIdSet.has(tab.id)),
    [viewState.workspaceTabs, mountedWorkspaceTabIdSet]
  );

  // 构建字段元数据映射：用于 DataGrid 类型推断、可编辑性与 label 显示。
  function buildFieldMetadataMapForTab(tab: QueryPanelViewState["activeTab"]): Record<string, Record<string, unknown>> {
    if (!tab) return {};
    return (
      tab.describe?.fields.reduce(
        (acc, field) => ({
          ...acc,
          [field.name]: {
            // 补齐顶层字段能力，避免仅依赖 metadata 时丢失 nillable/createable/updateable。
            nillable: field.nillable,
            createable: field.createable,
            updateable: field.updateable,
            ...(field.metadata || {}),
            // 补齐统一 type：让 DataGrid 类型策略可识别 MySQL/Salesforce 字段类型。
            type: field.dataType || (field.metadata?.type as string) || ""
          }
        }),
        {} as Record<string, Record<string, unknown>>
      ) || {}
    );
  }

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
          onRefreshMysqlObjectMetadata={actions.onRefreshMysqlObjectMetadata}
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
          onReorderTabs={actions.onReorderWorkspaceTabs}
          onCloseTab={actions.onCloseWorkspaceTab}
          onCloseTabs={actions.onCloseWorkspaceTabs}
        />
        {/* SoqlExecutor 全局副作用：只挂载一次，避免多实例常驻挂载导致重复监听/轮询。 */}
        <SoqlExecutorGlobalEffects />
        {/* 统一工作区内容：每个 workspace tab 各自常驻挂载，切换时仅隐藏/显示。 */}
        <div className="relative flex min-h-0 min-w-0 flex-1 overflow-hidden">
          {mountedWorkspaceTabs.length === 0 && (
            <div className="flex h-full w-full items-center justify-center bg-base-200/35 text-[12px] text-neutral/70">
              请选择左侧 Object 或点击“控制台”打开新的查询 Tab。
            </div>
          )}
          {mountedWorkspaceTabs.map((workspaceTab) => {
            const active = workspaceTab.id === viewState.activeWorkspaceTabId;
            const parsed = parseWorkspaceTabId(workspaceTab.id);
            if (!parsed) return null;

            if (parsed.kind === "console") {
              return (
                <div
                  key={workspaceTab.id}
                  className={
                    active
                      ? "absolute inset-0 z-10 h-full w-full"
                      : "absolute inset-0 z-0 h-full w-full invisible pointer-events-none"
                  }
                  aria-hidden={!active}
                >
                  <ConsoleTabPane viewState={viewState} actions={actions} consoleTabId={parsed.targetId} />
                </div>
              );
            }

            const tabIdentity = parsed.targetId;
            const tab = viewState.tabs.find((item) => item.bindingKey === tabIdentity || item.objectName === tabIdentity) || null;
            const objectName = tab?.objectName || tabIdentity;
            const mysqlDdlState = viewState.mysqlDdlMap[objectName];
            const visibleColumns = tab ? getVisibleColumns(tab) : [];
            const fieldMetadataMap = buildFieldMetadataMapForTab(tab);
            const tabHasPendingChanges = tab ? hasPendingChanges(tab) : false;

            return (
              <div
                key={workspaceTab.id}
                className={
                  active
                    ? "absolute inset-0 z-10 h-full w-full"
                    : "absolute inset-0 z-0 h-full w-full invisible pointer-events-none"
                }
                aria-hidden={!active}
              >
                <DataQueryTabPane
                  selectedSourceId={tab?.sourceId || viewState.selectedSourceId}
                  selectedSourceType={tab?.sourceType || viewState.selectedSourceType}
                  salesforceTimezone={viewState.salesforceTimezone}
                  mysqlDdl={mysqlDdlState?.data || null}
                  mysqlDdlLoading={Boolean(mysqlDdlState?.loading)}
                  mysqlDdlError={mysqlDdlState?.error || ""}
                  tabs={viewState.tabs}
                  activeTabObjectName={tabIdentity}
                  activeTab={tab}
                  workspaceNotice={viewState.workspaceNotice}
                  visibleColumns={visibleColumns}
                  fieldMetadataMap={fieldMetadataMap}
                  hasPendingChanges={tabHasPendingChanges}
                  pendingDeleteRecordIds={tab?.pendingDeleteRecordIds ?? []}
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
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export type { QueryPanelActions, QueryPanelViewState } from "./types";
