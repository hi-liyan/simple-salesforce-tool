import { ReactNode } from "react";
import { Box, CssBaseline, ThemeProvider } from "@mui/material";
import { theme } from "../theme";

type MainLayoutProps = {
  leftSidebar: ReactNode;
  rightWorkspace: ReactNode;
};

// 主布局：只负责整体两栏布局与主题外壳。
export function MainLayout({ leftSidebar, rightWorkspace }: MainLayoutProps) {
  return (
    // 主题提供器：提供桌面风格主题。
    <ThemeProvider theme={theme}>
      {/* CSS Reset：统一默认样式。 */}
      <CssBaseline />
      {/* 页面网格布局：左侧对象列表，右侧内容区域。 */}
      <Box sx={{ height: "100vh", width: "100vw", display: "grid", gridTemplateColumns: "320px 1fr", overflow: "hidden" }}>
        {/* 左侧栏容器。 */}
        <Box sx={{ display: "flex", flexDirection: "column", minHeight: 0, borderRight: "1px solid", borderColor: "divider" }}>
          {leftSidebar}
        </Box>
        {/* 右侧工作区容器。 */}
        <Box sx={{ minWidth: 0, minHeight: 0, display: "flex", flexDirection: "column", overflow: "hidden" }}>
          {rightWorkspace}
        </Box>
      </Box>
    </ThemeProvider>
  );
}
