import { QueryPanelActions, QueryPanelViewState } from "./types";
import { QueryWorkspaceTabs } from "./components/QueryWorkspaceTabs";
import { QuerySidebar } from "./components/QuerySidebar";
import { DataQueryTabPane } from "./components/DataQueryTabPane";
import { ConsoleTabPane } from "./components/ConsoleTabPane";
import { useQueryPanelState } from "./hooks/useQueryPanelState";
import { useEffect, useMemo, useRef, useState } from "react";
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
  // 左侧侧边栏拖拽中的本地宽度：拖拽期间只更新本地状态，避免每一帧都写持久化 store。
  const [sidebarWidthDraft, setSidebarWidthDraft] = useState(viewState.soqlSidebarWidth);
  // 是否正在拖拽左侧栏宽度。
  const [draggingSidebarResize, setDraggingSidebarResize] = useState(false);
  // QueryPanel 根容器：用于按当前可用宽度约束左栏拖拽范围。
  const panelContainerRef = useRef<HTMLDivElement | null>(null);
  // 左栏拖拽起点 X 坐标。
  const sidebarResizeStartXRef = useRef(0);
  // 左栏拖拽起始宽度：使用持久化后的当前宽度作为基准。
  const sidebarResizeStartWidthRef = useRef(viewState.soqlSidebarWidth);
  // 左栏拖拽中的最新宽度引用：供 mouseup 时提交最终结果，避免读取到异步 state 旧值。
  const sidebarWidthDraftRef = useRef(viewState.soqlSidebarWidth);
  // 拖拽前 body 的 user-select 样式，结束后恢复。
  const prevBodyUserSelectRef = useRef("");
  // 拖拽前 body 的 cursor 样式，结束后恢复。
  const prevBodyCursorRef = useRef("");

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

  // 外部持久化宽度变化时同步本地草稿；拖拽过程中保留本地实时宽度，避免被外部值打断手感。
  useEffect(() => {
    if (draggingSidebarResize) return;
    sidebarWidthDraftRef.current = viewState.soqlSidebarWidth;
    setSidebarWidthDraft(viewState.soqlSidebarWidth);
  }, [draggingSidebarResize, viewState.soqlSidebarWidth]);

  // 左侧侧边栏拖拽调整宽度：体验对齐“字段与 Field”抽屉的交互。
  useEffect(() => {
    if (!draggingSidebarResize) return;

    // 进入拖拽时禁用文本选中，并统一鼠标样式，避免误选文字。
    prevBodyUserSelectRef.current = document.body.style.userSelect;
    prevBodyCursorRef.current = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = "col-resize";

    const onMouseMove = (event: MouseEvent) => {
      const deltaX = event.clientX - sidebarResizeStartXRef.current;
      const rawWidth = sidebarResizeStartWidthRef.current + deltaX;
      const containerWidth = panelContainerRef.current?.clientWidth || window.innerWidth;
      const maxWidth = Math.min(560, Math.max(360, Math.floor(containerWidth * 0.5)));
      const nextWidth = Math.max(240, Math.min(maxWidth, rawWidth));
      sidebarWidthDraftRef.current = nextWidth;
      setSidebarWidthDraft(nextWidth); // 行内注释：拖拽中仅更新本地宽度，避免每一帧都触发持久化写入。
    };

    const onMouseUp = () => {
      const nextWidth = sidebarWidthDraftRef.current;
      if (nextWidth !== viewState.soqlSidebarWidth) {
        actions.onSetSoqlSidebarWidth(nextWidth); // 行内注释：仅在拖拽结束时提交最终宽度，保留持久化能力同时减少阻塞。
      }
      setDraggingSidebarResize(false); // 行内注释：鼠标释放后结束拖拽态。
    };

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
      document.body.style.userSelect = prevBodyUserSelectRef.current;
      document.body.style.cursor = prevBodyCursorRef.current;
    };
  }, [actions, draggingSidebarResize, viewState.soqlSidebarWidth]);

  // 常驻挂载 Tab 集合：用于快速判断是否需要渲染对应 pane。
  const mountedWorkspaceTabIdSet = useMemo(() => new Set(mountedWorkspaceTabIds), [mountedWorkspaceTabIds]);
  // 按展示顺序输出“已挂载的工作区 Tab”：保证 DOM 顺序稳定，避免不必要的卸载/重建。
  const mountedWorkspaceTabs = useMemo(
    () => viewState.workspaceTabs.filter((tab) => mountedWorkspaceTabIdSet.has(tab.id)),
    [viewState.workspaceTabs, mountedWorkspaceTabIdSet]
  );
  // 当前激活工作区 tab 的树定位目标：data 指向对象节点，console 指向来源数据源节点。
  const activeWorkspaceTreeTarget = useMemo(() => {
    const activeWorkspaceTab = viewState.workspaceTabs.find((tab) => tab.id === viewState.activeWorkspaceTabId) || null;
    if (!activeWorkspaceTab?.sourceId) return null;
    return {
      kind: activeWorkspaceTab.kind,
      sourceId: activeWorkspaceTab.sourceId,
      objectName: activeWorkspaceTab.kind === "data" ? activeWorkspaceTab.objectName || "" : undefined
    };
  }, [viewState.activeWorkspaceTabId, viewState.workspaceTabs]);

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
    <div ref={panelContainerRef} className="flex h-full w-full overflow-hidden">
      {/* 左侧对象树侧栏。 */}
      <div
        className="flex min-h-0 shrink-0 flex-col border-r border-base-300 bg-white"
        style={{ width: sidebarWidthDraft, minWidth: sidebarWidthDraft }}
      >
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
          activeWorkspaceTreeTarget={activeWorkspaceTreeTarget}
        />
      </div>
      {/* 左侧栏拖拽热区：允许用户按需调整对象树侧栏宽度。 */}
      <div
        className="relative z-20 -ml-[3px] w-[6px] shrink-0 cursor-col-resize bg-transparent"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖拽调整左侧侧边栏宽度"
        onMouseDown={(event) => {
          event.preventDefault(); // 行内注释：阻止拖拽起点触发文本选中。
          sidebarResizeStartXRef.current = event.clientX; // 行内注释：记录本次拖拽起点 X。
          sidebarResizeStartWidthRef.current = sidebarWidthDraftRef.current; // 行内注释：记录当前可见宽度，保证连续拖拽时手感稳定。
          setDraggingSidebarResize(true); // 行内注释：进入拖拽状态。
        }}
      />
      {/* 右侧工作区：Tab 栏 + 内容区。 */}
      <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
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
