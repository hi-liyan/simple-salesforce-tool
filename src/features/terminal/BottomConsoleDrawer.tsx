import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookmarkPlus,
  BookMarked,
  Eraser,
  Maximize2,
  Minimize2,
  Shield,
  TerminalSquare,
  X
} from "lucide-react";
import { api } from "../../api";
import { NoticeAlert } from "../../components/NoticeAlert";
import { ReusableTabs } from "../../components/tabs/ReusableTabs";
import { sortTabsByOrder } from "../../components/tabs/tabOrder";
import { subscribePluginEvent } from "../../plugins/core/createPluginContext";
import { useTerminalStore } from "../../store/useTerminalStore";
import { buildTerminalTabTooltip, type TerminalProcessMeta } from "./uiState.ts";
import { SavedCommandsPanel } from "./SavedCommandsPanel";
import { TerminalViewport, type TerminalViewportHandle } from "./TerminalViewport";

// app_settings 中保存底部终端高度的键值。
const CONSOLE_HEIGHT_SETTING_KEY = "ui.bottomConsoleHeight";
// 默认抽屉高度（像素）。
const DEFAULT_CONSOLE_HEIGHT = 280;
// 最小抽屉高度（像素）。
const MIN_CONSOLE_HEIGHT = 180;

type BottomConsoleDrawerProps = {
  // 抽屉是否展开。
  open: boolean;
  // 关闭/收起抽屉回调（不销毁 PTY 会话）。
  onClose: () => void;
  // 打开抽屉回调（供插件事件联动自动呼出）。
  onOpen: () => void;
};

