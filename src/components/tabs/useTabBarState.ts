import { useEffect, useMemo, useState } from "react";
import { DragEndEvent, DragStartEvent } from "@dnd-kit/core";
import { getTabIdsByCloseMode } from "./tabOrder";
import { ReusableTabItem } from "./types";

type TabContextMenuState = {
  // 菜单 X 坐标。
  x: number;
  // 菜单 Y 坐标。
  y: number;
  // 目标标签 ID。
  tabId: string;
};

type UseTabBarStateInput = {
  // 当前全部标签。
  tabs: ReusableTabItem[];
  // 激活标签。
  onActivateTab: (tabId: string) => void;
  // 拖拽排序。
  onReorderTabs?: (activeTabId: string, overTabId: string) => void;
  // 单个关闭。
  onCloseTab?: (tabId: string) => void;
  // 批量关闭。
  onCloseTabs?: (tabIds: string[]) => void;
  // 重命名回调。
  onRenameTab?: (tabId: string, title: string) => void;
};

// 通用标签栏交互状态：统一承载右键菜单、重命名与拖拽状态。
export function useTabBarState({
  tabs,
  onActivateTab,
  onReorderTabs,
  onCloseTab,
  onCloseTabs,
  onRenameTab
}: UseTabBarStateInput) {
  // 右键菜单状态：记录打开位置与目标标签。
  const [contextMenu, setContextMenu] = useState<TabContextMenuState | null>(null);
  // 当前拖拽标签 ID。
  const [activeDragTabId, setActiveDragTabId] = useState<string | null>(null);
  // 当前重命名标签 ID。
  const [renamingTabId, setRenamingTabId] = useState("");
  // 重命名草稿。
  const [renamingDraft, setRenamingDraft] = useState("");

  // 右键菜单目标下标。
  const contextMenuTabIndex = useMemo(
    () => (contextMenu ? tabs.findIndex((tab) => tab.id === contextMenu.tabId) : -1),
    [contextMenu, tabs]
  );

  // 当前菜单目标标签。
  const contextMenuTab = useMemo(
    () => (contextMenu ? tabs.find((tab) => tab.id === contextMenu.tabId) || null : null),
    [contextMenu, tabs]
  );

  // 当前拖拽中的标签实体。
  const activeDragTab = useMemo(
    () => (activeDragTabId ? tabs.find((tab) => tab.id === activeDragTabId) || null : null),
    [activeDragTabId, tabs]
  );

  // 目标左右与其他标签是否存在。
  const hasLeftTabs = contextMenuTabIndex > 0;
  const hasRightTabs = contextMenuTabIndex >= 0 && contextMenuTabIndex < tabs.length - 1;
  const hasOtherTabs = tabs.length > 1;

  // 点击空白、滚动、Esc 时关闭菜单。
  useEffect(() => {
    if (!contextMenu) return;

    const closeMenu = () => {
      setContextMenu(null);
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [contextMenu]);

  // 当前处于重命名态的标签被移除时，自动退出编辑态。
  useEffect(() => {
    if (!renamingTabId) return;
    const targetExists = tabs.some((tab) => tab.id === renamingTabId);
    if (targetExists) return;
    setRenamingTabId("");
    setRenamingDraft("");
  }, [renamingTabId, tabs]);

  // 打开右键菜单。
  function openContextMenu(event: { clientX: number; clientY: number }, tabId: string) {
    setContextMenu({ x: event.clientX, y: event.clientY, tabId });
  }

  // 关闭右键菜单。
  function closeContextMenu() {
    setContextMenu(null);
  }

  // 开始重命名。
  function startRename(tabId: string) {
    const targetTab = tabs.find((tab) => tab.id === tabId);
    if (!targetTab || !targetTab.renameable || !onRenameTab) return;
    onActivateTab(tabId);
    setRenamingTabId(tabId);
    setRenamingDraft(targetTab.title);
    closeContextMenu();
  }

  // 提交重命名。
  function commitRename(tabId: string) {
    const targetTab = tabs.find((tab) => tab.id === tabId);
    if (!targetTab || !onRenameTab) return;
    const nextTitle = renamingDraft.trim() || targetTab.title;
    onRenameTab(tabId, nextTitle);
    setRenamingTabId("");
    setRenamingDraft("");
  }

  // 取消重命名。
  function cancelRename() {
    setRenamingTabId("");
    setRenamingDraft("");
  }

  // 关闭一组标签。
  function closeTabs(tabIds: string[]) {
    if (tabIds.length === 0) return;
    if (onCloseTabs) {
      onCloseTabs(tabIds);
      closeContextMenu();
      return;
    }
    if (tabIds.length === 1 && onCloseTab) {
      onCloseTab(tabIds[0]);
      closeContextMenu();
    }
  }

  // 根据批量关闭模式关闭标签。
  function closeTabsByMode(mode: "left" | "right" | "others" | "all") {
    if (!contextMenuTab) return;
    closeTabs(getTabIdsByCloseMode(tabs, contextMenuTab.id, mode));
  }

  // 拖拽开始时记录活动项并关闭菜单。
  function handleDragStart(event: DragStartEvent) {
    setActiveDragTabId(String(event.active.id));
    closeContextMenu();
  }

  // 拖拽结束时回调排序。
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragTabId(null);
    if (!onReorderTabs) return;
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (!activeId || !overId || activeId === overId) return;
    onReorderTabs(activeId, overId);
  }

  // 拖拽取消时清理拖拽高亮。
  function handleDragCancel() {
    setActiveDragTabId(null);
  }

  return {
    contextMenu,
    contextMenuTab,
    activeDragTab,
    activeDragTabId,
    renamingTabId,
    renamingDraft,
    hasLeftTabs,
    hasRightTabs,
    hasOtherTabs,
    openContextMenu,
    closeContextMenu,
    setRenamingDraft,
    startRename,
    commitRename,
    cancelRename,
    closeTabs,
    closeTabsByMode,
    handleDragStart,
    handleDragEnd,
    handleDragCancel
  };
}
