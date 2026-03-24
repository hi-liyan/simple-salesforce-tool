import { type CSSProperties, type HTMLAttributes, type MouseEvent, type ReactNode, useEffect, useRef } from "react";
import {
  closestCenter,
  DndContext,
  DragOverlay,
  PointerSensor,
  useSensor,
  useSensors,
  type Modifier
} from "@dnd-kit/core";
import { SortableContext, horizontalListSortingStrategy, useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { Plus, X } from "lucide-react";
import { useTabBarState } from "./useTabBarState";
import { ReusableTabItem, ReusableTabsProps, ReusableTabStatusTone } from "./types";

type TabViewProps = {
  // 当前标签数据。
  tab: ReusableTabItem;
  // 是否激活。
  active: boolean;
  // 是否处于当前拖拽态。
  isActiveDrag: boolean;
  // 是否为拖拽占位节点。
  isPlaceholder?: boolean;
  // 是否为 overlay 预览节点。
  isOverlay?: boolean;
  // 根节点引用。
  setNodeRef?: (element: HTMLDivElement | null) => void;
  // 可拖拽属性。
  dragHandleProps?: HTMLAttributes<HTMLDivElement>;
  // 排序动画样式。
  style?: CSSProperties;
  // 当前是否处于重命名态。
  renaming: boolean;
  // 重命名输入草稿。
  renamingDraft: string;
  // 更新草稿。
  onRenameDraftChange: (value: string) => void;
  // 激活标签。
  onActivateTab: (tabId: string) => void;
  // 打开右键菜单。
  onOpenContextMenu: (event: MouseEvent<HTMLDivElement>, tabId: string) => void;
  // 开始重命名。
  onStartRename: (tabId: string) => void;
  // 提交重命名。
  onCommitRename: (tabId: string) => void;
  // 取消重命名。
  onCancelRename: () => void;
  // 关闭标签。
  onCloseTab?: (tabId: string) => void;
  // 额外内容。
  renderTabSuffix?: (tab: ReusableTabItem) => ReactNode;
};

// 仅允许横向拖拽，避免拖拽过程中出现纵向位移和缩放。
const restrictHorizontalNoScale: Modifier = ({ transform }) => ({
  ...transform,
  y: 0,
  scaleX: 1,
  scaleY: 1
});

// 状态点样式映射。
const TAB_STATUS_CLASSNAME: Record<ReusableTabStatusTone, string> = {
  success: "bg-success",
  warning: "bg-warning",
  error: "bg-error",
  idle: "bg-neutral/30"
};

// 单个标签视图：供可排序标签与拖拽 overlay 共用。
function TabView({
  tab,
  active,
  isActiveDrag,
  isPlaceholder = false,
  isOverlay = false,
  setNodeRef,
  dragHandleProps,
  style,
  renaming,
  renamingDraft,
  onRenameDraftChange,
  onActivateTab,
  onOpenContextMenu,
  onStartRename,
  onCommitRename,
  onCancelRename,
  onCloseTab,
  renderTabSuffix
}: TabViewProps) {
  // 重命名输入框引用：进入编辑态后自动聚焦并全选。
  const renameInputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!renaming) return;
    window.requestAnimationFrame(() => {
      renameInputRef.current?.focus();
      renameInputRef.current?.select();
    });
  }, [renaming]);

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`flex select-none items-center border-r border-base-300 bg-base-100 ${active ? "ring-1 ring-inset ring-primary/25" : ""} ${
        isPlaceholder ? "pointer-events-none opacity-0" : ""
      } ${isOverlay ? "" : "cursor-default"}`}
      {...(!isOverlay ? dragHandleProps : undefined)}
      onMouseDown={(event) => {
        if (event.button !== 0) return;
        event.preventDefault();
      }}
      onClick={() => {
        if (isOverlay || renaming) return;
        onActivateTab(tab.id);
      }}
      onContextMenu={(event) => {
        if (isOverlay) return;
        event.preventDefault();
        onOpenContextMenu(event, tab.id);
      }}
    >
      {renaming ? (
        <input
          ref={renameInputRef}
          type="text"
          className={`h-[32px] min-w-0 max-w-[240px] bg-transparent px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral"} outline-none`}
          value={renamingDraft}
          onChange={(event) => onRenameDraftChange(event.target.value)}
          onBlur={() => onCommitRename(tab.id)}
          onClick={(event) => event.stopPropagation()}
          onDoubleClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            event.stopPropagation();
            if (event.key === "Enter") {
              event.preventDefault();
              onCommitRename(tab.id);
              return;
            }
            if (event.key === "Escape") {
              event.preventDefault();
              onCancelRename();
            }
          }}
          title={tab.title}
        />
      ) : (
        <button
          type="button"
          className={`flex min-w-0 max-w-[260px] items-center gap-2 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
          onClick={() => onActivateTab(tab.id)}
          onDoubleClick={() => {
            if (!tab.renameable) return;
            onStartRename(tab.id);
          }}
          title={tab.titleTooltip || (tab.renameable ? "双击可重命名" : tab.title)}
        >
          <span className="truncate">{tab.title}</span>
          {tab.statusTone ? <span className={`inline-block h-2 w-2 shrink-0 rounded-full ${TAB_STATUS_CLASSNAME[tab.statusTone]}`} /> : null}
          {renderTabSuffix ? renderTabSuffix(tab) : null}
        </button>
      )}
      {tab.closable !== false && !isOverlay && onCloseTab ? (
        <button
          type="button"
          className={`btn btn-circle btn-ghost btn-xs mr-1 ${isActiveDrag ? "pointer-events-none" : "cursor-pointer"}`}
          onClick={(event) => {
            event.stopPropagation();
            onCloseTab(tab.id);
          }}
          aria-label={`关闭 ${tab.title}`}
        >
          <X size={13} />
        </button>
      ) : null}
    </div>
  );
}

type SortableTabProps = Omit<TabViewProps, "setNodeRef" | "dragHandleProps" | "style">;

// 可拖拽标签节点：将 dnd-kit 提供的位移和动画映射为通用标签视图。
function SortableTab(props: SortableTabProps) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({
    id: props.tab.id
  });

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
    <TabView
      {...props}
      isActiveDrag={isDragging || props.isActiveDrag}
      isPlaceholder={isDragging}
      setNodeRef={setNodeRef}
      dragHandleProps={{ ...attributes, ...listeners }}
      style={style}
    />
  );
}

// 通用多标签栏：统一提供拖拽、右键菜单、双击重命名与新增入口。
export function ReusableTabs({
  tabs,
  activeTabId,
  emptyText,
  createButtonTitle,
  onActivateTab,
  onCreateTab,
  onReorderTabs,
  onRenameTab,
  onCloseTab,
  onCloseTabs,
  renderTabSuffix
}: ReusableTabsProps) {
  const {
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
  } = useTabBarState({
    tabs,
    onActivateTab,
    onReorderTabs,
    onCloseTab,
    onCloseTabs,
    onRenameTab
  });

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );

  const enableSort = Boolean(onReorderTabs);
  const content = (
    <div className="flex overflow-x-auto border-b border-base-300 bg-base-100">
      {tabs.length === 0 && emptyText ? <span className="px-2 py-1.5 text-[12px] text-neutral/70">{emptyText}</span> : null}
      {tabs.map((tab) => {
        const active = tab.id === activeTabId;
        const renaming = renamingTabId === tab.id;
        const commonProps: SortableTabProps = {
          tab,
          active,
          isActiveDrag: activeDragTabId === tab.id,
          renaming,
          renamingDraft: renaming ? renamingDraft : tab.title,
          onRenameDraftChange: setRenamingDraft,
          onActivateTab,
          onOpenContextMenu: openContextMenu,
          onStartRename: startRename,
          onCommitRename: commitRename,
          onCancelRename: cancelRename,
          onCloseTab: onCloseTab ? (tabId) => closeTabs([tabId]) : undefined,
          renderTabSuffix
        };

        return (
          <div key={tab.id}>
            {enableSort ? <SortableTab {...commonProps} /> : <TabView {...commonProps} />}
            {contextMenu?.tabId === tab.id && contextMenuTab ? (
              <div
                className="fixed z-[90] min-w-[148px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
                style={{ left: contextMenu.x, top: contextMenu.y }}
                onClick={(event) => event.stopPropagation()}
              >
                <button
                  className="btn btn-ghost btn-xs w-full justify-start"
                  disabled={!contextMenuTab.renameable || !onRenameTab}
                  onClick={() => startRename(tab.id)}
                >
                  重命名
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!onCloseTab && !onCloseTabs} onClick={() => closeTabs([tab.id])}>
                  关闭当前
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasLeftTabs || !onCloseTabs} onClick={() => closeTabsByMode("left")}>
                  关闭左侧
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasRightTabs || !onCloseTabs} onClick={() => closeTabsByMode("right")}>
                  关闭右侧
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={!hasOtherTabs || !onCloseTabs} onClick={() => closeTabsByMode("others")}>
                  关闭其他
                </button>
                <button className="btn btn-ghost btn-xs w-full justify-start" disabled={tabs.length === 0 || !onCloseTabs} onClick={() => closeTabsByMode("all")}>
                  全部关闭
                </button>
              </div>
            ) : null}
          </div>
        );
      })}
      {onCreateTab ? (
        <button type="button" className="btn btn-ghost btn-sm mx-2 shrink-0" onClick={onCreateTab} title={createButtonTitle || "新建标签"}>
          <Plus size={14} />
        </button>
      ) : null}
    </div>
  );

  if (!enableSort) {
    return content;
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[restrictHorizontalNoScale]}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
      onDragCancel={() => {
        handleDragCancel();
        closeContextMenu();
      }}
    >
      <SortableContext items={tabs.map((tab) => tab.id)} strategy={horizontalListSortingStrategy}>
        {content}
      </SortableContext>
      <DragOverlay>
        {activeDragTab ? (
          <TabView
            tab={activeDragTab}
            active={activeDragTab.id === activeTabId}
            isActiveDrag
            isOverlay
            renaming={false}
            renamingDraft={activeDragTab.title}
            onRenameDraftChange={() => undefined}
            onActivateTab={() => undefined}
            onOpenContextMenu={() => undefined}
            onStartRename={() => undefined}
            onCommitRename={() => undefined}
            onCancelRename={() => undefined}
            renderTabSuffix={renderTabSuffix}
          />
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}
