import { ChevronRight, Plus, Puzzle, TerminalSquare } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ReusableTabs } from "../../../../components/tabs/ReusableTabs";
import { listPlugins, type PluginManifest } from "../../../../plugins/core";
import { buildWorkspaceTabSurfaceStyles } from "../logic/workspaceTabVisuals.ts";
import { QueryWorkspaceTabItem } from "../types";

type QueryWorkspaceTabsProps = {
  // 统一工作区 Tab 列表（data + console + plugin）。
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
  // 新建查询控制台 Tab 回调。
  onCreateConsole: () => void;
  // 打开插件 Tab 回调（支持同插件多实例）。
  onOpenPlugin: (pluginId: string, title: string) => void;
};

// Query 工作区统一 Tab 栏：支持 data、console、plugin 混合展示、横向拖拽排序及尾部 + 新建菜单。
export function QueryWorkspaceTabs({
  tabs,
  activeTabId,
  onActivateTab,
  onReorderTabs,
  onCloseTab,
  onCloseTabs,
  onCreateConsole,
  onOpenPlugin
}: QueryWorkspaceTabsProps) {
  // + 按钮 DOM 引用：用于锚定主下拉菜单坐标。
  const addButtonRef = useRef<HTMLButtonElement | null>(null);
  // 菜单容器 DOM 引用：用于判断外部点击关闭。
  const menuContainerRef = useRef<HTMLDivElement | null>(null);
  // 主下拉菜单是否打开及其锚点位置。
  const [menuPosition, setMenuPosition] = useState<{ left: number; top: number } | null>(null);
  // 当前鼠标是否悬停在“插件 >”菜单项上，以及二级菜单坐标。
  const [pluginSubmenuPosition, setPluginSubmenuPosition] = useState<{ left: number; top: number } | null>(null);
  // 当前已启用的插件清单列表：每次打开菜单时实时读取注册表。
  const [enabledPlugins, setEnabledPlugins] = useState<PluginManifest[]>([]);

  // 关闭整个 + 下拉菜单与二级子菜单。
  function closeMenu() {
    setMenuPosition(null);
    setPluginSubmenuPosition(null);
  }

  // 点击 + 按钮：切换主下拉菜单并刷新启用插件列表。
  function handleToggleMenu() {
    if (menuPosition) {
      closeMenu();
      return;
    }
    const rect = addButtonRef.current?.getBoundingClientRect();
    if (!rect) return;
    // 过滤已启用的可挂载插件，每次点击实时读取，确保插件中心启停后立即生效。
    const nextEnabledPlugins = listPlugins().filter((plugin) => plugin.enabled !== false);
    setEnabledPlugins(nextEnabledPlugins);
    setPluginSubmenuPosition(null);
    setMenuPosition({
      left: Math.min(rect.left, Math.max(8, window.innerWidth - 180)),
      top: Math.min(rect.bottom + 4, Math.max(8, window.innerHeight - 120))
    });
  }

  // 鼠标移入或点击“插件 >”项时，在右侧弹出启用插件列表。
  function handleOpenPluginSubmenu(itemElement: HTMLElement) {
    if (enabledPlugins.length === 0) {
      setPluginSubmenuPosition(null); // 行内注释：无启用插件时不弹出空二级选单。
      return;
    }
    const itemRect = itemElement.getBoundingClientRect();
    const submenuWidth = 188;
    const preferRightLeft = itemRect.right + 4;
    const resolvedLeft =
      preferRightLeft + submenuWidth <= window.innerWidth - 8
        ? preferRightLeft
        : Math.max(8, itemRect.left - submenuWidth - 4); // 行内注释：右侧空间不足时自动折返到左侧展示。
    setPluginSubmenuPosition({
      left: resolvedLeft,
      top: Math.min(itemRect.top, Math.max(8, window.innerHeight - 240))
    });
  }

  // 监听外部点击与 ESC 键关闭菜单。
  useEffect(() => {
    if (!menuPosition) return;
    const onMouseDown = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (!target) return;
      if (addButtonRef.current?.contains(target)) return;
      if (menuContainerRef.current?.contains(target)) return;
      closeMenu();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };
    window.addEventListener("mousedown", onMouseDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [menuPosition]);

  // Tab 栏尾部 + 按钮：紧跟其余 Tab（或空态提示）之后。
  const trailingAddButton = (
    <button
      ref={addButtonRef}
      type="button"
      className="mx-1.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-neutral/70 transition-colors hover:bg-base-200 hover:text-neutral"
      title="新建标签或打开插件"
      aria-label="新建标签或打开插件"
      onClick={handleToggleMenu}
    >
      {/* 加号图标。 */}
      <Plus size={14} />
    </button>
  );

  return (
    <>
      <ReusableTabs
        tabs={tabs.map((tab) => {
          const surfaceStyles = buildWorkspaceTabSurfaceStyles(tab.sourceColor || "");
          return {
            id: tab.id,
            title: tab.title,
            closable: true,
            renameable: false,
            surfaceStyle: surfaceStyles.surfaceStyle,
            activeSurfaceStyle: surfaceStyles.activeSurfaceStyle
          };
        })}
        activeTabId={activeTabId}
        emptyText="请选择左侧 Object 或点击查询控制台"
        onActivateTab={onActivateTab}
        onReorderTabs={onReorderTabs}
        onCloseTab={onCloseTab}
        onCloseTabs={onCloseTabs}
        trailingContent={trailingAddButton}
      />

      {/* Portal 下拉菜单：挂载到 body 避免被 Tab 栏 overflow-x-auto 裁切。 */}
      {menuPosition &&
        createPortal(
          <div ref={menuContainerRef}>
            {/* 一级下拉菜单：新建查询 / 插件 >。 */}
            <div
              className="fixed z-[120] min-w-[152px] rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
              style={{ left: menuPosition.left, top: menuPosition.top }}
            >
              {/* 新建查询选项：在当前工作区新增一个查询控制台 Tab。 */}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-neutral transition-colors hover:bg-base-200/80"
                onMouseEnter={() => setPluginSubmenuPosition(null)}
                onClick={() => {
                  closeMenu();
                  onCreateConsole(); // 行内注释：触发新建查询控制台 Tab。
                }}
              >
                <TerminalSquare size={13} className="shrink-0 text-primary/80" />
                <span className="flex-1">新建查询</span>
              </button>

              {/* 插件子菜单入口：有启用插件时在右侧弹出插件列表。 */}
              <button
                type="button"
                className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-neutral transition-colors hover:bg-base-200/80"
                onMouseEnter={(event) => handleOpenPluginSubmenu(event.currentTarget)}
                onClick={(event) => handleOpenPluginSubmenu(event.currentTarget)}
              >
                <Puzzle size={13} className="shrink-0 text-primary/80" />
                <span className="flex-1">插件</span>
                <ChevronRight size={13} className="shrink-0 text-neutral/50" />
              </button>
            </div>

            {/* 二级右侧选单：列出全部已启用的插件，点击在工作区打开独立插件 Tab。 */}
            {pluginSubmenuPosition && enabledPlugins.length > 0 && (
              <div
                className="fixed z-[121] max-h-[260px] min-w-[180px] max-w-[260px] overflow-y-auto rounded-lg border border-base-300 bg-base-100 p-1 shadow-xl"
                style={{ left: pluginSubmenuPosition.left, top: pluginSubmenuPosition.top }}
              >
                {enabledPlugins.map((plugin) => (
                  <button
                    key={plugin.id}
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2.5 py-1.5 text-left text-[12px] text-neutral transition-colors hover:bg-base-200/80"
                    onClick={() => {
                      closeMenu();
                      onOpenPlugin(plugin.id, plugin.name); // 行内注释：每次点击都以新实例打开对应插件 Tab。
                    }}
                  >
                    <Puzzle size={13} className="shrink-0 text-neutral/60" />
                    <span className="truncate">{plugin.name}</span>
                  </button>
                ))}
              </div>
            )}
          </div>,
          document.body
        )}
    </>
  );
}
