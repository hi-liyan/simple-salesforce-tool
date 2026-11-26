import { SoqlExecutorWorkspace } from "./SoqlExecutorWorkspace";
import type { QueryPanelActions, QueryPanelViewState } from "../types";
import { useSoqlExecutorStore } from "../../../../store/useSoqlExecutorStore.ts";

type ConsoleTabPaneProps = {
  // QueryPanel 视图状态：提供控制台渲染所需输入。
  viewState: QueryPanelViewState;
  // QueryPanel 行为集合：提供提示关闭与刷新回调。
  actions: QueryPanelActions;
  // 当前工作区目标 console Tab ID：用于让每个工作区 Tab 常驻挂载为独立实例。
  consoleTabId: string;
};

// 控制台面板：统一封装控制台工作区渲染，传入全量数据源供右侧选择器切换绑定。
export function ConsoleTabPane({ viewState, actions, consoleTabId }: ConsoleTabPaneProps) {
  // 读取目标 console tab 的来源数据源：确保常驻挂载实例始终使用 tab 自身上下文。
  const consoleTab = useSoqlExecutorStore((state) => state.tabs.find((tab) => tab.id === consoleTabId) || null);

  return (
    <SoqlExecutorWorkspace
      sources={viewState.sources}
      selectedSourceId={consoleTab?.sourceId || viewState.selectedSourceId}
      selectedSourceType={consoleTab?.sourceType || viewState.selectedSourceType}
      salesforceTimezone={viewState.salesforceTimezone}
      loadingText={viewState.loadingText}
      objects={viewState.objects}
      workspaceNotice={viewState.workspaceNotice}
      onCloseWorkspaceNotice={actions.onCloseWorkspaceNotice}
      hideTabBar
      forcedTabId={consoleTabId}
      onDdlExecuted={(sourceId) => {
        if (sourceId) {
          actions.onRefreshSources(sourceId);
        }
      }}
    />
  );
}
