import { useEffect, useMemo, useState } from "react";
import { Copy, Play, Plus, Search, Trash2, X } from "lucide-react";
import { TerminalCommandItem, useTerminalStore } from "../../../store/useTerminalStore";

// TerminalPanel：左侧命令库 + 右侧多终端工作区。
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
  const setTerminalInputDraft = useTerminalStore((state) => state.setTerminalInputDraft);
  const appendTerminalOutput = useTerminalStore((state) => state.appendTerminalOutput);
  const copyCommandToActiveTerminal = useTerminalStore((state) => state.copyCommandToActiveTerminal);
  const copyCommandToNewTerminal = useTerminalStore((state) => state.copyCommandToNewTerminal);

  // 搜索关键字：支持按名称或命令模糊匹配。
  const [searchKeyword, setSearchKeyword] = useState("");
  // 当前选中命令组 ID：用于在左侧固定查看和新增命令。
  const [selectedGroupId, setSelectedGroupId] = useState("");
  // 新增命令组输入值。
  const [newGroupName, setNewGroupName] = useState("");
  // 新增命令名称输入值。
  const [newCommandName, setNewCommandName] = useState("");
  // 新增命令正文输入值。
  const [newCommandValue, setNewCommandValue] = useState("");
  // 当前编辑命令 ID（仅允许一条命令处于编辑态）。
  const [editingCommandId, setEditingCommandId] = useState("");
  // 编辑态命令名称。
  const [editingCommandName, setEditingCommandName] = useState("");
  // 编辑态命令正文。
  const [editingCommandValue, setEditingCommandValue] = useState("");
  // 命令右键菜单状态。
  const [commandContextMenu, setCommandContextMenu] = useState<{ x: number; y: number; groupId: string; command: TerminalCommandItem } | null>(
    null
  );

  // 激活终端 Tab 派生值。
  const activeTab = useMemo(() => tabs.find((item) => item.id === activeTabId) || tabs[0] || null, [tabs, activeTabId]);

  // 过滤后的命令组：支持名称与命令全文模糊搜索。
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

  // 当命令组变化时兜底选中项，避免出现空指针。
  useEffect(() => {
    if (selectedGroupId && commandGroups.some((item) => item.id === selectedGroupId)) return;
    setSelectedGroupId(commandGroups[0]?.id || "");
  }, [selectedGroupId, commandGroups]);

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

  // 新增命令组。
  function handleCreateGroup() {
    const groupId = createCommandGroup(newGroupName);
    if (!groupId) return;
    setSelectedGroupId(groupId);
    setNewGroupName("");
  }

  // 新增命令。
  function handleCreateCommand() {
    if (!selectedGroup) return;
    const commandId = createCommand(selectedGroup.id, newCommandName, newCommandValue);
    if (!commandId) return;
    setNewCommandName("");
    setNewCommandValue("");
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

  // 复制命令到当前终端。
  function handleCopyToCurrentTerminal(command: TerminalCommandItem) {
    copyCommandToActiveTerminal(command.command);
    setCommandContextMenu(null);
  }

  // 复制命令到新终端。
  function handleCopyToNewTerminal(command: TerminalCommandItem) {
    copyCommandToNewTerminal(command.command, command.name);
    setCommandContextMenu(null);
  }

  // 执行当前终端输入（当前先写入模拟输出，后续可接后端执行）。
  function runActiveTerminalCommand() {
    if (!activeTab) return;
    const command = activeTab.inputDraft.trim();
    if (!command) return;

    appendTerminalOutput(activeTab.id, {
      kind: "command",
      text: `$ ${command}`
    });
    appendTerminalOutput(activeTab.id, {
      kind: "stdout",
      text: "命令已写入终端队列（当前为 UI 模拟终端，待接入后端执行能力）。"
    });
    setTerminalInputDraft(activeTab.id, "");
  }

  return (
    // Terminal 主体布局：左侧命令库 + 右侧终端工作区。
    <div className="grid h-full w-full grid-cols-[340px_1fr] overflow-hidden">
      {/* 左侧命令库面板。 */}
      <div className="flex min-h-0 flex-col border-r border-base-300 bg-base-100">
        {/* 顶部搜索与新增分组区域。 */}
        <div className="border-b border-base-300 p-3">
          {/* 搜索输入行。 */}
          <label className="input input-bordered input-sm flex w-full items-center gap-2">
            {/* 搜索图标。 */}
            <Search size={14} className="text-neutral/60" />
            {/* 搜索输入框：按命令名/命令文本模糊匹配。 */}
            <input
              type="text"
              className="grow"
              placeholder="搜索命令名或命令"
              value={searchKeyword}
              onChange={(event) => setSearchKeyword(event.target.value)}
            />
          </label>

          {/* 新增分组输入行。 */}
          <div className="mt-2 flex items-center gap-2">
            {/* 分组名称输入框。 */}
            <input
              type="text"
              className="input input-bordered input-sm flex-1"
              placeholder="新增命令组"
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                handleCreateGroup(); // 回车快速创建分组。
              }}
            />
            {/* 创建分组按钮。 */}
            <button className="btn btn-primary btn-sm" onClick={handleCreateGroup}>
              <Plus size={14} />
            </button>
          </div>
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
                                  title="复制到当前终端"
                                  onClick={() => handleCopyToCurrentTerminal(commandItem)}
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

        {/* 新增命令区域。 */}
        <div className="border-t border-base-300 p-3">
          {/* 标题与当前分组。 */}
          <p className="mb-2 text-[12px] text-neutral/70">新增命令 {selectedGroup ? `(${selectedGroup.name})` : ""}</p>
          {/* 命令名称输入框。 */}
          <input
            type="text"
            className="input input-bordered input-sm mb-2 w-full"
            placeholder="命令名称"
            value={newCommandName}
            onChange={(event) => setNewCommandName(event.target.value)}
          />
          {/* 命令正文输入框。 */}
          <textarea
            className="textarea textarea-bordered textarea-sm h-[74px] w-full font-mono"
            placeholder="命令内容，例如 npm run dev"
            value={newCommandValue}
            onChange={(event) => setNewCommandValue(event.target.value)}
          />
          {/* 保存命令按钮。 */}
          <button className="btn btn-primary btn-sm mt-2 w-full" disabled={!selectedGroup} onClick={handleCreateCommand}>
            <Plus size={14} />
            保存到命令组
          </button>
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
              return (
                // 单个终端 Tab。 
                <div key={tab.id} className={`flex items-center border-r border-base-300 ${active ? "bg-base-100" : "bg-base-200/50"}`}>
                  {/* 激活终端按钮。 */}
                  <button
                    className={`min-w-0 px-3 py-2 text-[12px] ${active ? "text-primary" : "text-neutral/70"}`}
                    onClick={() => setActiveTabId(tab.id)}
                    title={tab.name}
                  >
                    {tab.name}
                  </button>
                  {/* 关闭终端按钮。 */}
                  <button className="btn btn-circle btn-ghost btn-xs mr-1" onClick={() => closeTerminalTab(tab.id)}>
                    <X size={12} />
                  </button>
                </div>
              );
            })}
          </div>
          {/* 新建终端按钮。 */}
          <button className="btn btn-ghost btn-sm mx-2" onClick={() => createTerminalTab()} title="新建终端">
            <Plus size={14} />
          </button>
        </div>

        {/* 终端输出面板。 */}
        <div className="min-h-0 flex-1 overflow-auto bg-[#0f1722] p-3 font-mono text-[12px] text-[#d8e2f0]">
          {activeTab?.outputs.map((line) => (
            // 单行终端输出。 
            <div key={line.id} className="mb-1">
              <span
                className={
                  line.kind === "stderr"
                    ? "text-[#ff8d8d]"
                    : line.kind === "command"
                      ? "text-[#97d7ff]"
                      : "text-[#d8e2f0]"
                }
              >
                {line.text}
              </span>
            </div>
          ))}
        </div>

        {/* 底部命令输入区。 */}
        <div className="border-t border-base-300 p-3">
          {/* 输入区标题。 */}
          <div className="mb-1 text-[12px] text-neutral/70">当前终端命令</div>
          {/* 命令输入与执行按钮。 */}
          <div className="flex items-start gap-2">
            {/* 命令输入框。 */}
            <textarea
              className="textarea textarea-bordered h-[86px] flex-1 font-mono"
              placeholder="输入命令，按 Ctrl+Enter 发送"
              value={activeTab?.inputDraft || ""}
              onChange={(event) => {
                if (!activeTab) return;
                setTerminalInputDraft(activeTab.id, event.target.value);
              }}
              onKeyDown={(event) => {
                if (!event.ctrlKey || event.key !== "Enter") return;
                event.preventDefault();
                runActiveTerminalCommand(); // Ctrl+Enter 快捷执行。
              }}
            />
            {/* 执行按钮。 */}
            <button className="btn btn-primary" onClick={runActiveTerminalCommand}>
              <Play size={14} />
              发送
            </button>
          </div>
        </div>
      </div>

      {/* 命令右键菜单。 */}
      {commandContextMenu && (
        <div
          className="fixed z-[110] min-w-[176px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
          style={{ left: commandContextMenu.x, top: commandContextMenu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {/* 菜单项：复制到当前终端。 */}
          <button className="btn btn-ghost btn-xs w-full justify-start" onClick={() => handleCopyToCurrentTerminal(commandContextMenu.command)}>
            <Copy size={12} />
            复制到当前终端
          </button>
          {/* 菜单项：复制到新终端。 */}
          <button className="btn btn-ghost btn-xs w-full justify-start" onClick={() => handleCopyToNewTerminal(commandContextMenu.command)}>
            <Plus size={12} />
            复制到新终端
          </button>
        </div>
      )}
    </div>
  );
}
