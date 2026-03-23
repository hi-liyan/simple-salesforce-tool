import { type CSSProperties, type HTMLAttributes, useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  type DragEndEvent,
  type DragStartEvent,
  type Modifier,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { X } from "lucide-react";
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

type SortableWorkspaceTabProps = {
  // Tab 数据。
  tab: QueryWorkspaceTabItem;
  // 当前是否激活。
  active: boolean;
  // 当前是否在拖拽中（用于高亮）。
  isActiveDrag: boolean;
  // 更新右键菜单状态。
  setTabContextMenu: (menu: { x: number; y: number; tabId: string } | null) => void;
  // 激活 Tab 回调。
  onActivateTab: (tabId: string) => void;
  // 关闭 Tab 回调。
  onCloseTab: (tabId: string) => void;
};

type WorkspaceTabViewProps = {
  // Tab 数据。
  tab: QueryWorkspaceTabItem;
  // 当前是否激活。
  active: boolean;
  // 当前是否在拖拽中（用于高亮）。
  isActiveDrag: boolean;
  // 根节点引用：sortable 模式下挂载到真实 DOM。
  setNodeRef?: (element: HTMLDivElement | null) => void;
  // 拖拽根节点属性：由 dnd-kit 注入并合并为标准容器属性。
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  // 根节点样式：用于排序动画。
  style?: CSSProperties;
  // 是否渲染为 Overlay 预览。
  isOverlay?: boolean;
  // 更新右键菜单状态。
  setTabContextMenu: (menu: { x: number; y: number; tabId: string } | null) => void;
  // 激活 Tab 回调。
  onActivateTab: (tabId: string) => void;
  // 关闭 Tab 回调。
  onCloseTab: (tabId: string) => void;
};

// 仅允许横向拖拽，并移除默认缩放，避免 Tab 在拖拽过程中上下漂移或拉伸。
const restrictHorizontalNoScale: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1
});

// 工作区 Tab 纯展示视图：供 sortable 节点与 overlay 共用，避免逻辑重复。
function WorkspaceTabView({
  tab,
  active,
  isActiveDrag,
  setNodeRef,
  dragHandleProps,
  style,
  isOverlay = false,
  setTabContextMenu,
  onActivateTab,
  onCloseTab
}: WorkspaceTabViewProps) {
  return (
    // 单个工作区 Tab：统一样式，不区分 data/console 的交互形态。
    <div
      ref={setNodeRef}
      style={style}
      className={`flex select-none items-center border-r border-base-300 bg-base-100 ${active ? "ring-1 ring-inset ring-primary/25" : ""} ${
        isOverlay ? "" : "cursor-default"
      } ${isActiveDrag ? "opacity-80" : ""}`}
      {...(!isOverlay ? dragHandleProps : undefined)}
      onSelectStart={(event) => {
        event.preventDefault(); // 禁止鼠标拖拽选中文本，避免 Tab 标题被高亮复制。
      }}
      onClick={() => {
        if (isOverlay) return;
        onActivateTab(tab.id); // 点击任意 Tab 区域即可激活对应工作区。
      }}
      onContextMenu={(event) => {
        event.preventDefault(); // 阻止浏览器默认右键菜单。
        if (isOverlay) return; // Overlay 不展示右键菜单，避免遮挡。
        setTabContextMenu({ x: event.clientX, y: event.clientY, tabId: tab.id }); // 仅打开自定义右键菜单，不切换激活 Tab。
      }}
    >
      {/* Tab 标题按钮：点击后激活对应工作区。 */}
      <div className={`min-w-0 select-none px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`} title={tab.title}>
        {tab.title}
      </div>
      {/* 关闭按钮：关闭当前工作区标签。 */}
      {!isOverlay && (
        <button
          className="btn btn-circle btn-ghost btn-xs mr-1 cursor-pointer"
          onClick={(event) => {
            event.stopPropagation(); // 阻止关闭按钮点击触发 Tab 激活或拖拽起始。
            onCloseTab(tab.id);
          }}
          aria-label={`关闭 ${tab.title}`}
        >
          <X size={13} />
        </button>
      )}
    </div>
  );
}

