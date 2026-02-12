import { RefreshCw, Save, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../api";
import { CliPathSettings } from "../../types";

// 设置面板：配置 Salesforce CLI 路径并展示自动探测结果。
export function SettingsPanel() {
  // 设置详情：包含自定义路径、当前生效路径和探测列表。
  const [settings, setSettings] = useState<CliPathSettings | null>(null);
  // 输入框内容：用于保存自定义 CLI 路径。
  const [customPathInput, setCustomPathInput] = useState("");
  // 加载状态：控制按钮禁用与加载文案。
  const [loading, setLoading] = useState(false);
  // 错误信息：探测或保存失败时展示。
  const [error, setError] = useState("");

  // 初始化加载设置。
  useEffect(() => {
    void loadSettings();
  }, []);

  // 拉取当前设置并刷新探测结果。
  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const next = await api.getCliPathSettings();
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  // 保存自定义路径（为空时表示清除配置）。
  async function saveCustomPath() {
    setLoading(true);
    setError("");
    try {
      const normalized = customPathInput.trim();
      const next = await api.saveCliPathSettings(normalized ? normalized : null);
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setLoading(false);
    }
  }

  // 清除自定义路径配置。
  async function clearCustomPath() {
    setLoading(true);
    setError("");
    try {
      const next = await api.saveCliPathSettings(null);
      setSettings(next);
      setCustomPathInput("");
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setLoading(false);
    }
  }

  return (
    // 面板容器：与主界面滚动和留白风格保持一致。
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 标题栏：提供手动探测入口。 */}
      <div className="flex items-center justify-between border-b border-base-300 px-4 py-3">
        <div>
          <h2 className="text-[14px] font-semibold">CLI 设置</h2>
          <p className="text-[12px] text-neutral/70">支持自动检测 Salesforce CLI 路径与版本，也可自定义覆盖。</p>
        </div>
        <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => void loadSettings()}>
          <RefreshCw size={14} />
          自动检测
        </button>
      </div>

      {/* 主内容区：包含当前生效信息、自定义路径和探测详情。 */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {/* 当前生效信息。 */}
        <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
          <p className="text-[12px]">
            当前生效路径：
            <span className="ml-1 font-semibold">{settings?.resolvedCliPath || "-"}</span>
          </p>
          <p className="mt-1 text-[12px]">
            当前版本：
            <span className="ml-1 font-semibold">{settings?.resolvedCliVersion || "-"}</span>
          </p>
        </div>

        {/* 自定义路径设置。 */}
        <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
          <label className="mb-1 block text-[12px] font-semibold">自定义 CLI 路径</label>
          <input
            className="input input-bordered input-sm w-full"
            placeholder="例如：C:\\Program Files\\sf\\bin\\sf.cmd"
            value={customPathInput}
            onChange={(event) => setCustomPathInput(event.target.value)}
            disabled={loading}
          />
          <div className="mt-2 flex flex-row gap-2">
            <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => void saveCustomPath()}>
              <Save size={14} />
              保存
            </button>
            <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => void clearCustomPath()}>
              <Trash2 size={14} />
              清除自定义
            </button>
          </div>
        </div>

        {/* 探测结果列表。 */}
        <div className="rounded border border-base-300 bg-base-100 p-3">
          <p className="mb-2 text-[12px] font-semibold">探测详情</p>
          {!settings?.probes?.length && <p className="text-[12px] text-neutral/70">暂无探测结果。</p>}
          {settings?.probes?.map((probe) => (
            <div key={probe.path} className="mb-2 rounded border border-base-300 p-2">
              <p className="break-all text-[12px] font-semibold">{probe.path}</p>
              <p className={`mt-1 text-[12px] ${probe.ok ? "text-success" : "text-error"}`}>
                {probe.ok ? "可用" : "不可用"}
              </p>
              <p className="mt-1 break-all text-[12px] text-neutral/70">版本：{probe.version || "-"}</p>
              <p className="mt-1 break-all text-[12px] text-neutral/70">详情：{probe.detail}</p>
            </div>
          ))}
        </div>

        {/* 错误提示。 */}
        {error && (
          <div className="mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
