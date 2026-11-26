import { useEffect, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { X } from "lucide-react";

type SubWindowLayoutProps = {
  // 独立小窗标题。
  title: string;
  // 可选副标题或状态标签。
  subtitle?: string;
  // 关闭窗口回调（未传时默认调用当前 Tauri 窗口 close）。
  onClose?: () => void;
  // 窗口主体内容。
  children: ReactNode;
};

// 独立子窗口统一布局：无原生边框 + 自绘标题栏 + 大圆角浮岛卡片容器。
export function SubWindowLayout({ title, subtitle, onClose, children }: SubWindowLayoutProps) {
  const handleClose = () => {
    if (onClose) {
      onClose();
      return;
    }
    try {
      void getCurrentWindow().close();
    } catch {
      window.close();
    }
  };

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        handleClose();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return (
    <div className="flex h-screen w-screen flex-col overflow-hidden bg-[#F2F4F7] p-1.5 text-neutral">
      {/* 自绘子窗口标题栏：支持拖拽与一键关闭。 */}
      <header
        data-tauri-drag-region
        className="mb-1.5 flex h-9 shrink-0 select-none items-center justify-between rounded-xl border border-base-300/80 bg-base-100 px-3"
      >
        <div data-tauri-drag-region className="flex min-w-0 items-center gap-2">
          <span data-tauri-drag-region className="truncate text-[13px] font-semibold">
            {title}
          </span>
          {subtitle && (
            <span data-tauri-drag-region className="truncate text-[11px] text-neutral/60">
              {subtitle}
            </span>
          )}
        </div>
        <button
          type="button"
          title="关闭窗口 (Esc)"
          onClick={handleClose}
          className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 transition-colors hover:bg-error/10 hover:text-error"
        >
          <X size={14} />
        </button>
      </header>

      {/* 大圆角内容浮岛。 */}
      <main className="min-h-0 flex-1 overflow-auto rounded-xl border border-base-300/80 bg-base-100 p-3 shadow-sm">
        {children}
      </main>
    </div>
  );
}
