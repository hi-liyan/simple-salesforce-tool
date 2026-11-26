import type { ReactNode } from "react";

type AppShellLayoutProps = {
  // 顶部自绘无边框标题栏。
  titleBar: ReactNode;
  // 中央主内容区（内部可嵌套 SplitPaneLayout 渲染左栏 + 工作区 + 右栏）。
  children: ReactNode;
  // 底部轻量状态栏（可选）。
  statusBar?: ReactNode;
  // 全局浮层插槽（Toast / Modal Portal）。
  overlay?: ReactNode;
};

// 主应用 Islands 浮岛外壳布局：浅灰画布底壳 + 自绘标题栏 + 大圆角呼吸间隙容器。
export function AppShellLayout({ titleBar, children, statusBar, overlay }: AppShellLayoutProps) {
  return (
    <div className="relative flex h-screen w-screen flex-col overflow-hidden bg-[#F2F4F7] text-neutral">
      {/* 顶部自绘标题栏。 */}
      {titleBar}

      {/* 中央浮岛工作区：四周保留 6px 呼吸间隙。 */}
      <main className="min-h-0 flex-1 overflow-hidden px-1.5 pb-1.5">{children}</main>

      {/* 底部状态栏（可选）。 */}
      {statusBar && (
        <footer className="flex h-6 shrink-0 items-center justify-between border-t border-base-300/60 bg-[#EBEEF3] px-3 text-[11px] text-neutral/70">
          {statusBar}
        </footer>
      )}

      {/* 全局浮层插槽。 */}
      {overlay}
    </div>
  );
}
