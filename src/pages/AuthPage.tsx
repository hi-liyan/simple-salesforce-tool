import { useState } from "react";
import { api } from "../api";

// 登录窗口页面：处理 Salesforce CLI 授权登录。
export function AuthPage() {
  // Instance URL 输入值。
  const [instanceUrl, setInstanceUrl] = useState<string>("https://login.salesforce.com");
  // 错误提示信息。
  const [error, setError] = useState<string>("");
  // 登录中状态。
  const [busy, setBusy] = useState<boolean>(false);

  // 执行 CLI 登录：先校验 URL，再调用后端命令。
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
    // 登录页外层容器：保持原布局结构与间距。
    <div className="min-h-screen bg-base-200 p-3">
      {/* 内容列：标题、说明、输入与按钮。 */}
      <div className="flex flex-col gap-2">
        {/* 页面标题。 */}
        <h1 className="text-[20px] font-semibold">连接 Salesforce</h1>
        {/* 页面说明。 */}
        <p className="text-[12px] text-neutral/70">请输入 Instance URL，点击登录后将在浏览器完成 OAuth 授权。</p>

        {/* 输入区域：保持 Enter 提交逻辑。 */}
        <div className="w-full">
          <label className="mb-1 block text-[12px]">Instance URL</label>
          <input
            autoFocus
            className={`input input-bordered input-sm w-full ${error ? "input-error" : ""}`}
            value={instanceUrl}
            onChange={(event) => setInstanceUrl(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                void loginWithCli();
              }
            }}
          />
          <p className={`mt-1 text-[11px] ${error ? "text-error" : "text-neutral/70"}`}>
            {error || "示例：https://login.salesforce.com 或 https://test.salesforce.com"}
          </p>
        </div>

        {/* 底部操作栏：按钮顺序和逻辑不变。 */}
        <div className="flex flex-row justify-end gap-2">
          <button className="btn btn-outline btn-sm" onClick={() => void api.closeAuthWindow()} disabled={busy}>
            取消
          </button>
          <button className="btn btn-primary btn-sm" onClick={() => void loginWithCli()} disabled={busy}>
            {busy ? "登录中..." : "登录"}
          </button>
        </div>
      </div>
    </div>
  );
}

// 规范化 Instance URL。
function normalizeInstanceUrl(raw: string) {
  const trimmed = raw.trim();
  if (!trimmed) return "";
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return `https://${trimmed}`;
}
