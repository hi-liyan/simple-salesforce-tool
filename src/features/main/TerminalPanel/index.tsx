import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  Copy,
  FolderPlus,
  PencilLine,
  Play,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { api } from "../../../api";
import {
  TerminalClosedEvent,
  TerminalCommandGroup,
  TerminalCommandItem,
  TerminalCommandUpsertPayload,
  TerminalOutputEvent
} from "../../../types";
import { TerminalTab, useTerminalStore } from "../../../store/useTerminalStore";

type TerminalPanelProps = {
  // 当前 Terminal 面板是否可见：用于控制激活时的 fit/focus。
  visible?: boolean;
};

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

// 左侧编辑器模式。
type CommandEditorMode = "closed" | "group" | "create" | "edit";

// 编辑命令目标。
type EditingCommandTarget = {
  // 所属命令组 ID。
  groupId: string;
  // 命令 ID。
  commandId: string;
};

// 命令编辑表单。
type CommandEditorForm = {
  // 目标命令组 ID。
  groupId: string;
  // 命令名称。
  name: string;
  // 命令描述。
  description: string;
  // 命令正文。
  command: string;
};

// 创建空白命令表单。
function createEmptyCommandForm(groupId: string): CommandEditorForm {
  return {
    groupId,
    name: "",
    description: "",
    command: ""
  };
}

// 由命令实体回填编辑表单。
function createFormFromCommand(groupId: string, command: TerminalCommandItem): CommandEditorForm {
  return {
    groupId,
    name: command.name,
    description: command.description,
    command: command.command
  };
}

