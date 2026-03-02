import { useEffect, useRef, useState } from "react";
import { HoveredHeaderMetaState } from "../types";

// 表头元数据浮层 Hook：统一管理 hover 状态与延迟关闭计时器。
export function useHeaderMetaPopover() {
  const closeMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 表头元数据提示：鼠标经过 info icon 时展示。
  const [hoveredHeaderMeta, setHoveredHeaderMeta] = useState<HoveredHeaderMetaState | null>(null);
  // 鼠标是否位于元数据浮层内：用于支持从表头移动到浮层并滚动。
  const [metaPanelHovering, setMetaPanelHovering] = useState(false);

  useEffect(() => {
    return () => {
      if (!closeMetaTimerRef.current) return;
      clearTimeout(closeMetaTimerRef.current);
      closeMetaTimerRef.current = null;
    };
  }, []);

  const cancelMetaClose = () => {
    if (!closeMetaTimerRef.current) return;
    clearTimeout(closeMetaTimerRef.current);
    closeMetaTimerRef.current = null;
  };

  const scheduleMetaClose = () => {
    cancelMetaClose();
    closeMetaTimerRef.current = setTimeout(() => {
      setHoveredHeaderMeta(null);
    }, 180);
  };

  return {
    hoveredHeaderMeta,
    setHoveredHeaderMeta,
    metaPanelHovering,
    setMetaPanelHovering,
    cancelMetaClose,
    scheduleMetaClose
  };
}