// 可拖拽的工作区 Tab：通过拖拽手柄触发排序，避免与点击激活/关闭冲突。
function SortableWorkspaceTab(props: SortableWorkspaceTabProps) {
  // 绑定 sortable：提供容器引用、拖拽手柄监听和位移动画。
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.tab.id
  });

  // 将 dnd-kit transform 映射为 CSS transform，并固定为纯横向动画。
  const style: CSSProperties = {
    transform: CSS.Transform.toString(
      transform
        ? {
            ...transform,
            y: 0,
            scaleX: 1,
            scaleY: 1
          }
        : null
    ),
    transition
  };

  return (
    <WorkspaceTabView
      {...props}
      isActiveDrag={isDragging || props.isActiveDrag}
      setNodeRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      style={style}
    />
  );
}

// Query 工作区统一 Tab 栏：支持 data 与 console 混合展示与横向拖拽排序。
export function QueryWorkspaceTabs({
  tabs,
  activeTabId,
  onActivateTab,
  onReorderTabs,
  onCloseTab,
  onCloseTabs
}: QueryWorkspaceTabsProps) {
  // 统一工作区 Tab 右键菜单状态：记录菜单位置与目标 tabId。
  const [tabContextMenu, setTabContextMenu] = useState<{ x: number; y: number; tabId: string } | null>(null);
  // 当前拖拽 Tab ID：用于 Overlay 渲染与样式高亮。
  const [activeDragTabId, setActiveDragTabId] = useState<string | null>(null);

  // dnd-kit 传感器：设置最小拖拽距离，避免普通点击误触发拖拽。
  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );

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

  // 拖拽开始：记录当前拖拽 ID，并关闭右键菜单避免遮挡。
  function handleDragStart(event: DragStartEvent) {
    setActiveDragTabId(String(event.active.id)); // 记录拖拽 Tab，供 Overlay 渲染。
    setTabContextMenu(null); // 拖拽时关闭右键菜单，避免层级冲突。
  }

  // 拖拽结束：将 active 与 over 的位置关系交给上层更新顺序。
  function handleDragEnd(event: DragEndEvent) {
    setActiveDragTabId(null); // 清理拖拽态。
    const { active, over } = event;
    if (!over) return;
    const activeId = String(active.id);
    const overId = String(over.id);
    if (activeId === overId) return;
    onReorderTabs(activeId, overId); // 回调上层维护顺序。
  }

  // 当前拖拽 Overlay 对应的 Tab 实体。
  const activeDragTab = useMemo(() => (activeDragTabId ? tabs.find((item) => item.id === activeDragTabId) || null : null), [
    activeDragTabId,
    tabs
  ]);

  return (
    // DndContext：限定为横向拖拽，避免 Tab 在纵向发生位移。
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictHorizontalNoScale]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveDragTabId(null)} // 取消拖拽时清理状态。
    >
      {/* Tab 栏容器：横向滚动以容纳多个工作区标签。 */}
      <div className="flex overflow-x-auto border-b border-base-300">
        {/* 空态提示：没有任何工作区 Tab 时提示用户从左侧打开对象或控制台。 */}
        {tabs.length === 0 && <span className="px-2 py-1.5 text-[12px] text-neutral/70">请选择左侧 Object 或点击查询控制台</span>}
        {/* SortableContext：声明当前可排序 items，并使用横向排序策略。 */}
        <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const isActiveDrag = activeDragTabId === tab.id;
            return (
              <div key={tab.id}>
                {/* 可拖拽 Tab：通过拖拽手柄触发排序。 */}
                <SortableWorkspaceTab
                  tab={tab}
                  active={active}
                  isActiveDrag={isActiveDrag}
                  setTabContextMenu={setTabContextMenu}
                  onActivateTab={onActivateTab}
                  onCloseTab={onCloseTab}
                />
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
        </SortableContext>
      </div>
      {/* 拖拽 Overlay：提供独立预览，避免原节点被滚动容器裁剪。 */}
      <DragOverlay>
        {activeDragTab ? (
          <WorkspaceTabView
            tab={activeDragTab}
            active={activeDragTab.id === activeTabId}
            isActiveDrag
            setTabContextMenu={() => undefined}
            onActivateTab={() => undefined}
            onCloseTab={() => undefined}
            isOverlay
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