// TerminalPanel：左侧命令库 + 右侧真实终端工作区。
export function TerminalPanel({ visible = true }: TerminalPanelProps) {
  // Store：终端 Tab 与会话操作能力。
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const createTerminalTab = useTerminalStore((state) => state.createTerminalTab);
  const setActiveTabId = useTerminalStore((state) => state.setActiveTabId);
  const closeTerminalTab = useTerminalStore((state) => state.closeTerminalTab);
  // 平台标识：仅 Windows 显示“管理员终端”入口。
  const isWindowsPlatform = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);

  // 全局命令组（由后端 SQLite 表读取）。
  const [commandGroups, setCommandGroups] = useState<TerminalCommandGroup[]>([]);
  // 命令库加载态。
  const [commandLibraryLoading, setCommandLibraryLoading] = useState(false);
  // 命令库错误文本。
  const [commandLibraryError, setCommandLibraryError] = useState("");
  // 命令写入提交态。
  const [commandLibrarySubmitting, setCommandLibrarySubmitting] = useState(false);
  // 搜索关键字：支持组名、命令名、描述、命令文本匹配。
  const [searchKeyword, setSearchKeyword] = useState("");
  // 当前选中命令组 ID。
  const [selectedGroupId, setSelectedGroupId] = useState("");
  // 每个分组的展开状态。
  const [expandedByGroupId, setExpandedByGroupId] = useState<Record<string, boolean>>({});
  // 命令右键菜单状态。
  const [commandContextMenu, setCommandContextMenu] = useState<{ x: number; y: number; groupId: string; command: TerminalCommandItem } | null>(
    null
  );
  // 左侧编辑器模式。
  const [editorMode, setEditorMode] = useState<CommandEditorMode>("closed");
  // 编辑态命令目标。
  const [editingTarget, setEditingTarget] = useState<EditingCommandTarget | null>(null);
  // 新命令组名称输入值。
  const [newGroupName, setNewGroupName] = useState("");
  // 命令编辑表单。
  const [commandForm, setCommandForm] = useState<CommandEditorForm>(() => createEmptyCommandForm(""));
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
  // 命令库请求序号：用于丢弃过期响应。
  const commandLibraryRequestSeqRef = useRef(0);

  // 激活终端 Tab 派生值。
  const activeTab = useMemo(() => tabs.find((item) => item.id === activeTabId) || tabs[0] || null, [tabs, activeTabId]);

  // 当前选中命令组。
  const selectedGroup = useMemo(
    () => commandGroups.find((item) => item.id === selectedGroupId) || commandGroups[0] || null,
    [commandGroups, selectedGroupId]
  );

  // 命令总量：用于头部统计。
  const totalCommandCount = useMemo(
    () => commandGroups.reduce((total, group) => total + group.commands.length, 0),
    [commandGroups]
  );

  // 过滤后的命令组：支持按组名、命令名、描述、命令正文检索。
  const filteredGroups = useMemo(() => {
    const keyword = searchKeyword.trim().toLowerCase();
    if (!keyword) return commandGroups;

    return commandGroups
      .map((group) => {
        const groupMatched = group.name.toLowerCase().includes(keyword);
        if (groupMatched) return group;

        const commands = group.commands.filter((command) => {
          const searchableText = [command.name, command.description, command.command].join(" ").toLowerCase();
          return searchableText.includes(keyword);
        });

        return {
          ...group,
          commands
        };
      })
      .filter((group) => group.commands.length > 0 || group.name.toLowerCase().includes(keyword));
  }, [commandGroups, searchKeyword]);

  // 命令表单是否可提交。
  const canSubmitCommandForm = useMemo(
    () => Boolean(commandForm.groupId && commandForm.name.trim() && commandForm.command.trim()),
    [commandForm]
  );

  // 拉取全局命令库。
  const loadCommandLibrary = useCallback(
    async (options?: { keepSelection?: boolean }) => {
      const requestSeq = commandLibraryRequestSeqRef.current + 1;
      commandLibraryRequestSeqRef.current = requestSeq;
      setCommandLibraryLoading(true);
      setCommandLibraryError("");

      try {
        const groups = await api.listTerminalCommandGroups();
        // 仅接纳最后一次请求结果，避免并发切换数据源时状态回退。
        if (commandLibraryRequestSeqRef.current !== requestSeq) return;
        setCommandGroups(groups);
        setExpandedByGroupId((state) => {
          const next: Record<string, boolean> = {};
          groups.forEach((group, index) => {
            next[group.id] = state[group.id] ?? index === 0;
          });
          return next;
        });

        if (options?.keepSelection && selectedGroupId && groups.some((group) => group.id === selectedGroupId)) {
          return;
        }
        setSelectedGroupId(groups[0]?.id || "");
      } catch (error) {
        if (commandLibraryRequestSeqRef.current !== requestSeq) return;
        setCommandLibraryError(`加载命令库失败：${String(error)}`);
      } finally {
        if (commandLibraryRequestSeqRef.current !== requestSeq) return;
        setCommandLibraryLoading(false);
      }
    },
    [selectedGroupId]
  );

  // 组件初始化后自动加载命令库。
  useEffect(() => {
    void loadCommandLibrary();
  }, [loadCommandLibrary]);

  // 初始化/兜底选中命令组。
  useEffect(() => {
    if (selectedGroupId && commandGroups.some((group) => group.id === selectedGroupId)) return;
    setSelectedGroupId(commandGroups[0]?.id || "");
  }, [selectedGroupId, commandGroups]);

  // 当编辑表单分组不可用时回退到首个分组。
  useEffect(() => {
    if (!editorMode || editorMode === "closed") return;
    if (commandForm.groupId && commandGroups.some((group) => group.id === commandForm.groupId)) return;
    setCommandForm((state) => ({ ...state, groupId: commandGroups[0]?.id || "" }));
  }, [editorMode, commandForm.groupId, commandGroups]);

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
  const mountRuntimeToContainer = useCallback(
    (tab: TerminalTab) => {
      const container = terminalContainerByTabIdRef.current[tab.id];
      if (!container) return;

      const runtime = ensureTerminalRuntime(tab);
      // xterm 仅需 open 一次；若重复 open 会抛错，这里通过 children 长度判断。
      if (container.childElementCount === 0) {
        runtime.terminal.open(container);
      }
      runtime.fitAddon.fit(); // 每次挂载后重新 fit。
    },
    [ensureTerminalRuntime]
  );

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
    if (!visible) return;
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
  }, [visible, activeTab, mountRuntimeToContainer]);

  // 监听窗口 resize：实时调整当前激活终端尺寸。
  useEffect(() => {
    if (!visible) return;
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
  }, [visible, activeTab]);

  // 组件卸载时，兜底销毁全部 xterm 实例。
  useEffect(() => {
    return () => {
      Object.values(terminalRuntimeByTabIdRef.current).forEach((runtime) => {
        runtime.terminal.dispose();
      });
      terminalRuntimeByTabIdRef.current = {};
    };
  }, []);

  // 更新命令表单字段。
  function patchCommandForm(patch: Partial<CommandEditorForm>) {
    setCommandForm((state) => ({
      ...state,
      ...patch
    }));
  }

  // 打开“创建命令组”面板。
  function openCreateGroupPanel() {
    setEditorMode("group");
    setEditingTarget(null);
    setNewGroupName("");
  }

  // 打开“创建命令”面板。
  function openCreateCommandPanel(seedGroupId?: string) {
    const nextGroupId = seedGroupId || selectedGroup?.id || commandGroups[0]?.id || "";
    setEditorMode("create");
    setEditingTarget(null);
    setCommandForm(createEmptyCommandForm(nextGroupId));
  }

  // 打开“编辑命令”面板。
  function openEditCommandPanel(groupId: string, command: TerminalCommandItem) {
    setEditorMode("edit");
    setEditingTarget({ groupId, commandId: command.id });
    setCommandForm(createFormFromCommand(groupId, command));
    setSelectedGroupId(groupId);
    setExpandedByGroupId((state) => ({ ...state, [groupId]: true }));
  }

  // 关闭编辑面板并清理临时状态。
  function closeEditorPanel() {
    setEditorMode("closed");
    setEditingTarget(null);
  }

  // 创建命令组。
  async function handleCreateGroup() {
    const normalizedName = newGroupName.trim();
    if (!normalizedName) return;

    setCommandLibrarySubmitting(true);
    try {
      const created = await api.createTerminalCommandGroup(normalizedName);
      setSelectedGroupId(created.id);
      setExpandedByGroupId((state) => ({ ...state, [created.id]: true }));
      setNewGroupName("");
      closeEditorPanel();
      await loadCommandLibrary({ keepSelection: true });
    } catch (error) {
      window.alert(`创建命令组失败：${String(error)}`); // 即时反馈失败原因，避免用户误以为提交无效。
    } finally {
      setCommandLibrarySubmitting(false);
    }
  }

  // 读取系统剪贴板并覆盖命令输入。
  async function handlePasteFromClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      patchCommandForm({ command: text });
    } catch (error) {
      window.alert(`读取剪贴板失败：${String(error)}`); // 明确提示权限异常或系统限制。
    }
  }

  // 创建/更新命令。
  async function handleSubmitCommand() {
    if (!canSubmitCommandForm) return;

    const payload: TerminalCommandUpsertPayload = {
      groupId: commandForm.groupId,
      name: commandForm.name.trim(),
      description: commandForm.description.trim(),
      command: commandForm.command.trim()
    };

    setCommandLibrarySubmitting(true);
    try {
      if (editorMode === "edit" && editingTarget) {
        // 若编辑时切换了目标分组，则按“创建新命令 + 删除旧命令”处理。
        if (editingTarget.groupId !== payload.groupId) {
          await api.createTerminalCommand(payload);
          await api.deleteTerminalCommand(editingTarget.groupId, editingTarget.commandId);
        } else {
          await api.updateTerminalCommand(editingTarget.commandId, payload);
        }
      } else {
        await api.createTerminalCommand(payload);
      }

      setSelectedGroupId(payload.groupId);
      setExpandedByGroupId((state) => ({ ...state, [payload.groupId]: true }));
      closeEditorPanel();
      await loadCommandLibrary({ keepSelection: true });
    } catch (error) {
      window.alert(`保存命令失败：${String(error)}`); // 写操作失败时给出明确反馈。
    } finally {
      setCommandLibrarySubmitting(false);
    }
  }

  // 删除命令。
  async function handleDeleteCommand(groupId: string, commandId: string) {
    try {
      await api.deleteTerminalCommand(groupId, commandId);
      await loadCommandLibrary({ keepSelection: true });
    } catch (error) {
      window.alert(`删除命令失败：${String(error)}`); // 避免删除失败后 UI 与数据库状态不一致。
    }
  }

  // 复制命令到当前终端并立即执行。
  async function handleRunInCurrentTerminal(command: TerminalCommandItem) {
    let targetTab: TerminalTab | undefined = activeTab;
    if (!targetTab) {
      // 当前没有可用终端时自动创建新 Tab，保证“当前终端执行”可用。
      const createdTabId = createTerminalTab(undefined, command.name ? `Terminal · ${command.name}` : undefined);
      if (!createdTabId) return;
      targetTab = useTerminalStore.getState().tabs.find((item) => item.id === createdTabId);
      if (!targetTab) return;
    }

    // 若会话尚未建立，则先缓存命令并触发建立。
    if (!openedSessionTabIdRef.current.has(targetTab.id)) {
      pendingRunCommandByTabIdRef.current[targetTab.id] = command.command;
      await ensureBackendSession(targetTab);
      setCommandContextMenu(null);
      return;
    }

    await api.writeTerminalInput(targetTab.id, `${command.command}\r`);
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
    <div className="grid h-full w-full grid-cols-[380px_1fr] overflow-hidden">
      {/* 左侧命令库面板。 */}
      <div className="flex min-h-0 flex-col border-r border-base-300 bg-base-100">
        {/* 顶部控制区：统计、搜索、操作。 */}
        <div className="border-b border-base-300 p-3">
          {/* 头部卡片。 */}
          <div className="rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm">
            {/* 标题与动作。 */}
            <div className="flex items-start justify-between gap-2">
              {/* 左侧标题。 */}
              <div>
                <p className="text-[10px] uppercase tracking-[0.16em] text-primary/70">Command Library</p>
                <h3 className="mt-1 text-[15px] font-semibold text-neutral">终端命令库</h3>
                <p className="mt-1 text-[11px] text-neutral/70">命令组与命令存储在 SQLite 独立表。</p>
              </div>
              {/* 右侧按钮组。 */}
              <div className="flex items-center gap-1">
                <button className="btn btn-ghost btn-square btn-sm" title="刷新命令库" onClick={() => void loadCommandLibrary({ keepSelection: true })}>
                  <RefreshCw size={14} />
                </button>
                <button
                  className="btn btn-ghost btn-square btn-sm"
                  title="新建命令组"
                  onClick={openCreateGroupPanel}
                  disabled={commandLibrarySubmitting}
                >
                  <FolderPlus size={15} />
                </button>
                <button
                  className="btn btn-ghost btn-square btn-sm"
                  title="新建命令"
                  onClick={() => openCreateCommandPanel()}
                  disabled={commandGroups.length === 0 || commandLibrarySubmitting}
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>

            {/* 指标区。 */}
            <div className="mt-3 grid grid-cols-2 gap-2 text-[11px]">
              {/* 命令组数量。 */}
              <div className="rounded-lg border border-base-300 bg-base-200/60 px-2 py-1.5">
                <p className="text-neutral/60">命令组</p>
                <p className="mt-0.5 text-[14px] font-semibold">{commandGroups.length}</p>
              </div>
              {/* 命令总量。 */}
              <div className="rounded-lg border border-base-300 bg-base-200/60 px-2 py-1.5">
                <p className="text-neutral/60">命令条数</p>
                <p className="mt-0.5 text-[14px] font-semibold">{totalCommandCount}</p>
              </div>
            </div>

            {/* 搜索输入。 */}
            <label className="input input-bordered input-sm mt-3 flex w-full items-center gap-2">
              <Search size={14} className="text-neutral/60" />
              <input
                type="text"
                className="grow"
                placeholder="搜索组名 / 命令名 / 描述 / 命令正文"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
            </label>
          </div>

          {/* 错误提示。 */}
          {commandLibraryError && <p className="mt-2 text-[12px] text-error">{commandLibraryError}</p>}

          {/* 创建命令组面板。 */}
          {editorMode === "group" && (
            <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm">
              {/* 面板标题。 */}
              <h4 className="text-[13px] font-semibold text-neutral">新建命令组</h4>
              {/* 分组名输入。 */}
              <input
                type="text"
                className="input input-bordered input-sm mt-2 w-full"
                placeholder="例如：常用、脚本、排障"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  void handleCreateGroup(); // 回车快速创建命令组。
                }}
              />
              {/* 操作按钮。 */}
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn btn-ghost btn-sm" onClick={closeEditorPanel} disabled={commandLibrarySubmitting}>
                  取消
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void handleCreateGroup()} disabled={commandLibrarySubmitting}>
                  创建分组
                </button>
              </div>
            </div>
          )}

          {/* 创建/编辑命令面板。 */}
          {(editorMode === "create" || editorMode === "edit") && (
            <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm">
              {/* 面板标题。 */}
              <div className="flex items-start justify-between gap-2">
                <div>
                  <h4 className="text-[13px] font-semibold text-neutral">{editorMode === "create" ? "创建命令" : "编辑命令"}</h4>
                  <p className="mt-0.5 text-[11px] text-neutral/70">命令输入使用编辑器，支持更友好的粘贴与修改。</p>
                </div>
                <button className="btn btn-ghost btn-xs" onClick={() => void handlePasteFromClipboard()} title="从剪贴板粘贴">
                  <Clipboard size={13} />
                </button>
              </div>

              {/* 基础字段：分组、名称、描述。 */}
              <div className="mt-3 grid grid-cols-1 gap-2">
                {/* 分组选择。 */}
                <select
                  className="select select-bordered select-sm w-full"
                  value={commandForm.groupId}
                  onChange={(event) => patchCommandForm({ groupId: event.target.value })}
                >
                  {commandGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>

                {/* 名称输入。 */}
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder="命令名称，例如：启动开发服务"
                  value={commandForm.name}
                  onChange={(event) => patchCommandForm({ name: event.target.value })}
                />

                {/* 描述输入。 */}
                <input
                  type="text"
                  className="input input-bordered input-sm w-full"
                  placeholder="命令描述（可选）"
                  value={commandForm.description}
                  onChange={(event) => patchCommandForm({ description: event.target.value })}
                />
              </div>

              {/* 命令输入编辑器。 */}
              <div className="mt-3 overflow-hidden rounded-lg border border-base-300">
                {/* 编辑器标题行。 */}
                <div className="flex items-center justify-between border-b border-base-300 bg-neutral px-2 py-1 text-[11px] text-neutral-content">
                  <span className="font-mono">$ command</span>
                  <span className="text-neutral-content/70">支持粘贴多行后再整理为单条命令</span>
                </div>
                {/* Monaco 命令输入框。 */}
                <Editor
                  height="118px"
                  defaultLanguage="plaintext"
                  value={commandForm.command}
                  theme="vs-dark"
                  onChange={(value) => {
                    patchCommandForm({ command: value || "" }); // 同步编辑器内容到表单。
                  }}
                  options={{
                    minimap: { enabled: false },
                    lineNumbers: "off",
                    glyphMargin: false,
                    folding: false,
                    lineDecorationsWidth: 0,
                    lineNumbersMinChars: 0,
                    renderLineHighlight: "none",
                    scrollBeyondLastLine: false,
                    wordWrap: "on",
                    tabSize: 2,
                    fontSize: 13,
                    fontFamily: '"Cascadia Mono", "Consolas", "Noto Sans Mono CJK SC", monospace',
                    automaticLayout: true,
                    contextmenu: true,
                    padding: { top: 8, bottom: 8 }
                  }}
                />
              </div>

              {/* 操作按钮。 */}
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn btn-ghost btn-sm" onClick={closeEditorPanel} disabled={commandLibrarySubmitting}>
                  取消
                </button>
                <button
                  className="btn btn-primary btn-sm"
                  onClick={() => void handleSubmitCommand()}
                  disabled={!canSubmitCommandForm || commandLibrarySubmitting}
                >
                  {editorMode === "create" ? "保存命令" : "保存变更"}
                </button>
              </div>
            </div>
          )}
        </div>

        {/* 命令组与命令列表。 */}
        <div className="min-h-0 flex-1 overflow-auto p-3 pt-2">
          {/* 加载态提示。 */}
          {commandLibraryLoading && (
            <div className="rounded-lg border border-base-300 bg-base-100 px-3 py-3 text-[12px] text-neutral/60">命令库加载中...</div>
          )}

          {/* 空结果提示。 */}
          {!commandLibraryLoading && filteredGroups.length === 0 && (
            <div className="rounded-lg border border-dashed border-base-300 bg-base-100 px-3 py-5 text-center text-[12px] text-neutral/60">
              当前没有命令，先创建一个命令组和命令。
            </div>
          )}

          {filteredGroups.map((group) => {
            const selected = selectedGroup?.id === group.id;
            const searchMode = Boolean(searchKeyword.trim());
            const expanded = searchMode ? true : (expandedByGroupId[group.id] ?? false);

            return (
              // 单个命令组卡片。
              <div key={group.id} className="mb-2 rounded-xl border border-base-300 bg-base-100 shadow-sm">
                {/* 分组标题。 */}
                <div className="flex items-center gap-1 border-b border-base-300/70 px-2 py-1.5">
                  <button
                    className="btn btn-ghost btn-xs h-6 min-h-0 px-1"
                    onClick={() => {
                      setExpandedByGroupId((state) => ({ ...state, [group.id]: !expanded }));
                    }}
                  >
                    {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                  </button>
                  <button
                    className={`flex min-w-0 flex-1 items-center justify-between rounded-md px-2 py-1 text-left ${selected ? "bg-primary/10" : "hover:bg-base-200/70"}`}
                    onClick={() => {
                      setSelectedGroupId(group.id);
                      setExpandedByGroupId((state) => ({ ...state, [group.id]: true }));
                    }}
                  >
                    <span className="truncate text-[12px] font-medium">{group.name}</span>
                    <span className="text-[11px] text-neutral/60">{group.commands.length}</span>
                  </button>
                  <button
                    className="btn btn-ghost btn-xs h-6 min-h-0 px-1"
                    title="在本组新建命令"
                    onClick={() => openCreateCommandPanel(group.id)}
                    disabled={commandLibrarySubmitting}
                  >
                    <Plus size={12} />
                  </button>
                </div>

                {/* 分组命令列表。 */}
                {expanded && (
                  <div className="space-y-2 p-2">
                    {group.commands.length === 0 && <div className="px-2 py-2 text-[12px] text-neutral/55">当前分组还没有命令</div>}

                    {group.commands.map((commandItem) => (
                      // 单条命令卡片。
                      <div
                        key={commandItem.id}
                        className="rounded-lg border border-base-300 bg-base-100 p-2 transition-colors hover:border-primary/45"
                        onContextMenu={(event) => {
                          event.preventDefault(); // 阻止系统默认右键菜单。
                          setSelectedGroupId(group.id);
                          setCommandContextMenu({
                            x: event.clientX,
                            y: event.clientY,
                            groupId: group.id,
                            command: commandItem
                          });
                        }}
                      >
                        {/* 命令标题与操作。 */}
                        <div className="flex items-center justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-[12px] font-semibold text-neutral">{commandItem.name}</p>
                            {commandItem.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral/65">{commandItem.description}</p>}
                          </div>
                          <div className="flex shrink-0 items-center gap-1">
                            <button
                              className="btn btn-ghost btn-xs"
                              title="当前终端执行"
                              onClick={() => {
                                void handleRunInCurrentTerminal(commandItem);
                              }}
                            >
                              <Play size={12} />
                            </button>
                            <button className="btn btn-ghost btn-xs" title="新终端执行" onClick={() => handleRunInNewTerminal(commandItem)}>
                              <Copy size={12} />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs"
                              title="编辑命令"
                              onClick={() => openEditCommandPanel(group.id, commandItem)}
                            >
                              <PencilLine size={12} />
                            </button>
                            <button
                              className="btn btn-ghost btn-xs text-error"
                              title="删除命令"
                              onClick={() => {
                                void handleDeleteCommand(group.id, commandItem.id);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>

                        {/* 命令正文。 */}
                        <p className="mt-2 line-clamp-2 whitespace-pre-wrap break-all rounded-md bg-neutral/95 px-2 py-1 font-mono text-[11px] text-base-100">
                          {commandItem.command}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
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
          className="fixed z-[110] min-w-[192px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
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
            <Copy size={12} />
            在新终端执行
          </button>
          {/* 菜单项：编辑命令。 */}
          <button
            className="btn btn-ghost btn-xs w-full justify-start"
            onClick={() => {
              openEditCommandPanel(commandContextMenu.groupId, commandContextMenu.command);
              setCommandContextMenu(null);
            }}
          >
            <PencilLine size={12} />
            编辑命令
          </button>
          {/* 菜单项：删除命令。 */}
          <button
            className="btn btn-ghost btn-xs w-full justify-start text-error"
            onClick={() => {
              void handleDeleteCommand(commandContextMenu.groupId, commandContextMenu.command.id);
              setCommandContextMenu(null);
            }}
          >
            <Trash2 size={12} />
            删除命令
          </button>
        </div>
      )}
    </div>
  );
}
