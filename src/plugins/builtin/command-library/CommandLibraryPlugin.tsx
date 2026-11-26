import { useEffect, useState } from "react";
import { Play, RefreshCw, Terminal } from "lucide-react";
import type { PluginComponentProps } from "../../core/types.ts";
import type { TerminalCommandGroup } from "../../../types/index.ts";

// 命令库插件：通过 PluginContext 调用后端命令组接口，并通过事件总线将命令发送至终端插件。
export function CommandLibraryPlugin({ ctx }: PluginComponentProps) {
  const [groups, setGroups] = useState<TerminalCommandGroup[]>([]);
  const [loading, setLoading] = useState(false);

  const loadGroups = async () => {
    setLoading(true);
    try {
      const list = await ctx.ipc.invoke<TerminalCommandGroup[]>("list_terminal_command_groups");
      setGroups(list);
    } catch (error) {
      ctx.ui.notify(`加载命令库失败：${String(error)}`, "error");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadGroups();
  }, []);

  const handleRunCommand = (commandText: string) => {
    ctx.events.emit("terminal:run-command", { command: commandText });
    ctx.ui.openPlugin("builtin.terminal-workspace");
    ctx.ui.notify("已发送命令到系统终端", "success");
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-base-100 p-3 text-[12px]">
      <div className="mb-2.5 flex items-center justify-between">
        <div className="flex items-center gap-1.5 font-semibold text-neutral">
          <Terminal size={14} className="text-primary" />
          <span>命令库</span>
        </div>
        <button
          type="button"
          onClick={() => void loadGroups()}
          disabled={loading}
          className="flex h-6 items-center gap-1 rounded-md px-2 text-[11px] text-neutral/70 hover:bg-base-200"
        >
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} />
          <span>刷新</span>
        </button>
      </div>

      <div className="min-h-0 flex-1 space-y-2.5 overflow-auto pr-1">
        {groups.length === 0 ? (
          <div className="rounded-lg border border-dashed border-base-300 p-4 text-center text-neutral/60">
            {loading ? "正在加载命令组..." : "暂无预设命令组，可在系统终端中创建。"}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.id} className="rounded-lg border border-base-300/80 bg-base-200/35 p-2">
              <div className="mb-1.5 text-[11px] font-semibold text-neutral/70">{group.name}</div>
              <div className="space-y-1">
                {group.commands.map((cmd) => (
                  <div
                    key={cmd.id}
                    className="flex items-center justify-between gap-2 rounded-md bg-base-100 px-2 py-1.5 shadow-2xs"
                  >
                    <div className="min-w-0 flex-1">
                      <div className="truncate font-medium text-neutral">{cmd.name}</div>
                      <div className="truncate font-mono text-[11px] text-neutral/60">{cmd.command}</div>
                    </div>
                    <button
                      type="button"
                      title="发送到终端执行"
                      onClick={() => handleRunCommand(cmd.command)}
                      className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-primary hover:bg-primary/10"
                    >
                      <Play size={12} />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
