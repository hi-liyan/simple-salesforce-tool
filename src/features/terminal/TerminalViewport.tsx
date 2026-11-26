import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { api } from "../../api";
import { useTerminalStore, type TerminalTab } from "../../store/useTerminalStore";
import type { TerminalClosedEvent, TerminalOutputEvent } from "../../types";
import { buildTerminalInlineNotice, type TerminalProcessMeta } from "./uiState.ts";
import {
  fitTerminalViewportToContainer,
  shouldOpenTerminalSessionForViewport,
  shouldResizeTerminalSessionForViewport,
  type TerminalViewportSize
} from "./viewport.ts";

// 单个 xterm 运行时实例。
type TerminalRuntime = {
  terminal: Terminal;
  fitAddon: FitAddon;
};

// 事件桥状态：确保前端监听就绪后再建立 PTY 会话。
type TerminalEventBridgeState = {
  ready: boolean;
  readyPromise: Promise<void>;
  markReady: () => void;
};

// 暴露给父级抽屉的操作句柄。
export type TerminalViewportHandle = {
  // 向当前激活终端写入命令；execute 为 true 时自动追加回车执行。
  sendCommand: (commandText: string, execute?: boolean) => Promise<void>;
  // 清空当前激活终端屏幕。
  clearActiveTerminal: () => void;
  // 读取当前激活终端选中的文本。
  getSelectedText: () => string;
  // 重新连接指定终端 Tab 的后端会话。
  reconnectTab: (tabId: string) => Promise<void>;
  // 同步并聚焦当前激活终端。
  fitActiveTerminal: (focus?: boolean) => void;
};

type TerminalViewportProps = {
  // 抽屉是否处于展开可见状态。
  visible: boolean;
  // 进程元数据变更回调（用于在 Tab 栏展示状态指示灯与 Tooltip）。
  onProcessMetaChange?: (metaByTabId: Record<string, TerminalProcessMeta>) => void;
  // 会话异常提示回调。
  onSessionNotice?: (notice: string) => void;
};

