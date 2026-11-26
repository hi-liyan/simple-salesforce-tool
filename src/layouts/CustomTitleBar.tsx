import { useEffect, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  Blocks,
  Cpu,
  Database,
  FileText,
  Minus,
  Plus,
  Settings,
  Sparkles,
  Square,
  TerminalSquare,
  Copy
} from "lucide-react";

type CustomTitleBarProps = {
  // 当前 AI 右侧浮岛是否展开。
  aiDockOpen: boolean;
  // 切换 AI 浮岛显隐。
  onToggleAiDock: () => void;
  // 打开新建连接弹窗/设置。
  onNewConnection: () => void;
  // 新建查询控制台 Tab。
  onNewQuery: () => void;
  // 打开驱动管理视图。
  onOpenDriverManager: () => void;
  // 打开插件中心弹窗/面板。
  onOpenPluginCenter: () => void;
  // 快速打开系统终端插件。
  onOpenTerminal: () => void;
  // 打开系统日志/审计视图。
  onOpenSystemLogs: () => void;
  // 打开设置视图。
  onOpenSettings: () => void;
};

// 自绘无边框主窗口标题栏（参考现代数据库 IDE Islands 风格）。
export function CustomTitleBar({
  aiDockOpen,
  onToggleAiDock,
  onNewConnection,
  onNewQuery,
  onOpenDriverManager,
  onOpenPluginCenter,
  onOpenTerminal,
  onOpenSystemLogs,
  onOpenSettings
}: CustomTitleBarProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let active = true;
    const syncMaximized = async () => {
      try {
        const isMax = await getCurrentWindow().isMaximized();
        if (active) setMaximized(isMax);
      } catch {
        // 非 Tauri 环境忽略。
      }
    };
    void syncMaximized();
    return () => {
      active = false;
    };
  }, []);

  const handleMinimize = async () => {
    try {
      await getCurrentWindow().minimize();
    } catch {
      // 忽略非桌面环境调用。
    }
  };

  const handleToggleMaximize = async () => {
    try {
      const win = getCurrentWindow();
      await win.toggleMaximize();
      setMaximized(await win.isMaximized());
    } catch {
      // 忽略非桌面环境调用。
    }
  };

  const handleClose = async () => {
    try {
      await getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  return (
    <header
      data-tauri-drag-region
      onDoubleClick={() => void handleToggleMaximize()}
      className="flex h-[42px] shrink-0 select-none items-center justify-between px-2 text-[12px]"
    >
      {/* 左侧：品牌标识与高频全局入口。 */}
      <div data-tauri-drag-region className="flex items-center gap-1.5">
        <div
          data-tauri-drag-region
          className="mr-1 flex h-7 items-center gap-1.5 rounded-lg bg-primary/10 px-2.5 font-semibold text-primary"
        >
          <Database size={14} />
          <span data-tauri-drag-region className="tracking-tight">
            DataStudio
          </span>
        </div>

        <button
          type="button"
          onClick={onNewConnection}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-neutral/80 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <Plus size={14} />
          <span>新建连接</span>
        </button>

        <button
          type="button"
          onClick={onNewQuery}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-neutral/80 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <TerminalSquare size={14} />
          <span>新建查询</span>
        </button>

        <button
          type="button"
          onClick={onOpenDriverManager}
          className="flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-neutral/80 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <Cpu size={14} />
          <span>驱动管理</span>
        </button>
      </div>

      {/* 右侧：插件入口、AI 开关、日志设置与自绘窗口控制按钮。 */}
      <div className="flex items-center gap-1">
        <button
          type="button"
          title="打开系统终端插件"
          onClick={onOpenTerminal}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <TerminalSquare size={14} />
          <span className="hidden sm:inline">终端</span>
        </button>

        <button
          type="button"
          title="插件中心"
          onClick={onOpenPluginCenter}
          className="flex h-7 items-center gap-1 rounded-lg px-2 text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <Blocks size={14} />
          <span className="hidden sm:inline">插件</span>
        </button>

        <button
          type="button"
          title="切换 AI 助手面板"
          onClick={onToggleAiDock}
          className={`flex h-7 items-center gap-1 rounded-lg px-2 transition-colors ${
            aiDockOpen
              ? "bg-primary/12 font-medium text-primary"
              : "text-neutral/75 hover:bg-base-100 hover:text-neutral"
          }`}
        >
          <Sparkles size={14} />
          <span className="hidden sm:inline">AI 助手</span>
        </button>

        <button
          type="button"
          title="系统日志与审计"
          onClick={onOpenSystemLogs}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <FileText size={14} />
        </button>

        <button
          type="button"
          title="设置"
          onClick={onOpenSettings}
          className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <Settings size={14} />
        </button>

        <div className="mx-1 h-4 w-[1px] bg-base-300" />

        {/* 自绘窗口控制按钮（Windows / Linux）。 */}
        <button
          type="button"
          title="最小化"
          onClick={() => void handleMinimize()}
          className="flex h-7 w-8 items-center justify-center rounded-lg text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          <Minus size={14} />
        </button>
        <button
          type="button"
          title={maximized ? "还原" : "最大化"}
          onClick={() => void handleToggleMaximize()}
          className="flex h-7 w-8 items-center justify-center rounded-lg text-neutral/75 transition-colors hover:bg-base-100 hover:text-neutral"
        >
          {maximized ? <Copy size={12} /> : <Square size={12} />}
        </button>
        <button
          type="button"
          title="关闭"
          onClick={() => void handleClose()}
          className="flex h-7 w-8 items-center justify-center rounded-lg text-neutral/75 transition-colors hover:bg-error/15 hover:text-error"
        >
          <span className="text-[15px] leading-none">×</span>
        </button>
      </div>
    </header>
  );
}
