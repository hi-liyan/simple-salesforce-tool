import { createTheme } from "@mui/material";

// 全局 MUI 主题：保持桌面工具风格。
export const theme = createTheme({
  palette: {
    mode: "light",
    primary: { main: "#0176d3" },
    background: { default: "#f6f9fe", paper: "#ffffff" },
    divider: "#d8e5f5"
  },
  shape: { borderRadius: 0 },
  typography: {
    fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
    fontSize: 12
  },
  components: {
    MuiButton: { defaultProps: { size: "small", variant: "contained" } },
    MuiIconButton: { defaultProps: { size: "small" } },
    MuiTextField: { defaultProps: { size: "small" } },
    MuiSelect: { defaultProps: { size: "small" } }
  }
});
