import { X } from "lucide-react";
import { QueryWorkspaceTabItem } from "../types";

type QueryWorkspaceTabsProps = {
  // 统一工作区 Tab 列表（data + console）。
  tabs: QueryWorkspaceTabItem[];
  // 当前激活 Tab ID。
  activeTabId: string;
  // 激活 Tab 回调。
  onActivateTab: (tabId: string) => void;
  // 关闭 Tab 回调。
  onCloseTab: (tabId: string) => void;
};

// Query 工作区统一 Tab 栏：支持 data 与 console 混合展示与切换。
export function QueryWorkspaceTabs({ tabs, activeTabId, onActivateTab, onCloseTab }: QueryWorkspaceTabsProps) {
  return (
    // Tab 栏容器：横向滚动以容纳多个工作区标签。
    <div className="flex overflow-x-auto border-b border-base-300">
      {/* 空态提示：没有任何工作区 Tab 时提示用户从左侧打开对象或控制台。 */}
      {tabs.length === 0 && <span className="px-2 py-1.5 text-[12px] text-neutral/70">请选择左侧 Object 或点击查询控制台</span>}
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          // 单个工作区 Tab：统一样式，不区分 data/console 的交互形态。
          <div key={tab.id} className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}>
            {/* Tab 标题按钮：点击后激活对应工作区。 */}
            <button
              className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
              onClick={() => onActivateTab(tab.id)}
              title={tab.title}
            >
              {tab.title}
            </button>
            {/* 关闭按钮：关闭当前工作区标签。 */}
            <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => onCloseTab(tab.id)} aria-label={`关闭 ${tab.title}`}>
              <X size={13} />
            </button>
          </div>
        );
      })}
    </div>
  );
}
