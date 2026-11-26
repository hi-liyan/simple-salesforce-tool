import type { PluginComponentProps } from "../../core/types.ts";
import { SavedCommandsPanel } from "../../../features/terminal/SavedCommandsPanel.tsx";

// 命令库插件：复用 SavedCommandsPanel，并通过 PluginContext 事件总线将命令发送至底部终端抽屉。
export function CommandLibraryPlugin({ ctx }: PluginComponentProps) {
  return (
    <SavedCommandsPanel
      onFillCommand={(commandText) => {
        ctx.events.emit("terminal:fill-command", { command: commandText });
        ctx.ui.notify("已填入底部终端", "success");
      }}
      onRunCommand={(commandText) => {
        ctx.events.emit("terminal:run-command", { command: commandText });
        ctx.ui.notify("已发送至底部终端执行", "success");
      }}
    />
  );
}
