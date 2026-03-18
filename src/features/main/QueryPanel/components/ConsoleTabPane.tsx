import { SoqlExecutorWorkspace } from "./SoqlExecutorWorkspace";
import { QueryPanelActions, QueryPanelViewState } from "../types";

type ConsoleTabPaneProps = {
  // QueryPanel 视图状态：提供控制台渲染所需输入。
  viewState: QueryPanelViewState;
  // QueryPanel 行为集合：提供提示关闭等交互回调。
  actions: QueryPanelActions;
  // 当前工作区目标 console Tab ID：用于让每个工作区 Tab 常驻挂载为独立实例。
  consoleTabId: string;
};

// 控制台面板：统一封装控制台工作区渲染，便于 QueryPanel 主体保持精简。
export function ConsoleTabPane({ viewState, actions, consoleTabId }: ConsoleTabPaneProps) {
  return (
    // 控制台工作区：统一在混合工作区下隐藏内置 Tab 栏。
    <SoqlExecutorWorkspace
      selectedSourceId={viewState.selectedSourceId}
      selectedSourceType={viewState.selectedSourceType}
      salesforceTimezone={viewState.salesforceTimezone}
      loadingText={viewState.loadingText}
      objects={viewState.objects}
      workspaceNotice={viewState.workspaceNotice}
      onCloseWorkspaceNotice={actions.onCloseWorkspaceNotice}
      hideTabBar
      forcedTabId={consoleTabId}
      enableGlobalEffects={false}
    />
  );
}
