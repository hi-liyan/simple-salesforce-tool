import { useEffect, useState } from "react";
import { RowContextMenuState } from "../types";

// 行右键菜单 Hook：统一管理菜单显隐与全局关闭逻辑。
export function useDataGridContextMenu() {
  // 行右键菜单状态：记录菜单坐标、目标记录信息与可执行动作能力。
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState | null>(null);

  // 全局关闭行右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!rowContextMenu) return;

    const closeMenu = () => {
      setRowContextMenu(null); // 统一关闭菜单，避免浮层残留。
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
  }, [rowContextMenu]);

  return {
    rowContextMenu,
    setRowContextMenu
  };
}
