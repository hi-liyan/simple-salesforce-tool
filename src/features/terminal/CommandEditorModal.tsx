import { useEffect, useState } from "react";
import Editor from "@monaco-editor/react";
import { Clipboard, X } from "lucide-react";
import { api } from "../../api";
import type {
  TerminalCommandGroup,
  TerminalCommandGroupUpsertPayload,
  TerminalCommandItem,
  TerminalCommandUpsertPayload
} from "../../types";

// 命令编辑器模式：新建分组、重命名分组、新建命令、编辑命令。
export type CommandEditorMode = "group" | "groupEdit" | "create" | "edit";

// 命令编辑器目标参数。
export type CommandEditorTarget = {
  // 编辑器模式。
  mode: CommandEditorMode;
  // 目标分组（用于重命名分组或默认选中分组）。
  group?: TerminalCommandGroup | null;
  // 目标命令（用于编辑命令）。
  command?: TerminalCommandItem | null;
  // 预填充的命令文本（如从终端选区快速保存）。
  seedCommandText?: string;
};

type CommandEditorModalProps = {
  // 当前打开的编辑目标，为 null 时不渲染。
  target: CommandEditorTarget | null;
  // 可选命令分组列表。
  groups: TerminalCommandGroup[];
  // 关闭弹窗回调。
  onClose: () => void;
  // 保存成功后回调（传递目标分组 ID 以便高亮展开）。
  onSaved: (groupId?: string) => Promise<void> | void;
};