// VSCode 风格底部集成终端抽屉：支持 Ctrl + ` 呼出/收起、高度拖拽、多终端 Tab 与右侧常用命令栏。
export function BottomConsoleDrawer({ open, onClose, onOpen }: BottomConsoleDrawerProps) {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const tabOrder = useTerminalStore((state) => state.tabOrder);
  const createTerminalTab = useTerminalStore((state) => state.createTerminalTab);
  const setActiveTabId = useTerminalStore((state) => state.setActiveTabId);
  const renameTerminalTab = useTerminalStore((state) => state.renameTerminalTab);
  const reorderTerminalTabs = useTerminalStore((state) => state.reorderTerminalTabs);
  const closeTerminalTab = useTerminalStore((state) => state.closeTerminalTab);
  const closeTerminalTabsByIds = useTerminalStore((state) => state.closeTerminalTabsByIds);

  // 抽屉高度（像素，拖拽结束后持久化）。
  const [drawerHeight, setDrawerHeight] = useState(DEFAULT_CONSOLE_HEIGHT);
  // 是否处于最大化模式。
  const [maximized, setMaximized] = useState(false);
  // 右侧常用命令面板是否展开。
  const [commandsSidebarOpen, setCommandsSidebarOpen] = useState(true);
  // 是否曾被打开过：首次打开后保持挂载以维持后台 PTY 会话存活。
  const [hasEverOpened, setHasEverOpened] = useState(open);
  // 进程元数据（用于在 Tab 栏渲染状态点）。
  const [processMetaByTabId, setProcessMetaByTabId] = useState<Record<string, TerminalProcessMeta>>({});
  // 会话异常通知。
  const [sessionNotice, setSessionNotice] = useState("");
  // 快速保存常用命令触发信号。
  const [quickSaveRequest, setQuickSaveRequest] = useState<{ text: string; nonce: number } | null>(null);

  const viewportRef = useRef<TerminalViewportHandle | null>(null);
  const drawerHeightRef = useRef(drawerHeight);
  drawerHeightRef.current = drawerHeight;

  const isWindows = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);
  const orderedTabs = useMemo(() => sortTabsByOrder(tabOrder, tabs), [tabOrder, tabs]);

  // 初始化读取持久化的抽屉高度。
  useEffect(() => {
    let active = true;
    void api
      .getAppSetting(CONSOLE_HEIGHT_SETTING_KEY)
      .then((raw) => {
        if (!active || !raw) return;
        const parsed = Number(raw);
        if (Number.isFinite(parsed) && parsed >= MIN_CONSOLE_HEIGHT) {
          setDrawerHeight(parsed);
        }
      })
      .catch(() => {});
    return () => {
      active = false;
    };
  }, []);

  // 首次打开时确保存在至少一个默认终端 Tab，并标记已挂载保活。
  useEffect(() => {
    if (!open) return;
    setHasEverOpened(true);
    if (useTerminalStore.getState().tabs.length === 0) {
      createTerminalTab();
    }
  }, [open, createTerminalTab]);

  // 订阅插件事件总线：支持从命令库插件一键填入或执行命令。
  useEffect(() => {
    const unsubRun = subscribePluginEvent("terminal:run-command", (payload) => {
      const cmd = (payload as { command?: string } | null)?.command;
      if (!cmd) return;
      onOpen();
      setHasEverOpened(true);
      setTimeout(() => {
        void viewportRef.current?.sendCommand(cmd, true);
      }, 40);
    });
    const unsubFill = subscribePluginEvent("terminal:fill-command", (payload) => {
      const cmd = (payload as { command?: string } | null)?.command;
      if (!cmd) return;
      onOpen();
      setHasEverOpened(true);
      setTimeout(() => {
        void viewportRef.current?.sendCommand(cmd, false);
      }, 40);
    });
    return () => {
      unsubRun();
      unsubFill();
    };
  }, [onOpen]);

  // 顶部拖拽调整抽屉高度（仅在 pointerup 时持久化，遵循状态分级约束）。
  const handleStartResize = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = drawerHeightRef.current;
    const maxAllowed = Math.max(MIN_CONSOLE_HEIGHT, Math.floor(window.innerHeight * 0.78));

    const onPointerMove = (moveEvent: MouseEvent) => {
      const delta = startY - moveEvent.clientY;
      const nextHeight = Math.min(maxAllowed, Math.max(MIN_CONSOLE_HEIGHT, startHeight + delta));
      setDrawerHeight(nextHeight);
    };

    const onPointerUp = () => {
      window.removeEventListener("mousemove", onPointerMove);
      window.removeEventListener("mouseup", onPointerUp);
      void api.setAppSetting(CONSOLE_HEIGHT_SETTING_KEY, String(drawerHeightRef.current)).catch(() => {});
      viewportRef.current?.fitActiveTerminal(false);
    };

    window.addEventListener("mousemove", onPointerMove);
    window.addEventListener("mouseup", onPointerUp);
  }, []);

  // 关闭单个终端 Tab 并回收后端 PTY。
  const handleCloseTab = useCallback(
    async (tabId: string) => {
      await api.closeTerminalSession(tabId).catch(() => {});
      closeTerminalTab(tabId);
    },
    [closeTerminalTab]
  );

  // 批量关闭终端 Tab。
  const handleCloseTabs = useCallback(
    async (tabIds: string[]) => {
      await Promise.all(tabIds.map((id) => api.closeTerminalSession(id).catch(() => {})));
      closeTerminalTabsByIds(tabIds);
    },
    [closeTerminalTabsByIds]
  );

  // 从终端当前选区快速保存常用命令。
  const handleQuickSaveSelection = useCallback(() => {
    const selected = viewportRef.current?.getSelectedText() || "";
    setCommandsSidebarOpen(true);
    setQuickSaveRequest({ text: selected.trim(), nonce: Date.now() });
  }, []);

  if (!hasEverOpened) return null;

  return (
    <section
      aria-hidden={!open}
      className={`flex shrink-0 flex-col overflow-hidden rounded-xl border border-base-300/80 bg-base-100 shadow-2xs transition-[height] duration-150 ${
        open ? "" : "hidden"
      }`}
      style={{
        height: maximized ? "calc(100vh - 88px)" : `${drawerHeight}px`
      }}
    >
      {/* 顶部拖拽调节手柄（非最大化时可用）。 */}
      {!maximized && (
        <div
          onMouseDown={handleStartResize}
          title="拖拽调整终端高度"
          className="h-1.5 w-full shrink-0 cursor-ns-resize bg-transparent transition-colors hover:bg-primary/30"
        />
      )}

      {/* 顶部 Tab 栏与 VSCode 风格操作按钮区。 */}
      <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300/80 bg-base-200/35 px-2">
        <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
          <div className="flex shrink-0 items-center gap-1 rounded-md bg-primary/10 px-2 py-0.5 text-[11px] font-semibold text-primary">
            <TerminalSquare size={12} />
            <span>终端</span>
          </div>

          <div className="min-w-0 flex-1 overflow-x-auto">
            <ReusableTabs
              tabs={orderedTabs.map((tab) => {
                const meta = processMetaByTabId[tab.id] || null;
                return {
                  id: tab.id,
                  title: tab.name,
                  closable: true,
                  renameable: true,
                  titleTooltip: buildTerminalTabTooltip(meta),
                  statusTone: meta?.opening ? "warning" : meta?.connected ? "success" : "idle"
                };
              })}
              activeTabId={activeTabId || orderedTabs[0]?.id || ""}
              emptyText="点击 + 新建终端"
              createButtonTitle="新建终端"
              onActivateTab={setActiveTabId}
              onCreateTab={() => createTerminalTab()}
              onReorderTabs={reorderTerminalTabs}
              onRenameTab={renameTerminalTab}
              onCloseTab={(tabId) => void handleCloseTab(tabId)}
              onCloseTabs={(tabIds) => void handleCloseTabs(tabIds)}
            />
          </div>
        </div>

        {/* 右侧控制区：保存命令、清屏、管理员终端、命令栏开关、最大化与收起。 */}
        <div className="ml-2 flex shrink-0 items-center gap-0.5">
          <button
            type="button"
            title="保存为常用命令（自动带入终端选中文本）"
            onClick={handleQuickSaveSelection}
            className="flex h-7 items-center gap-1 rounded-md px-2 text-[11px] text-neutral/80 hover:bg-base-200"
          >
            <BookmarkPlus size={13} />
            <span className="hidden md:inline">保存命令</span>
          </button>

          <button
            type="button"
            title="清空当前终端输出"
            onClick={() => viewportRef.current?.clearActiveTerminal()}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 hover:bg-base-200"
          >
            <Eraser size={13} />
          </button>

          {isWindows && (
            <button
              type="button"
              title="以管理员身份打开独立终端"
              onClick={() => void api.openElevatedTerminal().catch(() => {})}
              className="flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 hover:bg-base-200"
            >
              <Shield size={13} />
            </button>
          )}

          <button
            type="button"
            title={commandsSidebarOpen ? "隐藏常用命令栏" : "展开常用命令栏"}
            onClick={() => setCommandsSidebarOpen((prev) => !prev)}
            className={`flex h-7 items-center gap-1 rounded-md px-2 text-[11px] transition-colors ${
              commandsSidebarOpen ? "bg-primary/12 font-medium text-primary" : "text-neutral/75 hover:bg-base-200"
            }`}
          >
            <BookMarked size={13} />
            <span className="hidden sm:inline">常用命令</span>
          </button>

          <button
            type="button"
            title={maximized ? "还原高度" : "最大化终端"}
            onClick={() => {
              setMaximized((prev) => !prev);
              setTimeout(() => viewportRef.current?.fitActiveTerminal(true), 40);
            }}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 hover:bg-base-200"
          >
            {maximized ? <Minimize2 size={13} /> : <Maximize2 size={13} />}
          </button>

          <button
            type="button"
            title="收起终端 (Ctrl + `)"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-md text-neutral/75 hover:bg-base-200"
          >
            <X size={14} />
          </button>
        </div>
      </div>

      {sessionNotice && (
        <NoticeAlert tone="error" message={sessionNotice} onClose={() => setSessionNotice("")} className="m-2 shrink-0" />
      )}

      {/* 主内容区：左侧 xterm 终端视口 + 右侧可折叠常用命令栏。 */}
      <div className="flex min-h-0 flex-1 overflow-hidden">
        <TerminalViewport
          ref={viewportRef}
          visible={open}
          onProcessMetaChange={setProcessMetaByTabId}
          onSessionNotice={setSessionNotice}
        />

        {commandsSidebarOpen && (
          <aside className="h-full w-[300px] shrink-0 border-l border-base-300/80">
            <SavedCommandsPanel
              quickSaveRequest={quickSaveRequest}
              onFillCommand={(cmd) => void viewportRef.current?.sendCommand(cmd, false)}
              onRunCommand={(cmd) => void viewportRef.current?.sendCommand(cmd, true)}
            />
          </aside>
        )}
      </div>
    </section>
  );
}
