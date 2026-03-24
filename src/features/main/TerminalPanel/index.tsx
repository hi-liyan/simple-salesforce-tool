import { type MouseEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";
import Editor from "@monaco-editor/react";
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
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { listen } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";
import {
  ChevronDown,
  ChevronRight,
  Clipboard,
  FolderPlus,
  GripVertical,
  PencilLine,
  Plus,
  RefreshCw,
  Search,
  Shield,
  Trash2,
  X
} from "lucide-react";
import { api } from "../../../api";
import { ReusableTabs } from "../../../components/tabs/ReusableTabs";
import {
  TerminalClosedEvent,
  TerminalCommandGroup,
  TerminalCommandGroupUpsertPayload,
  TerminalCommandItem,
  TerminalCommandUpsertPayload,
  TerminalOutputEvent
} from "../../../types";
import { NoticeAlert } from "../../../components/NoticeAlert";
import { sortTabsByOrder } from "../../../components/tabs/tabOrder";
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
type CommandEditorMode = "closed" | "group" | "groupEdit" | "create" | "edit";

// 编辑命令目标。
type EditingCommandTarget = {
  // 所属命令组 ID。
  groupId: string;
  // 命令 ID。
  commandId: string;
};

// 待确认删除的命令目标。
type DeleteCommandTarget = {
  // 所属命令组 ID。
  groupId: string;
  // 待删除命令实体。
  command: TerminalCommandItem;
};

// 待确认删除的命令组目标。
type DeleteGroupTarget = {
  // 待删除命令组实体。
  group: TerminalCommandGroup;
};

// 拖拽快照：用于 Overlay 固定尺寸与内容展示。
type ActiveDragCommandSnapshot = {
  // 所属命令组 ID。
  groupId: string;
  // 当前拖拽命令。
  command: TerminalCommandItem;
  // 拖拽开始时的卡片宽度。
  width: number;
  // 拖拽开始时的卡片高度。
  height: number;
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

// 仅允许纵向拖拽，并移除 dnd-kit 默认 scale 形变，避免卡片因目标高度不同而变形。
const restrictVerticalNoScale: Modifier = ({ transform }) => ({
  ...transform,
  x: 0,
  scaleX: 1,
  scaleY: 1
});

function SortableCommandCard({
  groupId,
  commandItem,
  searchMode,
  isActiveDrag,
  isPlaceholder = false,
  lockedHeight,
  commandLibrarySubmitting,
  onEdit,
  onDelete,
  onPaste,
  registerCardElement,
  onContextMenu
}: SortableCommandCardProps) {
  // 绑定 sortable：提供容器引用、拖拽手柄监听和位移动画。
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: commandItem.id,
    disabled: searchMode || commandLibrarySubmitting
  });
  // 将 dnd-kit transform 映射为 CSS transform，驱动排序动画。
  const style = {
    transform: CSS.Transform.toString(
      transform
        ? {
            ...transform,
            x: 0,
            scaleX: 1,
            scaleY: 1
          }
        : null
    ),
    transition,
    height: isPlaceholder && lockedHeight ? `${lockedHeight}px` : undefined
  };

  return (
    <div
      ref={(element) => {
        registerCardElement(commandItem.id, element);
        setNodeRef(element);
      }}
      style={style}
      className={`rounded-lg border bg-base-100 p-2 transition-colors hover:border-primary/45 ${
        isDragging || isActiveDrag ? "border-primary" : "border-base-300"
      }`}
      data-command-id={commandItem.id}
      onContextMenu={(event) => {
        onContextMenu(event, groupId, commandItem);
      }}
    >
      <div className={isPlaceholder ? "pointer-events-none opacity-35" : undefined}>
      {/* 命令标题与操作。 */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          {/* 拖拽手柄：未搜索时可在组内排序。 */}
          {!searchMode && (
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="mt-0.5 cursor-grab text-neutral/35 active:cursor-grabbing"
              title="拖动排序"
              disabled={commandLibrarySubmitting}
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </button>
          )}
          <div className="min-w-0">
            <p className="truncate text-[12px] font-semibold text-neutral">{commandItem.name}</p>
            {commandItem.description && <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral/65">{commandItem.description}</p>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="btn btn-ghost btn-xs"
            title="粘贴到当前终端"
            onClick={() => {
              onPaste(commandItem);
            }}
          >
            <Clipboard size={12} />
          </button>
          <button className="btn btn-ghost btn-xs" title="编辑命令" onClick={() => onEdit(groupId, commandItem)}>
            <PencilLine size={12} />
          </button>
          <button className="btn btn-ghost btn-xs text-error" title="删除命令" onClick={() => onDelete(groupId, commandItem)}>
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {/* 命令正文。 */}
      <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-neutral/95 px-2 py-1 font-mono text-[11px] text-base-100">
        {commandItem.command}
      </p>
      </div>
    </div>
  );
}

type SortableCommandCardProps = {
  // 所属命令组 ID。
  groupId: string;
  // 当前命令实体。
  commandItem: TerminalCommandItem;
  // 是否处于搜索态：搜索时禁用排序。
  searchMode: boolean;
  // 当前是否处于拖拽激活态。
  isActiveDrag: boolean;
  // 拖拽中的占位态：保留布局高度但隐藏内容。
  isPlaceholder?: boolean;
  // 锁定卡片高度：拖拽时用于稳定原位置占位高度。
  lockedHeight?: number;
  // 是否正在提交命令库写操作。
  commandLibrarySubmitting: boolean;
  // 打开编辑面板。
  onEdit: (groupId: string, command: TerminalCommandItem) => void;
  // 打开删除确认弹窗。
  onDelete: (groupId: string, command: TerminalCommandItem) => void;
  // 粘贴到当前终端。
  onPaste: (command: TerminalCommandItem) => void;
  // 注册命令卡片元素：用于拖拽开始时读取尺寸。
  registerCardElement: (commandId: string, element: HTMLDivElement | null) => void;
  // 打开右键菜单。
  onContextMenu: (event: MouseEvent<HTMLDivElement>, groupId: string, command: TerminalCommandItem) => void;
};

// TerminalPanel：左侧命令库 + 右侧真实终端工作区。
export function TerminalPanel({ visible = true }: TerminalPanelProps) {
  // Store：终端 Tab 与会话操作能力。
  const tabs = useTerminalStore((state) => state.tabs);
  const activeTabId = useTerminalStore((state) => state.activeTabId);
  const tabOrder = useTerminalStore((state) => state.tabOrder);
  const createTerminalTab = useTerminalStore((state) => state.createTerminalTab);
  const setActiveTabId = useTerminalStore((state) => state.setActiveTabId);
  const renameTerminalTab = useTerminalStore((state) => state.renameTerminalTab);
  const reorderTerminalTabs = useTerminalStore((state) => state.reorderTerminalTabs);
  const closeTerminalTab = useTerminalStore((state) => state.closeTerminalTab);
  // 平台标识：仅 Windows 显示“管理员终端”入口。
  const isWindowsPlatform = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);

  // 全局命令组（由后端 SQLite 表读取）。
  const [commandGroups, setCommandGroups] = useState<TerminalCommandGroup[]>([]);
  // 命令库加载态。
  const [commandLibraryLoading, setCommandLibraryLoading] = useState(false);
  // 命令库错误文本。
  const [commandLibraryError, setCommandLibraryError] = useState("");
  // 终端会话通知：用于提示 Shell 配置失效等创建失败场景。
  const [terminalSessionNotice, setTerminalSessionNotice] = useState("");
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
  // 当前拖拽中的命令 ID：用于高亮排序项。
  const [activeDragCommandId, setActiveDragCommandId] = useState("");
  // 当前拖拽命令快照：用于 DragOverlay 锁定尺寸。
  const [activeDragCommandSnapshot, setActiveDragCommandSnapshot] = useState<ActiveDragCommandSnapshot | null>(null);
  // 删除确认弹窗目标。
  const [deleteCommandTarget, setDeleteCommandTarget] = useState<DeleteCommandTarget | null>(null);
  // 删除命令组确认弹窗目标。
  const [deleteGroupTarget, setDeleteGroupTarget] = useState<DeleteGroupTarget | null>(null);
  // 当前正在编辑的命令组。
  const [editingGroup, setEditingGroup] = useState<TerminalCommandGroup | null>(null);
  // 命令组名称输入值：用于新建与重命名命令组。
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
  // 正在打开中的后端会话 Promise 映射：用于合并同一 Tab 的并发建连请求。
  const openingSessionPromiseByTabIdRef = useRef<Record<string, Promise<void>>>({});
  // 等待会话建立后自动粘贴的命令（用于“粘贴到当前终端”兜底）。
  const pendingPasteCommandByTabIdRef = useRef<Record<string, string>>({});
  // 上一次渲染时的 Tab ID 集合：用于回收已关闭 Tab 资源。
  const previousTabIdsRef = useRef<string[]>([]);
  // 命令库请求序号：用于丢弃过期响应。
  const commandLibraryRequestSeqRef = useRef(0);
  // 命令卡片元素映射：用于拖拽开始时读取真实尺寸。
  const commandCardElementByIdRef = useRef<Record<string, HTMLDivElement | null>>({});
  // xterm 视口同步调度帧：用于合并连续 fit，减少窗口缩放和切页时的抖动。
  const terminalFitFrameRef = useRef<number | null>(null);

  // 激活终端 Tab 派生值。
  const orderedTabs = useMemo(() => sortTabsByOrder(tabOrder, tabs), [tabOrder, tabs]);
  const activeTab = useMemo(() => orderedTabs.find((item) => item.id === activeTabId) || orderedTabs[0] || null, [orderedTabs, activeTabId]);

  // 当前选中命令组。
  const selectedGroup = useMemo(
    () => commandGroups.find((item) => item.id === selectedGroupId) || commandGroups[0] || null,
    [commandGroups, selectedGroupId]
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

  // dnd 传感器：设置轻微拖拽距离，减少点按按钮时误触排序。
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 6
      }
    })
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

  // 将 xterm 挂载到容器：仅负责 open，不在这里直接 fit，避免隐藏态和过渡态重复重排。
  const mountRuntimeToContainer = useCallback(
    (tab: TerminalTab) => {
      const container = terminalContainerByTabIdRef.current[tab.id];
      if (!container) return;

      const runtime = ensureTerminalRuntime(tab);
      // xterm 仅需 open 一次；若重复 open 会抛错，这里通过 children 长度判断。
      if (container.childElementCount === 0) {
        runtime.terminal.open(container);
      }
    },
    [ensureTerminalRuntime]
  );

  // 取消已排队的终端视口同步，避免多个 fit 连续执行时互相覆盖。
  const cancelScheduledTerminalFit = useCallback(() => {
    if (terminalFitFrameRef.current === null) return;
    window.cancelAnimationFrame(terminalFitFrameRef.current);
    terminalFitFrameRef.current = null;
  }, []);

  // 延后一帧同步终端视口尺寸：用于规避切换 Tab、显示隐藏和窗口缩放时的瞬时错误尺寸。
  const scheduleTerminalViewportSync = useCallback(
    (tab: TerminalTab, options?: { focus?: boolean }) => {
      cancelScheduledTerminalFit();
      terminalFitFrameRef.current = window.requestAnimationFrame(() => {
        terminalFitFrameRef.current = null;
        const container = terminalContainerByTabIdRef.current[tab.id];
        const runtime = terminalRuntimeByTabIdRef.current[tab.id];
        if (!container || !runtime) return;

        const rect = container.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return; // 隐藏态或未完成布局时跳过本次同步。

        runtime.fitAddon.fit(); // 先按容器最终尺寸执行 fit。
        if (options?.focus) {
          runtime.terminal.focus(); // 仅在激活切换时恢复焦点，避免 resize 抢焦点。
        }
        if (!openedSessionTabIdRef.current.has(tab.id)) return;
        void api.resizeTerminalSession(tab.id, runtime.terminal.cols || 120, runtime.terminal.rows || 36);
      });
    },
    [cancelScheduledTerminalFit]
  );

  // 打开后端终端会话（每个 Tab 一个系统进程）。
  const ensureBackendSession = useCallback(
    (tab: TerminalTab) => {
      if (openedSessionTabIdRef.current.has(tab.id)) return;
      const openingSessionPromise = openingSessionPromiseByTabIdRef.current[tab.id];
      if (openingSessionPromise) return openingSessionPromise;

      const nextOpeningPromise = (async () => {
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
          setTerminalSessionNotice("");
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

          // 若该 Tab 有待粘贴命令，会话建立后立即写入终端输入区。
          const pending = pendingPasteCommandByTabIdRef.current[tab.id];
          if (pending) {
            await api.writeTerminalInput(tab.id, pending);
            delete pendingPasteCommandByTabIdRef.current[tab.id];
          }
        } catch (error) {
          // 终端创建失败时统一提示用户回到终端设置重新选择 Shell。
          setTerminalSessionNotice(`终端创建失败，请到“设置-终端设置”中重新选择 Shell 后重试。详情：${String(error)}`);
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
        } finally {
          // 无论成功还是失败，都要清理打开中的标记，避免后续重试被卡住。
          delete openingSessionPromiseByTabIdRef.current[tab.id];
        }
      })();

      openingSessionPromiseByTabIdRef.current[tab.id] = nextOpeningPromise;
      return nextOpeningPromise;
    },
    [ensureTerminalRuntime]
  );

  // 初始化和回收终端资源：确保 Tab 与 PTY 生命周期一致。
  useEffect(() => {
    const currentTabIds = orderedTabs.map((item) => item.id);
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
      delete openingSessionPromiseByTabIdRef.current[tabId];
      delete terminalContainerByTabIdRef.current[tabId];
      delete pendingPasteCommandByTabIdRef.current[tabId];
      setProcessMetaByTabId((state) => {
        const next = { ...state };
        delete next[tabId];
        return next;
      });
      void api.closeTerminalSession(tabId); // 冗余回收后端进程，保证无残留。
    });

    // 为每个 Tab 挂载 xterm 并打开后端会话。
    orderedTabs.forEach((tab) => {
      mountRuntimeToContainer(tab);
      void ensureBackendSession(tab);
    });

    previousTabIdsRef.current = currentTabIds;
  }, [orderedTabs, ensureBackendSession, mountRuntimeToContainer]);

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

  // 激活 Tab 切换或 Terminal 视图重新显示时：挂载当前终端并延后一帧执行 fit。
  useEffect(() => {
    if (!visible) return;
    if (!activeTab) return;

    mountRuntimeToContainer(activeTab);
    scheduleTerminalViewportSync(activeTab, { focus: true });
  }, [visible, activeTab, mountRuntimeToContainer, scheduleTerminalViewportSync]);

  // 监听激活终端容器尺寸变化：统一处理窗口缩放和布局变化，减少重复 fit 带来的抖动。
  useEffect(() => {
    if (!visible) return;
    if (!activeTab) return;

    const container = terminalContainerByTabIdRef.current[activeTab.id];
    if (!container) return;

    const resizeObserver = new ResizeObserver(() => {
      scheduleTerminalViewportSync(activeTab); // 尺寸变化后合并到下一帧统一同步。
    });
    resizeObserver.observe(container);

    return () => {
      resizeObserver.disconnect();
      cancelScheduledTerminalFit(); // 切换 Tab 或隐藏面板时取消上一帧任务，避免旧尺寸回写。
    };
  }, [visible, activeTab, scheduleTerminalViewportSync, cancelScheduledTerminalFit]);

  // 组件卸载时，兜底销毁全部 xterm 实例。
  useEffect(() => {
    return () => {
      cancelScheduledTerminalFit(); // 卸载前取消所有待执行 fit，避免异步回调访问已销毁实例。
      Object.values(terminalRuntimeByTabIdRef.current).forEach((runtime) => {
        runtime.terminal.dispose();
      });
      terminalRuntimeByTabIdRef.current = {};
    };
  }, [cancelScheduledTerminalFit]);

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
    setEditingGroup(null);
    setNewGroupName("");
  }

  // 打开“重命名命令组”面板。
  function openRenameGroupPanel(group: TerminalCommandGroup) {
    setEditorMode("groupEdit");
    setEditingTarget(null);
    setEditingGroup(group);
    setNewGroupName(group.name);
    setSelectedGroupId(group.id);
    setExpandedByGroupId((state) => ({ ...state, [group.id]: true }));
  }

  // 打开“创建命令”面板。
  function openCreateCommandPanel(seedGroupId?: string) {
    const nextGroupId = seedGroupId || selectedGroup?.id || commandGroups[0]?.id || "";
    setEditorMode("create");
    setEditingTarget(null);
    setEditingGroup(null);
    setCommandForm(createEmptyCommandForm(nextGroupId));
  }

  // 打开“编辑命令”面板。
  function openEditCommandPanel(groupId: string, command: TerminalCommandItem) {
    setEditorMode("edit");
    setEditingTarget({ groupId, commandId: command.id });
    setEditingGroup(null);
    setCommandForm(createFormFromCommand(groupId, command));
    setSelectedGroupId(groupId);
    setExpandedByGroupId((state) => ({ ...state, [groupId]: true }));
  }

  // 关闭编辑面板并清理临时状态。
  function closeEditorPanel() {
    setEditorMode("closed");
    setEditingTarget(null);
    setEditingGroup(null);
    setNewGroupName("");
  }

  // 创建或重命名命令组。
  async function handleSubmitGroup() {
    const normalizedName = newGroupName.trim();
    if (!normalizedName) return;

    const payload: TerminalCommandGroupUpsertPayload = {
      name: normalizedName
    };

    setCommandLibrarySubmitting(true);
    try {
      if (editorMode === "groupEdit" && editingGroup) {
        const updated = await api.updateTerminalCommandGroup(editingGroup.id, payload);
        setSelectedGroupId(updated.id);
        setExpandedByGroupId((state) => ({ ...state, [updated.id]: true }));
      } else {
        const created = await api.createTerminalCommandGroup(normalizedName);
        setSelectedGroupId(created.id);
        setExpandedByGroupId((state) => ({ ...state, [created.id]: true }));
      }

      setNewGroupName("");
      closeEditorPanel();
      await loadCommandLibrary({ keepSelection: true });
    } catch (error) {
      const actionLabel = editorMode === "groupEdit" ? "重命名命令组" : "创建命令组";
      window.alert(`${actionLabel}失败：${String(error)}`); // 即时反馈失败原因，避免用户误以为提交无效。
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

  // 打开删除确认弹窗。
  function openDeleteCommandDialog(groupId: string, command: TerminalCommandItem) {
    setDeleteCommandTarget({ groupId, command });
    setCommandContextMenu(null);
  }

  // 关闭删除确认弹窗。
  function closeDeleteCommandDialog() {
    setDeleteCommandTarget(null);
  }

  // 打开删除命令组确认弹窗。
  function openDeleteGroupDialog(group: TerminalCommandGroup) {
    setDeleteGroupTarget({ group });
    setCommandContextMenu(null);
  }

  // 关闭删除命令组确认弹窗。
  function closeDeleteGroupDialog() {
    setDeleteGroupTarget(null);
  }

  // 确认删除命令。
  async function handleConfirmDeleteCommand() {
    if (!deleteCommandTarget) return;

    setCommandLibrarySubmitting(true);
    try {
      await api.deleteTerminalCommand(deleteCommandTarget.groupId, deleteCommandTarget.command.id);
      closeDeleteCommandDialog();
      await loadCommandLibrary({ keepSelection: true });
    } catch (error) {
      window.alert(`删除命令失败：${String(error)}`); // 避免删除失败后 UI 与数据库状态不一致。
    } finally {
      setCommandLibrarySubmitting(false);
    }
  }

  // 确认删除命令组。
  async function handleConfirmDeleteGroup() {
    if (!deleteGroupTarget) return;

    setCommandLibrarySubmitting(true);
    try {
      await api.deleteTerminalCommandGroup(deleteGroupTarget.group.id);
      closeDeleteGroupDialog();
      closeEditorPanel();
      await loadCommandLibrary();
    } catch (error) {
      window.alert(`删除命令组失败：${String(error)}`); // 避免级联删除失败后前后端状态不一致。
    } finally {
      setCommandLibrarySubmitting(false);
    }
  }

  // 将命令粘贴到当前终端输入区。
  async function handlePasteToCurrentTerminal(command: TerminalCommandItem) {
    let targetTab: TerminalTab | undefined = activeTab;
    if (!targetTab) {
      // 当前没有可用终端时自动创建新 Tab，保证“粘贴到当前终端”可用。
      const createdTabId = createTerminalTab(undefined, command.name ? `Terminal · ${command.name}` : undefined);
      if (!createdTabId) return;
      targetTab = useTerminalStore.getState().tabs.find((item) => item.id === createdTabId);
      if (!targetTab) return;
    }

    // 若会话尚未建立，则先缓存命令并触发建立。
    if (!openedSessionTabIdRef.current.has(targetTab.id)) {
      pendingPasteCommandByTabIdRef.current[targetTab.id] = command.command;
      await ensureBackendSession(targetTab);
      setCommandContextMenu(null);
      return;
    }

    await api.writeTerminalInput(targetTab.id, command.command);
    setCommandContextMenu(null);
  }

  // 提交命令组内排序结果，并同步到后端维护序号。
  async function handleReorderCommands(groupId: string, nextCommands: TerminalCommandItem[]) {
    setCommandGroups((state) =>
      state.map((group) => {
        if (group.id !== groupId) return group;
        return {
          ...group,
          commands: nextCommands
        };
      })
    );

    setCommandLibrarySubmitting(true);
    try {
      await api.reorderTerminalCommands({
        groupId,
        commandIds: nextCommands.map((command) => command.id)
      });
    } catch (error) {
      window.alert(`排序命令失败：${String(error)}`); // 排序失败时回滚到后端最新状态。
      await loadCommandLibrary({ keepSelection: true });
    } finally {
      setCommandLibrarySubmitting(false);
    }
  }

  // 拖拽开始：记录当前激活命令，供 UI 高亮。
  function handleCommandSortStart(event: DragStartEvent) {
    const activeId = String(event.active.id || "");
    setActiveDragCommandId(activeId);
    const activeGroup = commandGroups.find((group) => group.commands.some((command) => command.id === activeId));
    const activeCommand = activeGroup?.commands.find((command) => command.id === activeId) || null;
    const activeElement = commandCardElementByIdRef.current[activeId];
    if (!activeGroup || !activeCommand || !activeElement) {
      setActiveDragCommandSnapshot(null);
      return;
    }

    const rect = activeElement.getBoundingClientRect();
    setActiveDragCommandSnapshot({
      groupId: activeGroup.id,
      command: activeCommand,
      width: rect.width,
      height: rect.height
    });
  }

  // 拖拽结束：计算组内新顺序并持久化到后端。
  function handleCommandSortEnd(groupId: string, commands: TerminalCommandItem[], event: DragEndEvent) {
    const activeId = String(event.active.id || "");
    const overId = String(event.over?.id || "");
    setActiveDragCommandId("");
    setActiveDragCommandSnapshot(null);
    if (!activeId || !overId || activeId === overId) return;

    const oldIndex = commands.findIndex((command) => command.id === activeId);
    const newIndex = commands.findIndex((command) => command.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextCommands = arrayMove(commands, oldIndex, newIndex);
    void handleReorderCommands(groupId, nextCommands);
  }

  // 拖拽取消：清理激活态。
  function handleCommandSortCancel() {
    setActiveDragCommandId("");
    setActiveDragCommandSnapshot(null);
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

  // 批量关闭终端标签：逐个回收后端会话后再统一更新 UI。
  async function handleCloseTerminalTabs(tabIds: string[]) {
    if (tabIds.length === 0) return;
    await Promise.all(
      tabIds.map((tabId) =>
        api.closeTerminalSession(tabId).catch(() => {
          // 单个会话关闭失败不阻断其它标签回收。
        })
      )
    );
    useTerminalStore.getState().closeTerminalTabsByIds(tabIds);
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
      {/* 终端创建全局通知：用于展示 Shell 配置失效等错误。 */}
      {terminalSessionNotice && (
        <NoticeAlert
          tone="error"
          message={terminalSessionNotice}
          onClose={() => setTerminalSessionNotice("")}
          className="fixed right-4 top-4 z-[60] max-w-[420px] shadow-lg"
        />
      )}

      {/* 左侧命令库面板。 */}
      <div className="flex min-h-0 flex-col border-r border-base-300 bg-base-100">
        {/* 顶部控制区：统计、搜索、操作。 */}
        <div className="border-b border-base-300 p-3">
          {/* 头部工具区：仅保留按钮栏与搜索栏。 */}
          <div>
            {/* 顶部按钮栏。 */}
            <div className="flex items-center justify-end gap-1">
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

            {/* 搜索输入。 */}
            <label className="input input-bordered input-sm mt-2 flex w-full items-center gap-2">
              <Search size={14} className="text-neutral/60" />
              <input
                type="text"
                className="grow"
                placeholder="搜索组名 / 命令名 / 描述 / 命令正文"
                value={searchKeyword}
                onChange={(event) => setSearchKeyword(event.target.value)}
              />
              {/* 清空按钮：有搜索关键字时允许一键清空。 */}
              {searchKeyword && (
                <button
                  type="button"
                  className="text-neutral/50 transition-colors hover:text-neutral"
                  title="清空搜索"
                  onClick={() => setSearchKeyword("")}
                >
                  <X size={14} />
                </button>
              )}
            </label>
          </div>

          {/* 错误提示。 */}
          {commandLibraryError && <p className="mt-2 text-[12px] text-error">{commandLibraryError}</p>}

          {/* 创建/重命名命令组面板。 */}
          {(editorMode === "group" || editorMode === "groupEdit") && (
            <div className="mt-3 rounded-xl border border-base-300 bg-base-100 p-3 shadow-sm">
              {/* 面板标题。 */}
              <h4 className="text-[13px] font-semibold text-neutral">{editorMode === "groupEdit" ? "重命名命令组" : "新建命令组"}</h4>
              {/* 分组名输入。 */}
              <input
                type="text"
                className="input input-bordered input-sm mt-2 w-full"
                placeholder="例如：常用、脚本、排障"
                value={newGroupName}
                onChange={(event) => setNewGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key !== "Enter") return;
                  void handleSubmitGroup(); // 回车快速提交命令组创建或重命名。
                }}
              />
              {/* 操作按钮。 */}
              <div className="mt-3 flex justify-end gap-2">
                <button className="btn btn-ghost btn-sm" onClick={closeEditorPanel} disabled={commandLibrarySubmitting}>
                  取消
                </button>
                <button className="btn btn-primary btn-sm" onClick={() => void handleSubmitGroup()} disabled={commandLibrarySubmitting}>
                  {editorMode === "groupEdit" ? "保存重命名" : "创建分组"}
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
        <div className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden p-3 pt-2">
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
                  </button>
                  <button
                    className="btn btn-ghost btn-xs h-6 min-h-0 px-1"
                    title="在本组新建命令"
                    onClick={() => openCreateCommandPanel(group.id)}
                    disabled={commandLibrarySubmitting}
                  >
                    <Plus size={12} />
                  </button>
                  <button
                    className="btn btn-ghost btn-xs h-6 min-h-0 px-1"
                    title="重命名命令组"
                    onClick={() => openRenameGroupPanel(group)}
                    disabled={commandLibrarySubmitting}
                  >
                    <PencilLine size={12} />
                  </button>
                  <button
                    className="btn btn-ghost btn-xs h-6 min-h-0 px-1 text-error"
                    title="删除命令组"
                    onClick={() => openDeleteGroupDialog(group)}
                    disabled={commandLibrarySubmitting}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>

                {/* 分组命令列表。 */}
                {expanded && (
                  <div className="space-y-2 p-2">
                    {group.commands.length === 0 && <div className="px-2 py-2 text-[12px] text-neutral/55">当前分组还没有命令</div>}

                    {searchMode ? (
                      <div className="space-y-2">
                        {group.commands.map((commandItem) => (
                          <SortableCommandCard
                            key={commandItem.id}
                            groupId={group.id}
                            commandItem={commandItem}
                            searchMode={searchMode}
                            isActiveDrag={false}
                            isPlaceholder={false}
                            lockedHeight={undefined}
                            commandLibrarySubmitting={commandLibrarySubmitting}
                            registerCardElement={(commandId, element) => {
                              commandCardElementByIdRef.current[commandId] = element;
                            }}
                            onEdit={openEditCommandPanel}
                            onDelete={openDeleteCommandDialog}
                            onPaste={(command) => {
                              void handlePasteToCurrentTerminal(command);
                            }}
                            onContextMenu={(event, nextGroupId, command) => {
                              event.preventDefault(); // 阻止系统默认右键菜单。
                              setSelectedGroupId(nextGroupId);
                              setCommandContextMenu({
                                x: event.clientX,
                                y: event.clientY,
                                groupId: nextGroupId,
                                command
                              });
                            }}
                          />
                        ))}
                      </div>
                    ) : (
                      <DndContext
                        sensors={dndSensors}
                        collisionDetection={closestCenter}
                        modifiers={[restrictVerticalNoScale]}
                        onDragStart={handleCommandSortStart}
                        onDragEnd={(event) => {
                          handleCommandSortEnd(group.id, group.commands, event);
                        }}
                        onDragCancel={handleCommandSortCancel}
                      >
                        <SortableContext items={group.commands.map((command) => command.id)} strategy={verticalListSortingStrategy}>
                          <div className="space-y-2">
                            {group.commands.map((commandItem) => (
                              <SortableCommandCard
                                key={commandItem.id}
                                groupId={group.id}
                                commandItem={commandItem}
                                searchMode={searchMode}
                                isActiveDrag={activeDragCommandId === commandItem.id}
                                isPlaceholder={activeDragCommandId === commandItem.id}
                                lockedHeight={
                                  activeDragCommandId === commandItem.id ? activeDragCommandSnapshot?.height : undefined
                                }
                                commandLibrarySubmitting={commandLibrarySubmitting}
                                registerCardElement={(commandId, element) => {
                                  commandCardElementByIdRef.current[commandId] = element;
                                }}
                                onEdit={openEditCommandPanel}
                                onDelete={openDeleteCommandDialog}
                                onPaste={(command) => {
                                  void handlePasteToCurrentTerminal(command);
                                }}
                                onContextMenu={(event, nextGroupId, command) => {
                                  event.preventDefault(); // 阻止系统默认右键菜单。
                                  setSelectedGroupId(nextGroupId);
                                  setCommandContextMenu({
                                    x: event.clientX,
                                    y: event.clientY,
                                    groupId: nextGroupId,
                                    command
                                  });
                                }}
                              />
                            ))}
                          </div>
                        </SortableContext>
                      </DndContext>
                    )}
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
          <div className="min-w-0 flex-1 overflow-x-auto">
            <ReusableTabs
              tabs={orderedTabs.map((tab) => {
                const processMeta = processMetaByTabId[tab.id];
                const pidText = processMeta?.pid !== null && processMeta?.pid !== undefined ? String(processMeta.pid) : "-";
                const commandText = processMeta?.commandLine || "-";
                const terminalVersionText = processMeta?.shellVersion
                  ? `${processMeta.shellName || "Terminal"} ${processMeta.shellVersion}`
                  : "-";
                const tooltipText = `进程 ID (PID): ${pidText}\n命令行: ${commandText}\n终端版本: ${terminalVersionText}`;
                return {
                  id: tab.id,
                  title: tab.name,
                  closable: true,
                  renameable: true,
                  titleTooltip: tooltipText,
                  statusTone: processMeta?.opening ? "warning" : processMeta?.connected ? "success" : "idle"
                };
              })}
              activeTabId={activeTab?.id || ""}
              emptyText="请点击 + 新建终端"
              createButtonTitle="新建终端"
              onActivateTab={setActiveTabId}
              onCreateTab={handleCreateTerminalTab}
              onReorderTabs={reorderTerminalTabs}
              onRenameTab={renameTerminalTab}
              onCloseTab={(tabId) => {
                void handleCloseTerminalTab(tabId);
              }}
              onCloseTabs={(tabIds) => {
                void handleCloseTerminalTabs(tabIds);
              }}
            />
          </div>
          {/* Windows 管理员终端入口：管理员权限会在新窗口中打开。 */}
          {isWindowsPlatform && (
            <button className="btn btn-ghost btn-sm mr-2" onClick={() => void handleOpenElevatedTerminal()} title="以管理员身份打开终端">
              <Shield size={14} />
            </button>
          )}
        </div>

        {/* 终端渲染区：使用 xterm 作为真实交互终端，不再使用底部输入框。 */}
        <div className={`relative min-h-0 flex-1 overflow-hidden ${tabs.length === 0 ? "bg-base-100" : "bg-[#0f172a]"}`}>
          {/* 空态内容：无终端 Tab 时显示引导文案，避免展示 xterm 蓝色背景。 */}
          {tabs.length === 0 && (
            <div className="flex h-full w-full items-center justify-center px-4">
              <span className="text-[12px] text-neutral/70">暂无终端标签，请点击上方 + 创建终端</span>
            </div>
          )}
          {tabs.map((tab) => (
            // 每个 Tab 对应一个终端视口外壳，非激活态仅隐藏不销毁。
            <div key={tab.id} className={`h-full w-full p-2 ${activeTab?.id === tab.id ? "block" : "hidden"}`}>
              {/*
                真正的 xterm 挂载容器：保持无 padding，避免 FitAddon 将父容器内边距误算进可用高度，
                从而导致底部多塞一行、最后一行被裁切。
              */}
              <div
                className="h-full w-full"
                ref={(element) => {
                  terminalContainerByTabIdRef.current[tab.id] = element;
                  if (!element) return;
                  mountRuntimeToContainer(tab); // 容器挂载后立即初始化 xterm。
                }}
              />
            </div>
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
          {/* 菜单项：粘贴到当前终端。 */}
          <button
            className="btn btn-ghost btn-xs w-full justify-start"
            onClick={() => {
              void handlePasteToCurrentTerminal(commandContextMenu.command);
            }}
          >
            <Clipboard size={12} />
            粘贴到当前终端
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
              openDeleteCommandDialog(commandContextMenu.groupId, commandContextMenu.command);
            }}
          >
            <Trash2 size={12} />
            删除命令
          </button>
        </div>
      )}

      {/* 删除命令组确认弹窗。 */}
      {deleteGroupTarget && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">确认删除命令组</h3>
            {/* 删除说明。 */}
            <p className="mt-2 text-sm text-neutral/70">
              确定删除命令组“{deleteGroupTarget.group.name}”吗？该分组下的 {deleteGroupTarget.group.commands.length} 条命令会一并删除，且无法恢复。
            </p>
            {/* 命令组摘要。 */}
            <div className="mt-3 rounded-lg bg-base-200/70 px-3 py-2 text-[12px] text-neutral/75">
              <p className="font-medium text-neutral">{deleteGroupTarget.group.name}</p>
              <p className="mt-1">命令数量：{deleteGroupTarget.group.commands.length}</p>
            </div>
            {/* 弹窗底部操作。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeDeleteGroupDialog} disabled={commandLibrarySubmitting}>
                取消
              </button>
              <button className="btn btn-error" onClick={() => void handleConfirmDeleteGroup()} disabled={commandLibrarySubmitting}>
                {commandLibrarySubmitting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 删除确认弹窗。 */}
      {deleteCommandTarget && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">确认删除命令</h3>
            {/* 删除说明。 */}
            <p className="mt-2 text-sm text-neutral/70">
              确定删除命令“{deleteCommandTarget.command.name}”吗？删除后无法恢复。
            </p>
            {/* 命令预览。 */}
            <div className="mt-3 rounded-lg bg-base-200/70 px-3 py-2 text-[12px] text-neutral/75">
              <p className="font-medium text-neutral">{deleteCommandTarget.command.name}</p>
              <p className="mt-1 whitespace-pre-wrap break-all font-mono text-[11px]">{deleteCommandTarget.command.command}</p>
            </div>
            {/* 弹窗底部操作。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeDeleteCommandDialog} disabled={commandLibrarySubmitting}>
                取消
              </button>
              <button className="btn btn-error" onClick={() => void handleConfirmDeleteCommand()} disabled={commandLibrarySubmitting}>
                {commandLibrarySubmitting ? "删除中..." : "确认删除"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 拖拽浮层：使用独立 Overlay 固定拖拽卡片尺寸，避免不同高度卡片在排序时抖动。 */}
      <DragOverlay modifiers={[restrictVerticalNoScale]}>
        {activeDragCommandSnapshot ? (
          <div
            className="rounded-lg border border-primary bg-base-100 p-2 shadow-xl"
            style={{
              width: `${activeDragCommandSnapshot.width}px`,
              height: `${activeDragCommandSnapshot.height}px`,
              boxSizing: "border-box",
              overflow: "hidden"
            }}
          >
            <div className="flex items-center justify-between gap-2">
              <div className="flex min-w-0 items-start gap-2">
                <span className="mt-0.5 text-neutral/35">
                  <GripVertical size={14} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12px] font-semibold text-neutral">{activeDragCommandSnapshot.command.name}</p>
                  {activeDragCommandSnapshot.command.description && (
                    <p className="mt-0.5 line-clamp-2 text-[11px] text-neutral/65">{activeDragCommandSnapshot.command.description}</p>
                  )}
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-1 opacity-70">
                <Clipboard size={12} />
                <PencilLine size={12} />
                <Trash2 size={12} />
              </div>
            </div>
            <p className="mt-2 whitespace-pre-wrap break-all rounded-md bg-neutral/95 px-2 py-1 font-mono text-[11px] text-base-100">
              {activeDragCommandSnapshot.command.command}
            </p>
          </div>
        ) : null}
      </DragOverlay>
    </div>
  );
}
