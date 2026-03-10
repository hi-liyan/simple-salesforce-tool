import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import { Copy, FolderPlus, Play, Plus, Search, Shield, SquareTerminal, Trash2, X } from "lucide-react";
import { api } from "../../../api";
import { TerminalClosedEvent, TerminalOutputEvent } from "../../../types";
import { TerminalCommandItem, TerminalTab, useTerminalStore } from "../../../store/useTerminalStore";

// 单个 xterm 运行时句柄。
type TerminalRuntime = {
  // xterm 实例。
  terminal: Terminal;
  // fit 插件：用于根据容器尺寸自适应列宽行高。
  fitAddon: FitAddon;
};

// 单个终端 Tab 的进程元信息。
type TerminalProcessMeta = {
  // 进程 PID。
  pid: number | null;
  // 启动命令行文本。
  commandLine: string;
  // 终端程序名称（如 PowerShell/bash）。
  shellName: string;
  // 终端程序版本文本。
  shellVersion: string;
  // 是否已连接到后端会话。
  connected: boolean;
  // 是否正在初始化。
  opening: boolean;
};

// TerminalPanel：左侧命令库 + 右侧真实终端工作区。
export function TerminalPanel() {
  // Store：命令组、终端 Tab 与操作能力。
  const commandGroups = useTerminalStore((state) => state.commandGroups);
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const createCommandGroup = useTerminalStore((state) => state.createCommandGroup);
  const createCommand = useTerminalStore((state) => state.createCommand);
  const updateCommand = useTerminalStore((state) => state.updateCommand);
  const deleteCommand = useTerminalStore((state) => state.deleteCommand);
  const createTerminalTab = useTerminalStore((state) => state.createTerminalTab);
  const setActiveTabId = useTerminalStore((state) => state.setActiveTabId);
  const closeTerminalTab = useTerminalStore((state) => state.closeTerminalTab);
  // 平台标识：仅 Windows 显示“管理员终端”入口。
  const isWindowsPlatform = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);

  // 搜索关键字：支持按组名、命令名、命令内容全局匹配。
  const [searchKeyword, setSearchKeyword] = useState("");
  // 当前选中命令组 ID：用于右键菜单和创建命令时默认分组。
  const [selectedGroupId, setSelectedGroupId] = useState("");
  // 命令右键菜单状态。
  const [commandContextMenu, setCommandContextMenu] = useState<{ x: number; y: number; groupId: string; command: TerminalCommandItem } | null>(
    null
  );
  // 是否展开“创建命令组”表单。
  const [showCreateGroupPanel, setShowCreateGroupPanel] = useState(false);
  // 是否展开“创建命令”表单。
  const [showCreateCommandPanel, setShowCreateCommandPanel] = useState(false);
  // 新命令组名称输入值。
  const [newGroupName, setNewGroupName] = useState("");
  // 新命令的目标分组 ID。
  const [newCommandGroupId, setNewCommandGroupId] = useState("");
  // 新命令名称输入值。
  const [newCommandName, setNewCommandName] = useState("");
  // 新命令正文输入值。
  const [newCommandValue, setNewCommandValue] = useState("");
  // 当前编辑命令 ID（仅允许一条命令处于编辑态）。
  const [editingCommandId, setEditingCommandId] = useState("");
  // 编辑态命令名称。
  const [editingCommandName, setEditingCommandName] = useState("");
  // 编辑态命令正文。
  const [editingCommandValue, setEditingCommandValue] = useState("");
  // 每个 Tab 的后端进程元信息。
  const [processMetaByTabId, setProcessMetaByTabId] = useState<Record<string, TerminalProcessMeta>>({});

  // xterm 容器 DOM 映射（按 tabId 存储）。
  const terminalContainerByTabIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  // xterm 运行时映射（按 tabId 存储）。
  const terminalRuntimeByTabIdRef = useRef<Record<string, TerminalRuntime>>({});
  // 已经打开后端会话的 Tab 集合。
  const openedSessionTabIdRef = useRef<Set<string>>(new Set());
  // 等待会话建立后自动执行的命令（用于“复制到新终端并执行”）。
  const pendingRunCommandByTabIdRef = useRef<Record<string, string>>({});
  // 上一次渲染时的 Tab ID 集合：用于回收已关闭 Tab 资源。
  const previousTabIdsRef = useRef<string[]>([]);

  // 激活终端 Tab 派生值。
  const activeTab = useMemo(() => tabs.find((item) => item.id === activeTabId) || tabs[0] || null, [tabs, activeTabId]);

  // 过滤后的命令组：支持按组名、命令名、命令文本全局搜索。
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return commandGroups;

    return commandGroups
      .map((group) => {
        const groupMatch = group.name.toLowerCase().includes(keyword);
        if (groupMatch) return group;
        const commands = group.commands.filter(
          (item) => item.name.toLowerCase().includes(keyword) || item.command.toLowerCase().includes(keyword)
        );
        return {
          ...group,
          commands
        };
      })
      .filter((group) => group.commands.length > 0 || group.name.toLowerCase().includes(keyword));
  }, [commandGroups, searchKeyword]);

  // 当前选中命令组。
  const selectedGroup = useMemo(() => commandGroups.find((item) => item.id === selectedGroupId) || commandGroups[0] || null, [commandGroups, selectedGroupId]);

  // 初始化/兜底选中命令组，避免出现空选中状态。
  useEffect(() => {
    if (selectedGroupId && commandGroups.some((item) => item.id === selectedGroupId)) return;
    setSelectedGroupId(commandGroups[0]?.id || "");
  }, [selectedGroupId, commandGroups]);

  // 当命令组变化时，同步“创建命令”面板默认分组。
  useEffect(() => {
    if (newCommandGroupId && commandGroups.some((item) => item.id === newCommandGroupId)) return;
    setNewCommandGroupId(commandGroups[0]?.id || "");
  }, [newCommandGroupId, commandGroups]);

  // 当 activeTabId 不可用时，自动收敛到第一个终端。
  useEffect(() => {
    if (!tabs.length) return;
    if (activeTabId && tabs.some((item) => item.id === activeTabId)) return;
    setActiveTabId(tabs[0].id);
  }, [activeTabId, tabs, setActiveTabId]);

  // 绑定全局事件：点击空白/滚动/ESC 时关闭命令右键菜单。
  useEffect(() => {
    if (!commandContextMenu) return;

    const closeMenu = () => {
      setCommandContextMenu(null); // 点击空白后关闭菜单。
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
  }, [commandContextMenu]);

  // 创建单个 xterm 运行时并绑定键盘输入透传。
  const ensureTerminalRuntime = useCallback((tab: TerminalTab): TerminalRuntime => {
    const existing = terminalRuntimeByTabIdRef.current[tab.id];
    if (existing) return existing;

    const terminal = new Terminal({
      // 终端光标闪烁：更接近真实 shell 体验。
      cursorBlink: true,
      // 字体与行高：保证中文和英文可读性。
      fontFamily: '"Cascadia Mono", "Consolas", "Noto Sans Mono CJK SC", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      // 滚动缓冲区大小。
      scrollback: 3000,
      // 终端主题色。
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

    // 键盘输入直接透传给后端 PTY。
    terminal.onData((data) => {
      void api.writeTerminalInput(tab.id, data).catch((error) => {
        terminal.writeln(`\r\n[输入失败] ${String(error)}`);
      });
    });

    const runtime: TerminalRuntime = {
      terminal,
      fitAddon
    };
    terminalRuntimeByTabIdRef.current[tab.id] = runtime;
    return runtime;
  }, []);

  // 将 xterm 挂载到容器并执行 fit。
  const mountRuntimeToContainer = useCallback((tab: TerminalTab) => {
    const container = terminalContainerByTabIdRef.current[tab.id];
    if (!container) return;

    const runtime = ensureTerminalRuntime(tab);
    // xterm 仅需 open 一次；若重复 open 会抛错，这里通过 children 长度判断。
    if (container.childElementCount === 0) {
      runtime.terminal.open(container);
    }
    runtime.fitAddon.fit(); // 每次挂载后重新 fit。
  }, [ensureTerminalRuntime]);

  // 打开后端终端会话（每个 Tab 一个系统进程）。
  const ensureBackendSession = useCallback(
    async (tab: TerminalTab) => {
      if (openedSessionTabIdRef.current.has(tab.id)) return;

      const runtime = ensureTerminalRuntime(tab);
      const cols = runtime.terminal.cols || 120;
      const rows = runtime.terminal.rows || 36;

      setProcessMetaByTabId((state) => ({
        ...state,
        [tab.id]: {
          pid: state[tab.id]?.pid || null,
          commandLine: state[tab.id]?.commandLine || "",
          shellName: state[tab.id]?.shellName || "",
          shellVersion: state[tab.id]?.shellVersion || "",
          connected: false,
          opening: true
        }
      }));

      try {
        const sessionInfo = await api.openTerminalSession(tab.id, cols, rows);
        openedSessionTabIdRef.current.add(tab.id);
        setProcessMetaByTabId((state) => ({
          ...state,
          [tab.id]: {
            pid: sessionInfo.pid,
            commandLine: sessionInfo.commandLine,
            shellName: sessionInfo.shellName,
            shellVersion: sessionInfo.shellVersion,
            connected: true,
            opening: false
          }
        }));

        // 若该 Tab 有待执行命令，会话建立后立即执行。
        const pending = pendingRunCommandByTabIdRef.current[tab.id]?.trim();
        if (pending) {
          await api.writeTerminalInput(tab.id, `${pending}\r`);
          delete pendingRunCommandByTabIdRef.current[tab.id];
        }
      } catch (error) {
        setProcessMetaByTabId((state) => ({
          ...state,
          [tab.id]: {
            pid: null,
            commandLine: `会话创建失败: ${String(error)}`,
            shellName: "",
            shellVersion: "",
            connected: false,
            opening: false
          }
        }));
      }
    },
    [ensureTerminalRuntime]
  );

  // 初始化和回收终端资源：确保 Tab 与 PTY 生命周期一致。
  useEffect(() => {
    const currentTabIds = tabs.map((item) => item.id);
    const previousTabIds = previousTabIdsRef.current;
    const removedTabIds = previousTabIds.filter((tabId) => !currentTabIds.includes(tabId));

    // 回收已关闭 Tab 的前后端资源。
    removedTabIds.forEach((tabId) => {
      const runtime = terminalRuntimeByTabIdRef.current[tabId];
      if (runtime) {
        runtime.terminal.dispose(); // 销毁 xterm 实例，避免内存泄露。
        delete terminalRuntimeByTabIdRef.current[tabId];
      }
      openedSessionTabIdRef.current.delete(tabId);
      delete terminalContainerByTabIdRef.current[tabId];
      delete pendingRunCommandByTabIdRef.current[tabId];
      setProcessMetaByTabId((state) => {
        const next = { ...state };
        delete next[tabId];
        return next;
      });
      void api.closeTerminalSession(tabId); // 冗余回收后端进程，保证无残留。
    });

    // 为每个 Tab 挂载 xterm 并打开后端会话。
    tabs.forEach((tab) => {
      mountRuntimeToContainer(tab);
      void ensureBackendSession(tab);
    });

    previousTabIdsRef.current = currentTabIds;
  }, [tabs, ensureBackendSession, mountRuntimeToContainer]);

  // 监听后端 PTY 输出与关闭事件，实时刷新 xterm。
  useEffect(() => {
    let mounted = true;

    const run = async () => {
      const unlistenOutput = await listen<TerminalOutputEvent>("terminal://output", (event) => {
        const payload = event.payload;
        const runtime = terminalRuntimeByTabIdRef.current[payload.tabId];
        if (!runtime) return;
        runtime.terminal.write(payload.data); // 原样写入终端输出。
      });

      const unlistenClosed = await listen<TerminalClosedEvent>("terminal://closed", (event) => {
        const payload = event.payload;
        openedSessionTabIdRef.current.delete(payload.tabId);
        setProcessMetaByTabId((state) => ({
          ...state,
          [payload.tabId]: {
            pid: state[payload.tabId]?.pid ?? null,
            commandLine: state[payload.tabId]?.commandLine || "进程已退出",
            shellName: state[payload.tabId]?.shellName || "",
            shellVersion: state[payload.tabId]?.shellVersion || "",
            connected: false,
            opening: false
          }
        }));
      });

      if (!mounted) {
        unlistenOutput();
        unlistenClosed();
      }

      return () => {
        unlistenOutput();
        unlistenClosed();
      };
    };

    const disposePromise = run();
    return () => {
      mounted = false;
      void disposePromise.then((dispose) => dispose?.());
    };
  }, []);

  // 激活 Tab 切换时：聚焦终端并同步 resize。
  useEffect(() => {
    if (!activeTab) return;
    const runtime = terminalRuntimeByTabIdRef.current[activeTab.id];
    if (!runtime) return;

    mountRuntimeToContainer(activeTab);
    runtime.fitAddon.fit();
    runtime.terminal.focus(); // 切换 Tab 后直接可输入。

    const cols = runtime.terminal.cols || 120;
    const rows = runtime.terminal.rows || 36;
    if (openedSessionTabIdRef.current.has(activeTab.id)) {
      void api.resizeTerminalSession(activeTab.id, cols, rows);
    }
  }, [activeTab, mountRuntimeToContainer]);

  // 监听窗口 resize：实时调整当前激活终端尺寸。
  useEffect(() => {
    if (!activeTab) return;

    const onResize = () => {
      const runtime = terminalRuntimeByTabIdRef.current[activeTab.id];
      if (!runtime) return;
      runtime.fitAddon.fit();
      if (!openedSessionTabIdRef.current.has(activeTab.id)) return;
      void api.resizeTerminalSession(activeTab.id, runtime.terminal.cols || 120, runtime.terminal.rows || 36);
    };

    window.addEventListener("resize", onResize);
    return () => {
      window.removeEventListener("resize", onResize);
    };
  }, [activeTab]);

  // 组件卸载时，兜底销毁全部 xterm 实例。
  useEffect(() => {
    return () => {
      Object.values(terminalRuntimeByTabIdRef.current).forEach((runtime) => {
        runtime.terminal.dispose();
      });
      terminalRuntimeByTabIdRef.current = {};
    };
  }, []);

  // 创建命令组。
  function handleCreateGroup() {
    const groupId = createCommandGroup(newGroupName);
    if (!groupId) return;
    setSelectedGroupId(groupId);
    setNewCommandGroupId(groupId);
    setNewGroupName("");
    setShowCreateGroupPanel(false);
  }

  // 创建命令。
  function handleCreateCommand() {
    const normalizedGroupId = newCommandGroupId || selectedGroup?.id || "";
    if (!normalizedGroupId) return;
    const commandId = createCommand(normalizedGroupId, newCommandName, newCommandValue);
    if (!commandId) return;
    setSelectedGroupId(normalizedGroupId);
    setNewCommandName("");
    setNewCommandValue("");
    setShowCreateCommandPanel(false);
  }

  // 开始编辑命令。
  function startEditCommand(command: TerminalCommandItem) {
    setEditingCommandId(command.id);
    setEditingCommandName(command.name);
    setEditingCommandValue(command.command);
  }

  // 取消编辑命令。
  function cancelEditCommand() {
    setEditingCommandId("");
    setEditingCommandName("");
    setEditingCommandValue("");
  }

  // 保存编辑命令。
  function saveEditCommand(groupId: string, commandId: string) {
    updateCommand(groupId, commandId, {
      name: editingCommandName,
      command: editingCommandValue
    });
    cancelEditCommand();
  }

  // 复制命令到当前终端并立即执行。
  async function handleRunInCurrentTerminal(command: TerminalCommandItem) {
    if (!activeTab) return;

    // 若会话尚未建立，则先缓存命令并触发建立。
    if (!openedSessionTabIdRef.current.has(activeTab.id)) {
      pendingRunCommandByTabIdRef.current[activeTab.id] = command.command;
      await ensureBackendSession(activeTab);
      setCommandContextMenu(null);
      return;
    }

    await api.writeTerminalInput(activeTab.id, `${command.command}\r`);
    setCommandContextMenu(null);
  }

  // 复制命令到新终端并执行。
  function handleRunInNewTerminal(command: TerminalCommandItem) {
    const tabId = createTerminalTab(undefined, command.name ? `Terminal · ${command.name}` : undefined);
    if (!tabId) return;
    pendingRunCommandByTabIdRef.current[tabId] = command.command;
    setCommandContextMenu(null);
  }

  // 新建空终端并立即激活。
  function handleCreateTerminalTab() {
    createTerminalTab();
  }

  // 关闭终端 Tab（同时关闭后端进程）。
  async function handleCloseTerminalTab(tabId: string) {
    await api.closeTerminalSession(tabId).catch(() => {
      // 关闭失败不阻断 UI 收敛，仍然移除前端 Tab。
    });
    closeTerminalTab(tabId);
  }

  // 以管理员身份打开终端（Windows 下弹出 UAC，拉起新窗口）。
  async function handleOpenElevatedTerminal() {
    await api.openElevatedTerminal().catch((error) => {
      window.alert(`打开管理员终端失败：${String(error)}`); // 提示失败原因，便于快速排查权限问题。
    });
  }

  return (
    // Terminal 主体布局：左侧命令库 + 右侧终端工作区。
    <div className="grid h-full w-full grid-cols-[340px_1fr] overflow-hidden">
      {/* 左侧命令库面板。 */}
      <div className="flex min-h-0 flex-col border-r border-base-300 bg-base-100">
        {/* 顶部工具区：icon 按钮 + 搜索栏。 */}
        <div className="border-b border-base-300 p-3">
          {/* 顶部 icon 操作行。 */}
          <div className="mb-2 flex items-center gap-2">
            {/* 创建命令组 icon 按钮（悬浮显示名称）。 */}
            <button
              className="btn btn-ghost btn-sm"
              title="创建命令组"
              onClick={() => {
                setShowCreateGroupPanel((value) => !value);
                setShowCreateCommandPanel(false);
              }}
            >
              <FolderPlus size={15} />
            </button>
            {/* 创建命令 icon 按钮（悬浮显示名称）。 */}
            <button
              className="btn btn-ghost btn-sm"
              title="创建命令"
              onClick={() => {
                setShowCreateCommandPanel((value) => !value);
                setShowCreateGroupPanel(false);
              }}
              disabled={commandGroups.length === 0}
            >
              <SquareTerminal size={15} />
            </button>
          </div>

          {/* 搜索输入行：支持组名/命令名/命令内容全局搜索。 */}
          <label className="input input-bordered input-sm flex w-full items-center gap-2">
            {/* 搜索图标。 */}
            <Search size={14} className="text-neutral/60" />
            {/* 搜索输入框。 */}
            <input
              type="text"
              className="grow"
              placeholder="搜索命令组 / 命令名 / 命令内容"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
          </label>

          {/* 创建命令组面板。 */}
          {showCreateGroupPanel && (
            <div className="mt-2 rounded-md border border-base-300 bg-base-200/60 p-2">
              {/* 命令组名称输入框。 */}
              <input
                type="text"
                className="input input-bordered input-sm w-full"
                placeholder="输入命令组名称"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  handleCreateGroup(); // 回车快速创建命令组。
                }}
              />
              {/* 创建命令组操作区。 */}
              <div className="mt-2 flex justify-end gap-2">
                <button className="btn btn-ghost btn-xs" onClick={() => setShowCreateGroupPanel(false)}>
                  取消
                </button>
                <button className="btn btn-primary btn-xs" onClick={handleCreateGroup}>
                  创建
                </button>
              </div>
            </div>
          )}

          {/* 创建命令面板。 */}
          {showCreateCommandPanel && (
            <div className="mt-2 rounded-md border border-base-300 bg-base-200/60 p-2">
              {/* 目标命令组选择器。 */}
              <select
                className="select select-bordered select-sm w-full"
                value={newCommandGroupId}
                onChange={(event) => setNewCommandGroupId(event.target.value)}
              >
                {commandGroups.map((group) => (
                  <option key={group.id} value={group.id}>
                    {group.name}
                  </option>
                ))}
              </select>
              {/* 命令名称输入框。 */}
              <input
                type="text"
                className="input input-bordered input-sm mt-2 w-full"
                placeholder="命令名称"
                value={newCommandName}
                onChange={(event) => setNewCommandName(event.target.value)}
              />
              {/* 命令正文输入框。 */}
              <textarea
                className="textarea textarea-bordered textarea-sm mt-2 h-[74px] w-full font-mono"
                placeholder="命令内容，例如 npm run dev"
                value={newCommandValue}
                onChange={(event) => setNewCommandValue(event.target.value)}
              />
              {/* 创建命令操作区。 */}
              <div className="mt-2 flex justify-end gap-2">
                <button className="btn btn-ghost btn-xs" onClick={() => setShowCreateCommandPanel(false)}>
                  取消
                </button>
                <button className="btn btn-primary btn-xs" onClick={handleCreateCommand}>
                  创建
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 命令组与命令列表区域。 */}
        <div className="min-h-0 flex-1 overflow-auto p-2">
          {filteredGroups.map((group) => {
            const selected = selectedGroup?.id === group.id;
            return (
              // 单个命令组卡片。
              <div key={group.id} className="mb-2 rounded-lg border border-base-300 bg-base-100">
                {/* 分组标题行。 */}
                <button
                  className={`flex w-full items-center justify-between rounded-t-lg px-3 py-2 text-left text-[12px] font-medium ${selected ? "bg-base-200" : ""}`}
                  onClick={() => setSelectedGroupId(group.id)}
                >
                  {/* 分组名称。 */}
                  <span className="truncate">{group.name}</span>
                  {/* 分组命令数。 */}
                  <span className="text-[11px] text-neutral/60">{group.commands.length}</span>
                </button>

                {/* 分组命令列表。 */}
                <div className="space-y-1 p-2">
                  {group.commands.length === 0 && <div className="px-2 py-1 text-[12px] text-neutral/60">暂无命令</div>}
                  {group.commands.map((commandItem) => {
                    const editing = editingCommandId === commandItem.id;
                    return (
                      // 单条命令项。
                      <div
                        key={commandItem.id}
                        className="rounded-md border border-base-300 bg-base-100 p-2"
                        onContextMenu={(event) => {
                          event.preventDefault(); // 阻止系统默认右键菜单。
                          setSelectedGroupId(group.id); // 打开右键菜单时同步选中当前组。
                          setCommandContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            groupId: group.id,
                            command: commandItem
                          });
                        }}
                      >
                        {editing ? (
                          // 命令编辑态。
                          <div className="space-y-2">
                            {/* 命令名称编辑框。 */}
                            <input
                              type="text"
                              className="input input-bordered input-xs w-full"
                              value={editingCommandName}
                              onChange={(event) => setEditingCommandName(event.target.value)}
                            />
                            {/* 命令正文编辑框。 */}
                            <textarea
                              className="textarea textarea-bordered textarea-xs h-[72px] w-full font-mono"
                              value={editingCommandValue}
                              onChange={(event) => setEditingCommandValue(event.target.value)}
                            />
                            {/* 编辑态操作按钮。 */}
                            <div className="flex justify-end gap-2">
                              <button className="btn btn-ghost btn-xs" onClick={cancelEditCommand}>
                                取消
                              </button>
                              <button className="btn btn-primary btn-xs" onClick={() => saveEditCommand(group.id, commandItem.id)}>
                                保存
                              </button>
                            </div>
                          </div>
                        ) : (
                          // 命令展示态。
                          <>
                            {/* 命令标题与操作。 */}
                            <div className="flex items-center justify-between gap-2">
                              {/* 命令名称。 */}
                              <p className="truncate text-[12px] font-medium">{commandItem.name}</p>
                              {/* 快捷操作按钮。 */}
                              <div className="flex items-center gap-1">
                                <button
                                  className="btn btn-ghost btn-xs"
                                  title="在当前终端执行"
                                  onClick={() => {
                                    void handleRunInCurrentTerminal(commandItem);
                                  }}
                                >
                                  <Play size={12} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-xs"
                                  title="在新终端执行"
                                  onClick={() => handleRunInNewTerminal(commandItem)}
                                >
                                  <Copy size={12} />
                                </button>
                                <button
                                  className="btn btn-ghost btn-xs"
                                  title="编辑"
                                  onClick={() => startEditCommand(commandItem)}
                                >
                                  编辑
                                </button>
                                <button
                                  className="btn btn-ghost btn-xs text-error"
                                  title="删除"
                                  onClick={() => deleteCommand(group.id, commandItem.id)}
                                >
                                  <Trash2 size={12} />
                                </button>
                              </div>
                            </div>
                            {/* 命令正文。 */}
                            <p className="mt-1 line-clamp-2 whitespace-pre-wrap break-all rounded bg-base-200 px-2 py-1 font-mono text-[11px] text-neutral/80">
                              {commandItem.command}
                            </p>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右侧终端工作区。 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden bg-base-100">
        {/* 顶部终端 Tab 栏。 */}
        <div className="flex items-center border-b border-base-300">
          {/* 终端 Tab 列表。 */}
          <div className="flex min-w-0 flex-1 overflow-x-auto">
            {tabs.map((tab) => {
              const active = tab.id === activeTab?.id;
              const processMeta = processMetaByTabId[tab.id];
              const pidText = processMeta?.pid !== null && processMeta?.pid !== undefined ? String(processMeta.pid) : "-";
              const commandText = processMeta?.commandLine || "-";
              const terminalVersionText = processMeta?.shellVersion
                ? `${processMeta.shellName || "Terminal"} ${processMeta.shellVersion}`
                : "-";
              const tooltipText = `进程 ID (PID): ${pidText}\n命令行: ${commandText}\n终端版本: ${terminalVersionText}`;

              return (
                // 单个终端 Tab。
                <div key={tab.id} className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : "bg-base-200/50"}`}>
                  {/* 激活终端按钮。 */}
                  <button
                    className={`min-w-0 max-w-[240px] truncate px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                    onClick={() => setActiveTabId(tab.id)}
                    title={tooltipText}
                  >
                    {/* Tab 标题。 */}
                    <span>{tab.name}</span>
                    {/* 会话状态提示点。 */}
                    {processMeta?.connected && <span className="ml-2 inline-block h-2 w-2 rounded-full bg-success" />}
                    {processMeta?.opening && <span className="ml-2 inline-block h-2 w-2 animate-pulse rounded-full bg-warning" />}
                  </button>
                  {/* 关闭终端按钮。 */}
                  <button
                    className="btn btn-circle btn-ghost btn-xs mr-1"
                    onClick={() => {
                      void handleCloseTerminalTab(tab.id);
                    }}
                  >
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {/* 新建终端按钮。 */}
          <button className="btn btn-ghost btn-sm mx-2" onClick={handleCreateTerminalTab} title="新建终端">
            <Plus size={14} />
          </button>
          {/* Windows 管理员终端入口：管理员权限会在新窗口中打开。 */}
          {isWindowsPlatform && (
            <button className="btn btn-ghost btn-sm mr-2" onClick={() => void handleOpenElevatedTerminal()} title="以管理员身份打开终端">
              <Shield size={14} />
            </button>
          )}
        </div>

        {/* 终端渲染区：使用 xterm 作为真实交互终端，不再使用底部输入框。 */}
        <div className="relative min-h-0 flex-1 overflow-hidden bg-[#0f172a]">
          {tabs.map((tab) => (
            // 每个 Tab 对应一个终端容器，非激活态仅隐藏不销毁。
            <div
              key={tab.id}
              className={`h-full w-full p-2 ${activeTab?.id === tab.id ? "block" : "hidden"}`}
              ref={(element) => {
                terminalContainerByTabIdRef.current[tab.id] = element;
                if (!element) return;
                mountRuntimeToContainer(tab); // 容器挂载后立即初始化 xterm。
              }}
            />
          ))}
        </div>
      </div>

      {/* 命令右键菜单。 */}
      {commandContextMenu && (
        <div
          className="fixed z-[110] min-w-[176px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
          style={{ left: commandContextMenu.x, top: commandContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {/* 菜单项：在当前终端执行。 */}
          <button
            className="btn btn-ghost btn-xs w-full justify-start"
            onClick={() => {
              void handleRunInCurrentTerminal(commandContextMenu.command);
            }}
          >
            <Play size={12} />
            在当前终端执行
          </button>
          {/* 菜单项：在新终端执行。 */}
          <button className="btn btn-ghost btn-xs w-full justify-start" onClick={() => handleRunInNewTerminal(commandContextMenu.command)}>
            <Plus size={12} />
            在新终端执行
          </button>
        </div>
      )}
    </div>
  );
}
