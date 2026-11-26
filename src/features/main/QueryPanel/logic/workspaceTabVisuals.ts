import type { CSSProperties } from "react";
import { buildSourceSurfacePalette } from "./sourceColor.ts";

type WorkspaceTabSurfaceStyles = {
  // 普通态表面样式：用于轻量体现来源色。
  surfaceStyle?: CSSProperties;
  // 激活态表面样式：用于提升当前工作区 Tab 的可见性（保留项目来源色/主题色，适配圆角胶囊样式）。
  activeSurfaceStyle?: CSSProperties;
};

// 构建工作区 Tab 的普通态与激活态表面样式。
export function buildWorkspaceTabSurfaceStyles(sourceColor: string): WorkspaceTabSurfaceStyles {
  const palette = buildSourceSurfacePalette(sourceColor || "");

  // 未配置来源色时交由 ReusableTabs 默认激活胶囊样式（项目主色 primary）统一渲染。
  if (!palette) {
    return {};
  }

  return {
    surfaceStyle: {
      backgroundColor: palette.backgroundColor,
      borderColor: "transparent"
    },
    activeSurfaceStyle: {
      backgroundColor: palette.activeBackgroundColor,
      borderColor: palette.borderColor
    }
  };
}
