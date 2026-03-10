import { useEffect, useMemo, useState } from "react";
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
  // 批量关闭 Tab 回调。
  onCloseTabs: (tabIds: string[]) => void;
};

// Query 工作区统一 Tab 栏：支持 data 与 console 混合展示与切换。
export function QueryWorkspaceTabs({ tabs, activeTabId, onActivateTab, onCloseTab, onCloseTabs }: QueryWorkspaceTabsProps) {
  // 统一工作区 Tab 右键菜单状态：记录菜单位置与目标 tabId。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);

  // 右键菜单目标索引：用于判断左侧/右侧是否存在可关闭标签。
  const targetTabIndex = useMemo(
    () => (tabContextMenu ? tabs.findIndex((item) => item.id === tabContextMenu.tabId) : -1),
    [tabs, tabContextMenu]
  );
  // 是否存在左侧标签。
  const hasLeftTabs = targetTabIndex > 0;
  // 是否存在右侧标签。
  const hasRightTabs = targetTabIndex >= 0 && targetTabIndex < tabs.length - 1;
  // 是否存在其他标签。
  const hasOtherTabs = tabs.length > 1;

  // 全局关闭右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!tabContextMenu) return;

    const closeMenu = () => {
      setTabContextMenu(null); // 关闭菜单，避免菜单残留。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [tabContextMenu]);

  // 关闭一组标签：调用批量关闭回调，避免逐个关闭导致状态覆盖。
  function closeTabsByIds(tabIds: string[]) {
    onCloseTabs(tabIds);
    setTabContextMenu(null); // 执行后关闭右键菜单。
  }

  // 关闭当前标签。
  function closeCurrentTab() {
    if (!tabContextMenu) return;
    closeTabsByIds([tabContextMenu.tabId]);
  }

  // 关闭左侧全部标签。
  function closeLeftTabs() {
    if (targetTabIndex <= 0) return;
    closeTabsByIds(tabs.slice(0, targetTabIndex).map((item) => item.id));
  }

  // 关闭右侧全部标签。
  function closeRightTabs() {
    if (targetTabIndex < 0 || targetTabIndex >= tabs.length - 1) return;
    closeTabsByIds(tabs.slice(targetTabIndex + 1).map((item) => item.id));
  }

  // 关闭其他标签（保留当前）。
  function closeOtherTabs() {
    if (!tabContextMenu) return;
    closeTabsByIds(tabs.filter((item) => item.id !== tabContextMenu.tabId).map((item) => item.id));
  }

  // 关闭所有标签。
  function closeAllTabs() {
    closeTabsByIds(tabs.map((item) => item.id));
  }

  return (
    // Tab 栏容器：横向滚动以容纳多个工作区标签。
    <div className="flex overflow-x-auto border-b border-base-300">
      {/* 空态提示：没有任何工作区 Tab 时提示用户从左侧打开对象或控制台。 */}
      {tabs.length === 0 && <span className="px-2 py-1.5 text-[12px] text-neutral/70">请选择左侧 Object 或点击查询控制台</span>}
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        return (
          // 单个工作区 Tab：统一样式，不区分 data/console 的交互形态。
          <div
            key={tab.id}
            className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : ""}`}
            onContextMenu={(event) => {
              event.preventDefault(); // 阻止浏览器默认右键菜单。
              setTabContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); // 仅打开自定义右键菜单，不切换激活 Tab。
            }}
          >
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
            {/* 统一工作区 Tab 右键菜单：提供关闭当前/左右/其他/全部操作。 */}
            {tabContextMenu?.tabId === tab.id && (
              <div
                className="fixed z-[90] min-w-[148px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
                style={{ left: tabContextMenu.x, top: tabContextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button className="btn btn-ghost btn-xs w-full justify-start" onClick={closeCurrentTab}>
                  关闭
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasOtherTabs} onClick={closeOtherTabs}>
                  关闭其他
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={tabs.length === 0} onClick={closeAllTabs}>
                  关闭所有
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasLeftTabs} onClick={closeLeftTabs}>
                  关闭左侧全部
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasRightTabs} onClick={closeRightTabs}>
                  关闭右侧全部
                </button>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
