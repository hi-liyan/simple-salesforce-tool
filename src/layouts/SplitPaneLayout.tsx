import { useEffect, useRef, useState, type ReactNode } from "react";

type SplitPaneLayoutProps = {
  // 左侧（或上方）面板内容。
  primary: ReactNode;
  // 右侧（或下方）面板内容。
  secondary: ReactNode;
  // 当前主面板尺寸（像素）。
  size: number;
  // 最小尺寸（像素）。
  minSize?: number;
  // 最大尺寸（像素）。
  maxSize?: number;
  // 拖拽结束时提交最终尺寸（仅在 onPointerUp 触发持久化）。
  onCommitSize: (size: number) => void;
  // 是否折叠主面板。
  collapsed?: boolean;
  // 布局方向：水平左右分栏或垂直上下分栏。
  direction?: "horizontal" | "vertical";
  // 额外容器类名。
  className?: string;
};

// 统一可拖拽分栏布局：拖拽期间仅更新本地草稿宽度，松手时一次性提交持久化。
export function SplitPaneLayout({
  primary,
  secondary,
  size,
  minSize = 220,
  maxSize = 680,
  onCommitSize,
  collapsed = false,
  direction = "horizontal",
  className = ""
}: SplitPaneLayoutProps) {
  // 拖拽中的瞬态尺寸草稿：不触发全局持久化。
  const [draftSize, setDraftSize] = useState(size);
  // 是否处于拖拽中。
  const [dragging, setDragging] = useState(false);
  // 拖拽起点坐标。
  const startAxisRef = useRef(0);
  // 拖拽起始尺寸。
  const startSizeRef = useRef(size);
  // 最新草稿尺寸引用：供 pointerup 读取。
  const draftSizeRef = useRef(size);

  useEffect(() => {
    if (dragging) return;
    setDraftSize(size);
    draftSizeRef.current = size;
  }, [dragging, size]);

  useEffect(() => {
    if (!dragging) return;
    const prevUserSelect = document.body.style.userSelect;
    const prevCursor = document.body.style.cursor;
    document.body.style.userSelect = "none";
    document.body.style.cursor = direction === "horizontal" ? "col-resize" : "row-resize";

    const handlePointerMove = (event: PointerEvent) => {
      const currentAxis = direction === "horizontal" ? event.clientX : event.clientY;
      const delta = currentAxis - startAxisRef.current;
      const clamped = Math.max(minSize, Math.min(maxSize, Math.round(startSizeRef.current + delta)));
      draftSizeRef.current = clamped;
      setDraftSize(clamped);
    };

    const handlePointerUp = () => {
      setDragging(false);
      // 行内注释：仅在 pointerup 时提交最终尺寸，避免拖拽帧高频写盘。
      onCommitSize(draftSizeRef.current);
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerUp);
    return () => {
      document.body.style.userSelect = prevUserSelect;
      document.body.style.cursor = prevCursor;
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerUp);
    };
  }, [direction, dragging, maxSize, minSize, onCommitSize]);

  const isHorizontal = direction === "horizontal";

  return (
    <div className={`flex h-full min-h-0 w-full min-w-0 ${isHorizontal ? "flex-row" : "flex-col"} ${className}`}>
      {!collapsed && (
        <>
          {/* 主面板容器。 */}
          <div
            className="min-h-0 min-w-0 shrink-0 overflow-hidden"
            style={isHorizontal ? { width: draftSize } : { height: draftSize }}
          >
            {primary}
          </div>
          {/* 分栏拖拽手柄：利用 6px-8px 呼吸间隙作为隐形热区，悬停时高亮提示。 */}
          <div
            role="separator"
            aria-orientation={direction}
            onPointerDown={(event) => {
              event.preventDefault();
              startAxisRef.current = isHorizontal ? event.clientX : event.clientY;
              startSizeRef.current = draftSize;
              setDragging(true);
            }}
            className={`group relative shrink-0 select-none ${
              isHorizontal ? "w-2 cursor-col-resize" : "h-2 cursor-row-resize"
            }`}
          >
            <div
              className={`absolute rounded-full transition-colors ${
                dragging ? "bg-primary/60" : "bg-transparent group-hover:bg-primary/35"
              } ${isHorizontal ? "inset-y-3 left-[3px] w-[2px]" : "inset-x-3 top-[3px] h-[2px]"}`}
            />
          </div>
        </>
      )}
      {/* 次面板自适应容器。 */}
      <div className="min-h-0 min-w-0 flex-1 overflow-hidden">{secondary}</div>
    </div>
  );
}
