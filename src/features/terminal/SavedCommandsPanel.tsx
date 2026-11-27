import { useCallback, useEffect, useMemo, useState } from "react";
import {
  closestCenter,
  DndContext,
  type DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
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
  Trash2,
  X
} from "lucide-react";
import { api } from "../../api";
import type { TerminalCommandGroup, TerminalCommandItem } from "../../types";
import { CommandEditorModal, type CommandEditorTarget } from "./CommandEditorModal";

type SavedCommandsPanelProps = {
  // 将命令填入当前终端（不自动执行回车）。
  onFillCommand: (commandText: string) => void;
  // 保留兼容的可选执行回调（当前界面仅保留粘贴填入按钮）。
  onRunCommand?: (commandText: string) => void;
  // 外部触发快速保存命令的文本信号（带递增 nonce 以便重复触发）。
  quickSaveRequest?: { text: string; nonce: number } | null;
};

type SortableItemRowProps = {
  // 所属分组 ID。
  groupId: string;
  // 命令对象。
  item: TerminalCommandItem;
  // 搜索模式下禁用拖拽排序。
  searchMode: boolean;
  // 粘贴到当前终端回调（不自动执行）。
  onFill: (commandText: string) => void;
  // 编辑回调。
  onEdit: (groupId: string, item: TerminalCommandItem) => void;
  // 删除回调。
  onDelete: (groupId: string, item: TerminalCommandItem) => void;
};

// 单个可排序命令条目：单行不换行展示，悬停弹出完整命令 Tip，仅提供粘贴到当前终端按钮。
function SortableCommandRow({
  groupId,
  item,
  searchMode,
  onFill,
  onEdit,
  onDelete
}: SortableItemRowProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id,
    disabled: searchMode
  });

  // 悬停提示框定位状态（使用 fixed 定位避免被列表滚动容器裁剪）。
  const [tipPos, setTipPos] = useState<{ bottom: number; right: number } | null>(null);

  const style = {
    transform: CSS.Transform.toString(transform ? { ...transform, x: 0, scaleX: 1, scaleY: 1 } : null),
    transition
  };

  // 计算并展示完整命令悬浮提示。
  const handleMouseEnter = (event: React.MouseEvent<HTMLDivElement>) => {
    const rect = event.currentTarget.getBoundingClientRect();
    setTipPos({
      bottom: Math.max(8, window.innerHeight - rect.top + 6),
      right: Math.max(8, window.innerWidth - rect.right)
    });
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setTipPos(null)}
      className={`group/item relative flex items-center gap-1.5 border-t border-base-300/45 px-2 py-1.5 whitespace-nowrap transition-colors hover:bg-base-200/55 ${
        isDragging ? "bg-primary/5 opacity-75" : ""
      }`}
    >
      {/* 拖拽手柄。 */}
      {!searchMode && (
        <button
          ref={setActivatorNodeRef}
          type="button"
          className="shrink-0 cursor-grab text-neutral/25 hover:text-neutral/60 active:cursor-grabbing group-hover/item:text-neutral/50"
          title="拖动排序"
          {...attributes}
          {...listeners}
        >
          <GripVertical size={12} />
        </button>
      )}

      {/* 单行展示：命令名称 + 单行省略命令正文。 */}
      <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
        <span className="max-w-[100px] shrink-0 truncate text-[12px] font-medium text-neutral">{item.name}</span>
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] text-neutral/60">{item.command}</span>
      </div>

      {/* 操作区：默认仅显示一个“粘贴到当前终端”按钮，悬停时额外显示编辑与删除。 */}
      <div className="flex shrink-0 items-center gap-0.5">
        <button
          type="button"
          title="编辑"
          onClick={() => onEdit(groupId, item)}
          className="hidden h-5 w-5 items-center justify-center rounded text-neutral/65 hover:bg-base-200 group-hover/item:flex"
        >
          <PencilLine size={11} />
        </button>
        <button
          type="button"
          title="删除"
          onClick={() => onDelete(groupId, item)}
          className="hidden h-5 w-5 items-center justify-center rounded text-error/80 hover:bg-error/10 group-hover/item:flex"
        >
          <Trash2 size={11} />
        </button>
        <button
          type="button"
          title="粘贴到当前终端（不自动执行）"
          onClick={() => onFill(item.command)}
          className="flex h-5 w-5 items-center justify-center rounded text-primary hover:bg-primary/10"
        >
          <Clipboard size={12} />
        </button>
      </div>

      {/* 鼠标悬停弹出 Tip：展示命令名称、说明与完整命令内容。 */}
      {tipPos && !isDragging && (
        <div
          style={{ bottom: tipPos.bottom, right: tipPos.right }}
          className="pointer-events-none fixed z-[140] w-[340px] max-w-[85vw] whitespace-normal rounded-lg border border-base-300 bg-base-100 p-2.5 shadow-xl"
        >
          <div className="text-[12px] font-semibold text-neutral">{item.name}</div>
          {item.description && <div className="mt-0.5 text-[11px] text-neutral/65">{item.description}</div>}
          <pre className="mt-1.5 max-h-40 overflow-hidden whitespace-pre-wrap break-all rounded bg-base-200/80 px-2 py-1 font-mono text-[11px] leading-snug text-neutral">
            {item.command}
          </pre>
        </div>
      )}
    </div>
  );
}