// 常用命令与分组编辑弹窗：支持新建/重命名分组及新建/编辑命令。
export function CommandEditorModal({ target, groups, onClose, onSaved }: CommandEditorModalProps) {
  // 分组名称输入值。
  const [groupName, setGroupName] = useState("");
  // 目标分组 ID。
  const [groupId, setGroupId] = useState("");
  // 命令名称输入值。
  const [name, setName] = useState("");
  // 命令描述输入值。
  const [description, setDescription] = useState("");
  // 命令正文输入值。
  const [commandText, setCommandText] = useState("");
  // 提交加载状态。
  const [submitting, setSubmitting] = useState(false);
  // 表单错误提示。
  const [errorMsg, setErrorMsg] = useState("");

  // 每次打开目标变化时初始化表单状态。
  useEffect(() => {
    if (!target) return;
    setErrorMsg("");
    if (target.mode === "group") {
      setGroupName("");
      return;
    }
    if (target.mode === "groupEdit") {
      setGroupName(target.group?.name || "");
      return;
    }
    if (target.mode === "edit" && target.command) {
      setGroupId(target.group?.id || groups[0]?.id || "");
      setName(target.command.name);
      setDescription(target.command.description || "");
      setCommandText(target.command.command);
      return;
    }
    setGroupId(target.group?.id || groups[0]?.id || "");
    setName("");
    setDescription("");
    setCommandText(target.seedCommandText || "");
  }, [target, groups]);

  if (!target) return null;

  const isGroupMode = target.mode === "group" || target.mode === "groupEdit";
  const canSubmitCommand = Boolean(groupId && name.trim() && commandText.trim());

  // 从系统剪贴板读取文本并填充到命令正文。
  async function handlePasteClipboard() {
    try {
      const text = await navigator.clipboard.readText();
      setCommandText(text);
    } catch (err) {
      setErrorMsg(`读取剪贴板失败：${String(err)}`);
    }
  }

  // 提交分组创建或重命名。
  async function handleSubmitGroup() {
    const trimmedName = groupName.trim();
    if (!trimmedName) {
      setErrorMsg("请输入命令组名称");
      return;
    }
    setSubmitting(true);
    setErrorMsg("");
    try {
      let targetGroupId = target?.group?.id;
      if (target?.mode === "groupEdit" && target.group) {
        const payload: TerminalCommandGroupUpsertPayload = { name: trimmedName };
        const updated = await api.updateTerminalCommandGroup(target.group.id, payload);
        targetGroupId = updated.id;
      } else {
        const created = await api.createTerminalCommandGroup(trimmedName);
        targetGroupId = created.id;
      }
      await onSaved(targetGroupId);
      onClose();
    } catch (err) {
      setErrorMsg(`保存分组失败：${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  // 提交命令创建或更新。
  async function handleSubmitCommand() {
    if (!canSubmitCommand || !target) return;
    const payload: TerminalCommandUpsertPayload = {
      groupId,
      name: name.trim(),
      description: description.trim(),
      command: commandText.trim()
    };

    setSubmitting(true);
    setErrorMsg("");
    try {
      if (target.mode === "edit" && target.command) {
        const originalGroupId = target.group?.id || "";
        // 若编辑时切换了分组，先创建新命令再删除旧命令。
        if (originalGroupId && originalGroupId !== payload.groupId) {
          await api.createTerminalCommand(payload);
          await api.deleteTerminalCommand(originalGroupId, target.command.id);
        } else {
          await api.updateTerminalCommand(target.command.id, payload);
        }
      } else {
        await api.createTerminalCommand(payload);
      }
      await onSaved(payload.groupId);
      onClose();
    } catch (err) {
      setErrorMsg(`保存命令失败：${String(err)}`);
    } finally {
      setSubmitting(false);
    }
  }

  const titleMap: Record<CommandEditorMode, string> = {
    group: "新建命令组",
    groupEdit: "重命名命令组",
    create: "保存常用命令",
    edit: "编辑常用命令"
  };

  return (
    <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/25 backdrop-blur-[2px]" onClick={onClose}>
      {/* 浮岛弹窗主体：阻止点击穿透关闭。 */}
      <div
        className="w-[460px] max-w-[92vw] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        {/* 头部标题与关闭按钮。 */}
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-[14px] font-semibold text-neutral">{titleMap[target.mode]}</h3>
          <button
            type="button"
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
          >
            <X size={15} />
          </button>
        </div>

        {/* 错误提示条。 */}
        {errorMsg && (
          <div className="mb-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">{errorMsg}</div>
        )}

        {isGroupMode ? (
          <div className="space-y-3">
            <div>
              <label className="mb-1 block text-[12px] font-medium text-neutral/80">分组名称</label>
              <input
                autoFocus
                type="text"
                className="input input-bordered input-sm w-full rounded-lg"
                placeholder="例如：常用、Salesforce CLI、MySQL 运维"
                value={groupName}
                onChange={(event) => setGroupName(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void handleSubmitGroup();
                  }
                }}
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost btn-sm rounded-lg" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-lg"
                onClick={() => void handleSubmitGroup()}
                disabled={submitting || !groupName.trim()}
              >
                {submitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        ) : (
          <div className="space-y-2.5">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <label className="mb-1 block text-[11px] font-medium text-neutral/75">所属分组</label>
                <select
                  className="select select-bordered select-sm w-full rounded-lg"
                  value={groupId}
                  onChange={(event) => setGroupId(event.target.value)}
                >
                  {groups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="mb-1 block text-[11px] font-medium text-neutral/75">命令名称</label>
                <input
                  autoFocus
                  type="text"
                  className="input input-bordered input-sm w-full rounded-lg"
                  placeholder="例如：查看 Org 列表"
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                />
              </div>
            </div>

            <div>
              <label className="mb-1 block text-[11px] font-medium text-neutral/75">描述（可选）</label>
              <input
                type="text"
                className="input input-bordered input-sm w-full rounded-lg"
                placeholder="简短说明用途或参数提示"
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            </div>

            <div>
              <div className="mb-1 flex items-center justify-between">
                <label className="text-[11px] font-medium text-neutral/75">命令正文</label>
                <button
                  type="button"
                  className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-primary hover:bg-primary/10"
                  onClick={() => void handlePasteClipboard()}
                >
                  <Clipboard size={11} />
                  <span>从剪贴板粘贴</span>
                </button>
              </div>
              <div className="overflow-hidden rounded-lg border border-base-300">
                <Editor
                  height="150px"
                  defaultLanguage="plaintext"
                  value={commandText}
                  theme="vs-dark"
                  onChange={(value) => setCommandText(value || "")}
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
                    fontSize: 12,
                    fontFamily: '"Cascadia Mono", "Consolas", "Noto Sans Mono CJK SC", monospace',
                    automaticLayout: true,
                    padding: { top: 8, bottom: 8 }
                  }}
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-1">
              <button type="button" className="btn btn-ghost btn-sm rounded-lg" onClick={onClose} disabled={submitting}>
                取消
              </button>
              <button
                type="button"
                className="btn btn-primary btn-sm rounded-lg"
                onClick={() => void handleSubmitCommand()}
                disabled={!canSubmitCommand || submitting}
              >
                {submitting ? "保存中..." : "保存命令"}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
