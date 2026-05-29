import type { CSSProperties } from "react";
import { buildSourceSurfacePalette } from "./sourceColor.ts";

type WorkspaceTabSurfaceStyles = {
  // 普通态表面样式：用于轻量体现来源色。
  surfaceStyle?: CSSProperties;
  // 激活态表面样式：用于提升当前工作区 Tab 的可见性。
  activeSurfaceStyle: CSSProperties;
};

const DEFAULT_ACTIVE_ACCENT_COLOR = "#2563EB";

// 构建工作区 Tab 的普通态与激活态表面样式。
export function buildWorkspaceTabSurfaceStyles(sourceColor: string): WorkspaceTabSurfaceStyles {
  const palette = buildSourceSurfacePalette(sourceColor || "");
  const accentColor = palette ? String(sourceColor || "").trim() : DEFAULT_ACTIVE_ACCENT_COLOR;

  if (!palette) {
    return {
      activeSurfaceStyle: {
        backgroundColor: "#FFFFFF",
        borderColor: "#D7DEE7",
        boxShadow: `inset 0 -2px 0 ${accentColor}`
      }
    };
  }

  return {
    surfaceStyle: {
      backgroundColor: palette.backgroundColor,
      borderColor: palette.borderColor
    },
    activeSurfaceStyle: {
      backgroundColor: palette.activeBackgroundColor,
      borderColor: palette.borderColor,
      boxShadow: `inset 0 -2px 0 ${accentColor}`
    }
  };
}
