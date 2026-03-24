import { ReusableTabs } from "../../../../components/tabs/ReusableTabs";
import { QueryWorkspaceTabItem } from "../types";

type QueryWorkspaceTabsProps = {
  // 统一工作区 Tab 列表（data + console）。
  tabs: QueryWorkspaceTabItem[];
  // 当前激活 Tab ID。
  activeTabId: string;
  // 激活 Tab 回调。
  onActivateTab: (tabId: string) => void;
  // 拖拽排序回调：由上层维护展示顺序。
  onReorderTabs: (activeTabId: string, overTabId: string) => void;
  // 关闭 Tab 回调。
  onCloseTab: (tabId: string) => void;
  // 批量关闭 Tab 回调。
  onCloseTabs: (tabIds: string[]) => void;
};

// Query 工作区统一 Tab 栏：支持 data 与 console 混合展示与横向拖拽排序。
export function QueryWorkspaceTabs({
  tabs,
  activeTabId,
  onActivateTab,
  onReorderTabs,
  onCloseTab,
  onCloseTabs
}: QueryWorkspaceTabsProps) {
  return (
    <ReusableTabs
      tabs={tabs.map((tab) => ({
        id: tab.id,
        title: tab.title,
        closable: true,
        renameable: false
      }))}
      activeTabId={activeTabId}
      emptyText="请选择左侧 Object 或点击查询控制台"
      onActivateTab={onActivateTab}
      onReorderTabs={onReorderTabs}
      onCloseTab={onCloseTab}
      onCloseTabs={onCloseTabs}
    />
  );
}
