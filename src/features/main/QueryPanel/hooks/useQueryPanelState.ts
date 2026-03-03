import { useMemo } from "react";
import { QueryPanelViewState } from "../types";

type UseQueryPanelStateResult = {
  // 当前是否处于工作区模式（非设置页）。
  inWorkspaceMode: boolean;
  // Query 导航按钮是否高亮。
  queryRailActive: boolean;
  // 当前数据源下可查询对象名集合（用于补全）。
  queryableObjectNames: string[];
};

// QueryPanel 视图派生状态：集中计算 UI 侧只读派生值，降低组件内逻辑噪音。
export function useQueryPanelState(viewState: QueryPanelViewState): UseQueryPanelStateResult {
  // 当前是否处于工作区模式（非设置页）。
  const inWorkspaceMode = viewState.viewMode !== "settings";
  // Query 按钮激活态：既然左侧仅保留 Query 与 Settings，则只要处于工作区就高亮 Query。
  const queryRailActive = inWorkspaceMode;
  // 可查询对象名列表：供 data 工作区补全对象名。
  const queryableObjectNames = useMemo(
    () => viewState.objects.filter((item) => item.queryable).map((item) => item.name),
    [viewState.objects]
  );

  return {
    inWorkspaceMode,
    queryRailActive,
    queryableObjectNames
  };
}