// 统一常用命令管理面板：服务于底部终端抽屉侧栏与命令库插件。
export function SavedCommandsPanel({ onFillCommand, quickSaveRequest }: SavedCommandsPanelProps) {
  // 命令分组列表。
  const [groups, setGroups] = useState<TerminalCommandGroup[]>([]);
  // 加载状态。
  const [loading, setLoading] = useState(false);
  // 错误提示。
  const [errorMsg, setErrorMsg] = useState("");
  // 搜索关键字。
  const [keyword, setKeyword] = useState("");
  // 分组展开状态映射。
  const [expandedByGroupId, setExpandedByGroupId] = useState<Record<string, boolean>>({});
  // 当前打开的编辑器目标。
  const [editorTarget, setEditorTarget] = useState<CommandEditorTarget | null>(null);
  // 待删除确认目标（分组或命令）。
  const [pendingDelete, setPendingDelete] = useState<
    | { kind: "group"; group: TerminalCommandGroup }
    | { kind: "command"; groupId: string; command: TerminalCommandItem }
    | null
  >(null);

  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  // 加载全部命令分组与命令。
  const loadGroups = useCallback(async (expandGroupId?: string) => {
    setLoading(true);
    setErrorMsg("");
    try {
      const list = await api.listTerminalCommandGroups();
      setGroups(list);
      setExpandedByGroupId((prev) => {
        const next: Record<string, boolean> = {};
        list.forEach((group, idx) => {
          next[group.id] = group.id === expandGroupId ? true : (prev[group.id] ?? idx === 0);
        });
        return next;
      });
    } catch (err) {
      setErrorMsg(`加载命令库失败：${String(err)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadGroups();
  }, [loadGroups]);

  // 响应外部“快速保存为常用命令”请求。
  useEffect(() => {
    if (!quickSaveRequest) return;
    if (groups.length === 0) {
      // 若尚无分组，先引导创建分组。
      setEditorTarget({ mode: "group" });
      return;
    }
    setEditorTarget({
      mode: "create",
      group: groups[0],
      seedCommandText: quickSaveRequest.text
    });
  }, [quickSaveRequest, groups]);

  // 按关键字过滤分组与命令。
  const filteredGroups = useMemo(() => {
    const q = keyword.trim().toLowerCase();
    if (!q) return groups;
    return groups
      .map((group) => {
        if (group.name.toLowerCase().includes(q)) return group;
        const matched = group.commands.filter((cmd) =>
          [cmd.name, cmd.description, cmd.command].join(" ").toLowerCase().includes(q)
        );
        return { ...group, commands: matched };
      })
      .filter((group) => group.commands.length > 0 || group.name.toLowerCase().includes(q));
  }, [groups, keyword]);

  // 处理组内拖拽排序。
  async function handleDragEnd(groupId: string, commands: TerminalCommandItem[], event: DragEndEvent) {
    const activeId = String(event.active.id || "");
    const overId = String(event.over?.id || "");
    if (!activeId || !overId || activeId === overId) return;
    const oldIdx = commands.findIndex((c) => c.id === activeId);
    const newIdx = commands.findIndex((c) => c.id === overId);
    if (oldIdx < 0 || newIdx < 0) return;

    const nextCommands = arrayMove(commands, oldIdx, newIdx);
    setGroups((prev) => prev.map((g) => (g.id === groupId ? { ...g, commands: nextCommands } : g)));
    try {
      await api.reorderTerminalCommands({
        groupId,
        commandIds: nextCommands.map((c) => c.id)
      });
    } catch (err) {
      setErrorMsg(`排序失败：${String(err)}`);
      await loadGroups(groupId);
    }
  }

  // 执行删除确认。
  async function handleConfirmDelete() {
    if (!pendingDelete) return;
    try {
      if (pendingDelete.kind === "group") {
        await api.deleteTerminalCommandGroup(pendingDelete.group.id);
        await loadGroups();
      } else {
        await api.deleteTerminalCommand(pendingDelete.groupId, pendingDelete.command.id);
        await loadGroups(pendingDelete.groupId);
      }
      setPendingDelete(null);
    } catch (err) {
      setErrorMsg(`删除失败：${String(err)}`);
    }
  }

  const searchMode = Boolean(keyword.trim());

  return (
    <div className="flex h-full min-h-0 flex-col bg-base-100 text-[12px]">
      {/* 顶部工具栏与搜索框。 */}
      <div className="shrink-0 border-b border-base-300/80 px-2.5 py-2">
        <div className="flex items-center justify-between gap-1">
          <span className="font-semibold text-neutral">常用命令</span>
          <div className="flex items-center gap-0.5">
            <button
              type="button"
              title="刷新"
              onClick={() => void loadGroups()}
              disabled={loading}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-base-200"
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              type="button"
              title="新建分组"
              onClick={() => setEditorTarget({ mode: "group" })}
              className="flex h-6 w-6 items-center justify-center rounded hover:bg-base-200"
            >
              <FolderPlus size={13} />
            </button>
            <button
              type="button"
              title="新建命令"
              disabled={groups.length === 0}
              onClick={() => setEditorTarget({ mode: "create", group: groups[0] })}
              className="flex h-6 w-6 items-center justify-center rounded text-primary hover:bg-primary/10 disabled:opacity-40"
            >
              <Plus size={14} />
            </button>
          </div>
        </div>

        <label className="mt-1.5 flex h-7 items-center gap-1.5 rounded-lg border border-base-300 bg-base-200/40 px-2">
          <Search size={12} className="shrink-0 text-neutral/55" />
          <input
            type="text"
            className="min-w-0 flex-1 bg-transparent text-[11px] outline-none"
            placeholder="搜索命令名称或内容..."
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
          {keyword && (
            <button type="button" onClick={() => setKeyword("")} className="text-neutral/50 hover:text-neutral">
              <X size={12} />
            </button>
          )}
        </label>

        {errorMsg && <p className="mt-1.5 text-[11px] text-error">{errorMsg}</p>}
      </div>

      {/* 命令分组与条目列表：采用扁平折叠分区，消除多层卡片嵌套以提升窄栏显示效率。 */}
      <div className="min-h-0 flex-1 divide-y divide-base-300/60 overflow-y-auto">
        {!loading && filteredGroups.length === 0 && (
          <div className="m-2 rounded-lg border border-dashed border-base-300 p-4 text-center text-[11px] text-neutral/60">
            暂无常用命令，请先新建分组或命令。
          </div>
        )}

        {filteredGroups.map((group) => {
          const expanded = searchMode ? true : (expandedByGroupId[group.id] ?? false);
          return (
            <div key={group.id}>
              {/* 分组折叠头部：扁平通栏样式，悬停显示编辑与删除按钮。 */}
              <div className="group/header flex items-center gap-1 bg-base-200/40 px-2 py-1.5 transition-colors hover:bg-base-200/70">
                <button
                  type="button"
                  onClick={() => setExpandedByGroupId((prev) => ({ ...prev, [group.id]: !expanded }))}
                  className="flex h-4 w-4 shrink-0 items-center justify-center rounded text-neutral/65 hover:text-neutral"
                >
                  {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <button
                  type="button"
                  onClick={() => setExpandedByGroupId((prev) => ({ ...prev, [group.id]: !expanded }))}
                  className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
                >
                  <span className="truncate text-[12px] font-medium text-neutral">{group.name}</span>
                  <span className="shrink-0 text-[10px] text-neutral/45">{group.commands.length}</span>
                </button>
                <button
                  type="button"
                  title="在此分组新建命令"
                  onClick={() => setEditorTarget({ mode: "create", group })}
                  className="flex h-5 w-5 items-center justify-center rounded text-neutral/65 hover:bg-base-200 hover:text-neutral"
                >
                  <Plus size={12} />
                </button>
                <button
                  type="button"
                  title="重命名分组"
                  onClick={() => setEditorTarget({ mode: "groupEdit", group })}
                  className="hidden h-5 w-5 items-center justify-center rounded text-neutral/65 hover:bg-base-200 group-hover/header:flex"
                >
                  <PencilLine size={11} />
                </button>
                <button
                  type="button"
                  title="删除分组"
                  onClick={() => setPendingDelete({ kind: "group", group })}
                  className="hidden h-5 w-5 items-center justify-center rounded text-error/75 hover:bg-error/10 group-hover/header:flex"
                >
                  <Trash2 size={11} />
                </button>
              </div>

              {expanded && (
                <div>
                  {group.commands.length === 0 ? (
                    <p className="border-t border-base-300/45 py-2 text-center text-[11px] text-neutral/55">暂无命令</p>
                  ) : (
                    <DndContext
                      sensors={sensors}
                      collisionDetection={closestCenter}
                      onDragEnd={(event) => void handleDragEnd(group.id, group.commands, event)}
                    >
                      <SortableContext items={group.commands.map((c) => c.id)} strategy={verticalListSortingStrategy}>
                        <div>
                          {group.commands.map((cmd) => (
                            <SortableCommandRow
                              key={cmd.id}
                              groupId={group.id}
                              item={cmd}
                              searchMode={searchMode}
                              onFill={onFillCommand}
                              onEdit={(gId, item) => {
                                const targetGroup = groups.find((g) => g.id === gId) || null;
                                setEditorTarget({ mode: "edit", group: targetGroup, command: item });
                              }}
                              onDelete={(gId, item) => setPendingDelete({ kind: "command", groupId: gId, command: item })}
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

      {/* 命令与分组编辑器弹窗。 */}
      <CommandEditorModal
        target={editorTarget}
        groups={groups}
        onClose={() => setEditorTarget(null)}
        onSaved={(targetGroupId) => loadGroups(targetGroupId)}
      />

      {/* 删除确认弹窗。 */}
      {pendingDelete && (
        <div
          className="fixed inset-0 z-[125] flex items-center justify-center bg-black/25 backdrop-blur-[2px]"
          onClick={() => setPendingDelete(null)}
        >
          <div
            className="w-[380px] max-w-[90vw] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl"
            onClick={(event) => event.stopPropagation()}
          >
            <h4 className="text-[14px] font-semibold">
              {pendingDelete.kind === "group" ? "确认删除命令组" : "确认删除常用命令"}
            </h4>
            <p className="mt-2 text-[12px] text-neutral/75">
              {pendingDelete.kind === "group"
                ? `确定删除分组“${pendingDelete.group.name}”及其下 ${pendingDelete.group.commands.length} 条命令吗？`
                : `确定删除命令“${pendingDelete.command.name}”吗？`}
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm rounded-lg" onClick={() => setPendingDelete(null)}>
                取消
              </button>
              <button type="button" className="btn btn-error btn-sm rounded-lg" onClick={() => void handleConfirmDelete()}>
                确认删除
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