// xterm 终端视口引擎：负责 PTY 会话生命周期、输入透传、输出渲染与自适应尺寸。
export const TerminalViewport = forwardRef<TerminalViewportHandle, TerminalViewportProps>(function TerminalViewport(
  { visible, onProcessMetaChange, onSessionNotice },
  ref
) {
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const createTerminalTab = useTerminalStore((state) => state.createTerminalTab);
  const setActiveTabId = useTerminalStore((state) => state.setActiveTabId);

  // 各 Tab 后端进程元数据。
  const [processMetaByTabId, setProcessMetaByTabId] = useState<Record<string, TerminalProcessMeta>>({});

  // DOM 容器与 xterm 运行时映射。
  const containerByTabIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  const runtimeByTabIdRef = useRef<Record<string, TerminalRuntime>>({});
  const openedSessionTabIdsRef = useRef<Set<string>>(new Set());
  const openingPromisesRef = useRef<Record<string, Promise<void>>>({});
  const pendingWriteByTabIdRef = useRef<Record<string, string>>({});
  const previousTabIdsRef = useRef<string[]>([]);
  const fitFrameRef = useRef<number | null>(null);
  const viewportSizeByTabIdRef = useRef<Record<string, TerminalViewportSize>>({});
  const eventBridgeRef = useRef<TerminalEventBridgeState | null>(null);

  if (!eventBridgeRef.current) {
    let resolveReady = () => {};
    const readyPromise = new Promise<void>((resolve) => {
      resolveReady = resolve;
    });
    eventBridgeRef.current = {
      ready: false,
      readyPromise,
      markReady: () => {
        if (!eventBridgeRef.current || eventBridgeRef.current.ready) return;
        eventBridgeRef.current.ready = true;
        resolveReady();
      }
    };
  }

  // 同步进程状态到父级 Tab 栏。
  useEffect(() => {
    onProcessMetaChange?.(processMetaByTabId);
  }, [processMetaByTabId, onProcessMetaChange]);

  const activeTab = useMemo(
    () => tabs.find((item) => item.id === activeTabId) || tabs[0] || null,
    [tabs, activeTabId]
  );

  // 确保激活 Tab ID 合法。
  useEffect(() => {
    if (!tabs.length) return;
    if (activeTabId && tabs.some((item) => item.id === activeTabId)) return;
    setActiveTabId(tabs[0].id);
  }, [activeTabId, tabs, setActiveTabId]);

  const activeProcessMeta = activeTab ? processMetaByTabId[activeTab.id] || null : null;
  const activeInlineNotice = useMemo(() => buildTerminalInlineNotice(activeProcessMeta), [activeProcessMeta]);

  // 创建或获取 xterm 运行时实例。
  const ensureRuntime = useCallback((tab: TerminalTab): TerminalRuntime => {
    const existing = runtimeByTabIdRef.current[tab.id];
    if (existing) return existing;

    const terminal = new Terminal({
      cursorBlink: true,
      fontFamily: '"Cascadia Mono", "Consolas", "Noto Sans Mono CJK SC", monospace',
      fontSize: 12.5,
      lineHeight: 1.25,
      scrollback: 3000,
      theme: {
        background: "#0f172a",
        foreground: "#e2e8f0",
        cursor: "#f8fafc",
        selectionBackground: "#334155",
        black: "#0f172a",
        red: "#f87171",
        green: "#4ade80",
        yellow: "#facc15",
        blue: "#60a5fa",
        magenta: "#c084fc",
        cyan: "#22d3ee",
        white: "#e2e8f0",
        brightBlack: "#475569",
        brightRed: "#fb7185",
        brightGreen: "#86efac",
        brightYellow: "#fde047",
        brightBlue: "#93c5fd",
        brightMagenta: "#d8b4fe",
        brightCyan: "#67e8f9",
        brightWhite: "#f8fafc"
      }
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);

    // 透传用户输入到后端 PTY。
    terminal.onData((data) => {
      void api.writeTerminalInput(tab.id, data).catch((error) => {
        terminal.writeln(`\r\n[输入失败] ${String(error)}`);
      });
    });

    const runtime = { terminal, fitAddon };
    runtimeByTabIdRef.current[tab.id] = runtime;
    return runtime;
  }, []);

  const cancelScheduledFit = useCallback(() => {
    if (fitFrameRef.current === null) return;
    window.cancelAnimationFrame(fitFrameRef.current);
    fitFrameRef.current = null;
  }, []);

  // 延后一帧同步视口尺寸并在需要时聚焦。
  const scheduleViewportSync = useCallback(
    (tab: TerminalTab, options?: { focus?: boolean }) => {
      cancelScheduledFit();
      fitFrameRef.current = window.requestAnimationFrame(() => {
        fitFrameRef.current = null;
        const container = containerByTabIdRef.current[tab.id];
        const runtime = runtimeByTabIdRef.current[tab.id];
        if (!container || !runtime) return;
        const nextViewport = fitTerminalViewportToContainer(container, runtime);
        if (!nextViewport.fitted) return;
        if (options?.focus) {
          runtime.terminal.focus();
        }
        const shouldResize = shouldResizeTerminalSessionForViewport({
          fitted: nextViewport.fitted,
          opened: openedSessionTabIdsRef.current.has(tab.id),
          previous: viewportSizeByTabIdRef.current[tab.id] || null,
          next: { cols: nextViewport.cols || 120, rows: nextViewport.rows || 24 }
        });
        if (!shouldResize) return;
        viewportSizeByTabIdRef.current[tab.id] = {
          cols: nextViewport.cols || 120,
          rows: nextViewport.rows || 24
        };
        void api.resizeTerminalSession(tab.id, nextViewport.cols || 120, nextViewport.rows || 24);
      });
    },
    [cancelScheduledFit]
  );

  // 打开后端 PTY 会话。
  const ensureBackendSession = useCallback(
    (tab: TerminalTab) => {
      if (openedSessionTabIdsRef.current.has(tab.id)) return;
      const existingPromise = openingPromisesRef.current[tab.id];
      if (existingPromise) return existingPromise;

      const promise = (async () => {
        const bridge = eventBridgeRef.current;
        if (bridge && !bridge.ready) {
          await bridge.readyPromise;
        }
        const runtime = ensureRuntime(tab);
        const container = containerByTabIdRef.current[tab.id];
        const canOpen = shouldOpenTerminalSessionForViewport({
          visible,
          active: activeTabId === tab.id,
          hasContainer: Boolean(container),
          listenersReady: eventBridgeRef.current?.ready ?? false,
          opened: openedSessionTabIdsRef.current.has(tab.id),
          opening: Boolean(existingPromise)
        });
        if (!canOpen) return;

        const nextViewport = fitTerminalViewportToContainer(container, runtime);
        const cols = nextViewport.cols || 120;
        const rows = nextViewport.rows || 24;

        setProcessMetaByTabId((prev) => ({
          ...prev,
          [tab.id]: {
            pid: prev[tab.id]?.pid ?? null,
            commandLine: prev[tab.id]?.commandLine || "",
            shellName: prev[tab.id]?.shellName || "",
            shellVersion: prev[tab.id]?.shellVersion || "",
            connected: false,
            opening: true
          }
        }));

        try {
          const info = await api.openTerminalSession(tab.id, cols, rows);
          openedSessionTabIdsRef.current.add(tab.id);
          viewportSizeByTabIdRef.current[tab.id] = { cols, rows };
          onSessionNotice?.("");
          setProcessMetaByTabId((prev) => ({
            ...prev,
            [tab.id]: {
              pid: info.pid,
              commandLine: info.commandLine,
              shellName: info.shellName,
              shellVersion: info.shellVersion,
              connected: true,
              opening: false
            }
          }));

          const pending = pendingWriteByTabIdRef.current[tab.id];
          if (pending) {
            await api.writeTerminalInput(tab.id, pending);
            delete pendingWriteByTabIdRef.current[tab.id];
          }
        } catch (error) {
          onSessionNotice?.(`终端创建失败，请在“设置 - 终端与 Shell”中检查默认 Shell 配置。详情：${String(error)}`);
          setProcessMetaByTabId((prev) => ({
            ...prev,
            [tab.id]: {
              pid: null,
              commandLine: `会话创建失败: ${String(error)}`,
              shellName: "",
              shellVersion: "",
              connected: false,
              opening: false
            }
          }));
        } finally {
          delete openingPromisesRef.current[tab.id];
        }
      })();

      openingPromisesRef.current[tab.id] = promise;
      return promise;
    },
    [ensureRuntime, visible, activeTabId, onSessionNotice]
  );

  // 回收已关闭 Tab 的 xterm 与后端 PTY 资源。
  useEffect(() => {
    const currentIds = tabs.map((t) => t.id);
    const removedIds = previousTabIdsRef.current.filter((id) => !currentIds.includes(id));
    removedIds.forEach((tabId) => {
      const runtime = runtimeByTabIdRef.current[tabId];
      if (runtime) {
        runtime.terminal.dispose();
        delete runtimeByTabIdRef.current[tabId];
      }
      openedSessionTabIdsRef.current.delete(tabId);
      delete openingPromisesRef.current[tabId];
      delete containerByTabIdRef.current[tabId];
      delete pendingWriteByTabIdRef.current[tabId];
      delete viewportSizeByTabIdRef.current[tabId];
      setProcessMetaByTabId((prev) => {
        const next = { ...prev };
        delete next[tabId];
        return next;
      });
      void api.closeTerminalSession(tabId).catch(() => {});
    });
    previousTabIdsRef.current = currentIds;
  }, [tabs]);

  // 监听后端 PTY 输出流与进程退出事件。
  useEffect(() => {
    let mounted = true;
    const setup = async () => {
      const unlistenOut = await listen<TerminalOutputEvent>("terminal://output", (event) => {
        const runtime = runtimeByTabIdRef.current[event.payload.tabId];
        if (!runtime) return;
        runtime.terminal.write(event.payload.data);
      });
      const unlistenClosed = await listen<TerminalClosedEvent>("terminal://closed", (event) => {
        openedSessionTabIdsRef.current.delete(event.payload.tabId);
        setProcessMetaByTabId((prev) => ({
          ...prev,
          [event.payload.tabId]: {
            pid: prev[event.payload.tabId]?.pid ?? null,
            commandLine: prev[event.payload.tabId]?.commandLine || "进程已退出",
            shellName: prev[event.payload.tabId]?.shellName || "",
            shellVersion: prev[event.payload.tabId]?.shellVersion || "",
            connected: false,
            opening: false
          }
        }));
      });
      eventBridgeRef.current?.markReady();

      if (!mounted) {
        unlistenOut();
        unlistenClosed();
      }
      return () => {
        unlistenOut();
        unlistenClosed();
      };
    };

    const disposePromise = setup();
    return () => {
      mounted = false;
      void disposePromise.then((dispose) => dispose?.());
    };
  }, []);

  // 抽屉展开或切换 Tab 时挂载 xterm 并建立/同步会话。
  useEffect(() => {
    if (!visible || !activeTab) return;
    const container = containerByTabIdRef.current[activeTab.id];
    if (container) {
      const runtime = ensureRuntime(activeTab);
      if (container.childElementCount === 0) {
        runtime.terminal.open(container);
      }
    }
    const targetId = activeTab.id;
    const task = ensureBackendSession(activeTab);
    if (!task) {
      scheduleViewportSync(activeTab, { focus: true });
      return;
    }
    void task.then(() => {
      if (useTerminalStore.getState().activeTabId !== targetId) return;
      scheduleViewportSync(activeTab, { focus: true });
    });
  }, [visible, activeTab, ensureRuntime, ensureBackendSession, scheduleViewportSync]);

  // 监听激活终端容器尺寸变化。
  useEffect(() => {
    if (!visible || !activeTab) return;
    const container = containerByTabIdRef.current[activeTab.id];
    if (!container) return;

    const observer = new ResizeObserver(() => {
      scheduleViewportSync(activeTab);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      cancelScheduledFit();
    };
  }, [visible, activeTab, scheduleViewportSync, cancelScheduledFit]);

  // 组件卸载时销毁所有 xterm 实例。
  useEffect(() => {
    return () => {
      cancelScheduledFit();
      Object.values(runtimeByTabIdRef.current).forEach((rt) => rt.terminal.dispose());
      runtimeByTabIdRef.current = {};
    };
  }, [cancelScheduledFit]);

  // 重新连接指定终端。
  const reconnectTab = useCallback(
    async (tabId: string) => {
      const targetTab = useTerminalStore.getState().tabs.find((t) => t.id === tabId);
      if (!targetTab) return;
      onSessionNotice?.("");
      openedSessionTabIdsRef.current.delete(tabId);
      delete openingPromisesRef.current[tabId];
      await api.closeTerminalSession(tabId).catch(() => {});
      delete viewportSizeByTabIdRef.current[tabId];
      await ensureBackendSession(targetTab);
      if (useTerminalStore.getState().activeTabId === tabId) {
        scheduleViewportSync(targetTab, { focus: true });
      }
    },
    [ensureBackendSession, scheduleViewportSync, onSessionNotice]
  );

  // 暴露命令写入、清屏、取选中文本、重连与同步能力。
  useImperativeHandle(
    ref,
    () => ({
      sendCommand: async (commandText: string, execute = false) => {
        const textToSend = execute ? `${commandText.replace(/[\r\n]+$/, "")}\r` : commandText;
        let targetTab: TerminalTab | null = activeTab;
        if (!targetTab) {
          const createdId = createTerminalTab();
          targetTab = useTerminalStore.getState().tabs.find((t) => t.id === createdId) || null;
          if (!targetTab) return;
        }
        if (!openedSessionTabIdsRef.current.has(targetTab.id)) {
          pendingWriteByTabIdRef.current[targetTab.id] = textToSend;
          await ensureBackendSession(targetTab);
          return;
        }
        await api.writeTerminalInput(targetTab.id, textToSend);
        runtimeByTabIdRef.current[targetTab.id]?.terminal.focus();
      },
      clearActiveTerminal: () => {
        if (!activeTab) return;
        runtimeByTabIdRef.current[activeTab.id]?.terminal.clear();
      },
      getSelectedText: () => {
        if (!activeTab) return "";
        return runtimeByTabIdRef.current[activeTab.id]?.terminal.getSelection() || "";
      },
      reconnectTab,
      fitActiveTerminal: (focus = false) => {
        if (!activeTab) return;
        scheduleViewportSync(activeTab, { focus });
      }
    }),
    [activeTab, createTerminalTab, ensureBackendSession, reconnectTab, scheduleViewportSync]
  );

  return (
    <div className={`relative h-full min-h-0 flex-1 overflow-hidden ${tabs.length === 0 ? "bg-base-100" : "bg-[#0f172a]"}`}>
      {tabs.length === 0 && (
        <div className="flex h-full w-full items-center justify-center text-[12px] text-neutral/60">
          暂无终端会话，请点击上方 + 创建终端
        </div>
      )}

      {activeTab && activeInlineNotice && (
        <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center p-2.5">
          <div className="pointer-events-auto flex w-full max-w-lg items-center justify-between gap-3 rounded-xl border border-warning/40 bg-base-100 px-3.5 py-2.5 shadow-lg">
            <div className="min-w-0">
              <div className="text-[12px] font-semibold text-neutral">{activeInlineNotice.title}</div>
              <div className="mt-0.5 truncate text-[11px] text-neutral/70">{activeInlineNotice.detail}</div>
            </div>
            <button
              type="button"
              className="btn btn-primary btn-xs shrink-0"
              onClick={() => void reconnectTab(activeTab.id)}
            >
              {activeInlineNotice.actionLabel}
            </button>
          </div>
        </div>
      )}

      {tabs.map((tab) => (
        <div key={tab.id} className={`h-full w-full px-2 py-1.5 ${activeTab?.id === tab.id ? "block" : "hidden"}`}>
          <div
            className="h-full w-full"
            ref={(element) => {
              containerByTabIdRef.current[tab.id] = element;
            }}
          />
        </div>
      ))}
    </div>
  );
});
