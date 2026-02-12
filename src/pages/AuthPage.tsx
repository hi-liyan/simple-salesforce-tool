import { useState } from "react";
import { Box, Button, CssBaseline, Stack, TextField, ThemeProvider, Typography } from "@mui/material";
import { api } from "../api";
import { theme } from "../theme";

// 登录窗口页面：处理 Salesforce CLI 授权登录。
export function AuthPage() {
  // Instance URL 输入值。
  const [instanceUrl, setInstanceUrl] = useState<string>("https://login.salesforce.com");
  // 错误提示信息。
  const [error, setError] = useState<string>("");
  // 登录中状态。
  const [busy, setBusy] = useState<boolean>(false);

  async function loginWithCli() {
    const normalized = normalizeInstanceUrl(instanceUrl);
    if (!normalized) {
      setError("请输入 Instance URL。");
      return;
    }

    setBusy(true);
    setError("");
    try {
      await api.loginCliOrg(normalized);
    } catch (loginError) {
      setError(`登录失败：${String(loginError)}`);
    } finally {
      setBusy(false);
    }
  }

  return (
    // 主题提供器：复用桌面应用主主题。
    <ThemeProvider theme={theme}>
      {/* CSS Reset：统一基础样式。 */}
      <CssBaseline />
      {/* 页面容器：登录页布局外框。 */}
      <Box sx={{ minHeight: "100vh", bgcolor: "background.default", p: 3 }}>
        {/* 内容列：标题、说明、输入与按钮。 */}
        <Stack spacing={2}>
          {/* 页面标题。 */}
          <Typography variant="h6">连接 Salesforce</Typography>
          {/* 页面说明文字。 */}
          <Typography variant="body2" color="text.secondary">
            请输入 Instance URL，点击登录后将在浏览器完成 OAuth 授权。
          </Typography>
          {/* 输入框：Instance URL。 */}
          <TextField
            autoFocus
            label="Instance URL"
            value={instanceUrl}
            onChange={(event) => setInstanceUrl(event.target.value)}
            error={Boolean(error)}
            helperText={error || "示例：https://login.salesforce.com 或 https://test.salesforce.com"}
            fullWidth
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loginWithCli();
              }
            }}
          />
          {/* 操作按钮行。 */}
          <Stack direction="row" spacing={1} justifyContent="flex-end">
            {/* 取消按钮：关闭登录窗口。 */}
            <Button variant="outlined" onClick={() => void api.closeAuthWindow()} disabled={busy}>
              取消
            </Button>
            {/* 登录按钮：触发 CLI 登录。 */}
            <Button onClick={() => void loginWithCli()} disabled={busy}>
              {busy ? "登录中..." : "登录"}
            </Button>
          </Stack>
        </Stack>
      </Box>
    </ThemeProvider>
  );
}

// 规范化 Instance URL。
function normalizeInstanceUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
