import { ReactNode } from "react";

type MainLayoutProps = {
  navRail: ReactNode;
  content: ReactNode;
};

// 主布局：负责左侧导航与右侧内容区的两栏结构。
export function MainLayout({ navRail, content }: MainLayoutProps) {
  return (
    // 页面网格：固定导航宽度 + 自适应内容区。
    <div className="grid h-screen w-screen grid-cols-[56px_1fr] overflow-hidden bg-base-200 text-neutral">
      {/* 左侧导航栏容器。 */}
      <div className="flex min-h-0 flex-col border-r border-base-300">{navRail}</div>
      {/* 右侧主内容容器。 */}
      <div className="flex min-h-0 min-w-0 flex-col overflow-hidden">{content}</div>
    </div>
  );
}
