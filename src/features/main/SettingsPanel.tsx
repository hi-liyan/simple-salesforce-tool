import { RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../../api";
import { CliPathProbe, CliPathSettings, CliPathStatus } from "../../types";

// 设置面板：通过顶部 Tab 切换 CLI 设置与关于页面。
export function SettingsPanel() {
  // 顶部 Tab：用于切换 CLI 设置与关于页面。
  const [activeTab, setActiveTab] = useState<"cli" | "about">("cli");
  // CLI 路径设置：仅包含配置与当前生效路径（不做全量探测）。
  const [settings, setSettings] = useState<CliPathSettings | null>(null);
  // 自定义路径输入：支持手动输入与下拉候选选择。
  const [customPathInput, setCustomPathInput] = useState("");
  // 当前生效路径检测状态：包含可用性、版本和更新信息。
  const [cliStatus, setCliStatus] = useState<CliPathStatus | null>(null);
  // 自动探测出的本地可用路径列表（用于输入框下拉）。
  const [detectedOptions, setDetectedOptions] = useState<CliPathProbe[]>([]);
  // 页面级加载状态：用于保存与读取设置。
  const [loading, setLoading] = useState(false);
  // 路径检测加载状态：用于“检测有效”按钮。
  const [checkingStatus, setCheckingStatus] = useState(false);
  // 本地路径探测加载状态：用于“自动探测本地路径”按钮。
  const [detectingOptions, setDetectingOptions] = useState(false);
  // 错误信息：保存、检测或探测失败时展示。
  const [error, setError] = useState("");
  // 软件版本：通过 Tauri API 获取应用版本号。
  const [appVersion, setAppVersion] = useState("-");

  // 初始化加载：读取设置、读取当前状态与应用版本。
  useEffect(() => {
    void loadSettings();
    void loadCurrentCliStatus(null);
    void loadAppVersion();
  }, []);

  // 拉取当前设置（不自动探测本地路径）。
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

  // 检测指定路径或当前生效路径是否可用，并刷新版本/更新状态。
  async function loadCurrentCliStatus(path: string | null) {
    setCheckingStatus(true);
    setError("");
    try {
      const nextStatus = await api.checkCliPathStatus(path);
      setCliStatus(nextStatus);
    } catch (statusError) {
      setCliStatus(null);
      setError(String(statusError));
    } finally {
      setCheckingStatus(false);
    }
  }

  // 读取应用版本：采用 Tauri 常用方式，通过 `@tauri-apps/api/app` 获取版本号。
  async function loadAppVersion() {
    try {
      const version = await getVersion();
      setAppVersion(version || "-");
    } catch {
      setAppVersion("-");
    }
  }

  // 保存自定义路径（为空时表示清除配置），并刷新当前生效状态。
  async function saveCustomPath() {
    setLoading(true);
    setError("");
    try {
      const normalized = customPathInput.trim(); // 统一去除首尾空白，避免路径误判。
      const next = await api.saveCliPathSettings(normalized ? normalized : null);
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
      await loadCurrentCliStatus(null); // 保存后按“当前生效路径”重新检测。
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setLoading(false);
    }
  }

  // 清除自定义路径配置，并按默认生效路径重新检测状态。
  async function clearCustomPath() {
    setLoading(true);
    setError("");
    try {
      const next = await api.saveCliPathSettings(null);
      setSettings(next);
      setCustomPathInput("");
      await loadCurrentCliStatus(null); // 清除后刷新当前生效状态。
    } catch (clearError) {
      setError(String(clearError));
    } finally {
      setLoading(false);
    }
  }

  // 手动检测输入路径是否有效（不保存配置）。
  async function checkCustomPathNow() {
    const normalized = customPathInput.trim();
    await loadCurrentCliStatus(normalized || null); // 输入为空时回退检测当前生效路径。
  }

  // 自动探测本地可用路径，并写入输入框下拉候选。
  async function detectLocalCliPaths() {
    setDetectingOptions(true);
    setError("");
    try {
      const options = await api.detectLocalCliPaths();
      setDetectedOptions(options);
    } catch (detectError) {
      setDetectedOptions([]);
      setError(String(detectError));
    } finally {
      setDetectingOptions(false);
    }
  }

  return (
    // 面板容器：与主界面滚动和留白风格保持一致。
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部 Tab 栏：两个选项，CLI设置 / 关于。 */}
      <div className="border-b border-base-300 px-4 pt-3">
        <div className="tabs tabs-boxed inline-flex bg-base-200/60">
          {/* CLI 设置 Tab。 */}
          <button
            className={`tab ${activeTab === "cli" ? "tab-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("cli")}
          >
            CLI设置
          </button>
          {/* 关于 Tab。 */}
          <button
            className={`tab ${activeTab === "about" ? "tab-active" : ""}`}
            type="button"
            onClick={() => setActiveTab("about")}
          >
            关于
          </button>
        </div>
      </div>

      {/* 主内容区：按当前 Tab 展示对应内容。 */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {activeTab === "cli" ? (
          <>
            {/* CLI 标题栏：仅保留设置相关动作，不在进入页面时自动探测本地路径。 */}
            <div className="mb-3 flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-2">
              <div>
                {/* 标题元素：说明本区域用途。 */}
                <h2 className="text-[14px] font-semibold">CLI 设置</h2>
                {/* 说明元素：提示当前页面操作方式。 */}
                <p className="text-[12px] text-neutral/70">进入页面不会自动探测本地路径，可手动检测当前路径或主动探测本机可用路径。</p>
              </div>
              {/* 刷新按钮：仅重新读取已保存配置。 */}
              <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => void loadSettings()}>
                <RefreshCw size={14} />
                刷新配置
              </button>
            </div>

            {/* 当前生效信息：展示路径、可用性、版本与更新状态。 */}
            <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
              <p className="text-[12px]">
                当前生效路径：
                <span className="ml-1 font-semibold">{cliStatus?.path || settings?.resolvedCliPath || "-"}</span>
              </p>
              <p className="mt-1 text-[12px]">
                路径状态：
                <span className={`ml-1 font-semibold ${cliStatus?.ok ? "text-success" : "text-error"}`}>
                  {cliStatus ? (cliStatus.ok ? "有效" : "无效") : "未检测"}
                </span>
              </p>
              {cliStatus?.ok && (
                <>
                  <p className="mt-1 text-[12px]">
                    CLI 版本：
                    <span className="ml-1 font-semibold">{cliStatus.version || "-"}</span>
                  </p>
                  <p className="mt-1 text-[12px]">
                    可用更新：
                    <span className="ml-1 font-semibold">
                      {cliStatus.hasUpdate === null ? "未知" : cliStatus.hasUpdate ? "有" : "无"}
                    </span>
                    {cliStatus.hasUpdate && cliStatus.latestVersion && (
                      <span className="ml-1 text-neutral/80">(最新: {cliStatus.latestVersion})</span>
                    )}
                  </p>
                </>
              )}
              {!cliStatus?.ok && cliStatus?.detail && <p className="mt-1 text-[12px] text-error">详情：{cliStatus.detail}</p>}
            </div>

            {/* 自定义路径设置：下拉输入 + 右侧检测按钮 + 自动探测按钮。 */}
            <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
              {/* 标签元素：说明输入框用途。 */}
              <label className="mb-1 block text-[12px] font-semibold">自定义 CLI 路径</label>
              <div className="flex flex-row items-center gap-2">
                {/* 可下拉输入框：使用 datalist 展示探测出的可用路径候选。 */}
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="例如：C:\\Program Files\\sf\\bin\\sf.cmd"
                  value={customPathInput}
                  list="cli-path-options"
                  onChange={(event) => setCustomPathInput(event.target.value)}
                  disabled={loading}
                />
                {/* 检测有效按钮：仅检测输入路径，不会保存配置。 */}
                <button className="btn btn-outline btn-sm" disabled={checkingStatus || loading} onClick={() => void checkCustomPathNow()}>
                  <Search size={14} />
                  检测有效
                </button>
                {/* 自动探测按钮：主动扫描本机可用 CLI 路径并更新下拉候选。 */}
                <button className="btn btn-outline btn-sm" disabled={detectingOptions || loading} onClick={() => void detectLocalCliPaths()}>
                  <RefreshCw size={14} />
                  自动探测本地路径
                </button>
              </div>

              {/* 输入候选下拉：显示探测到的可用 CLI 路径与版本。 */}
              <datalist id="cli-path-options">
                {detectedOptions.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.version || "-"}
                  </option>
                ))}
              </datalist>

              {/* 底部操作：保存或清除自定义路径。 */}
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

            {/* 错误提示。 */}
            {error && (
              <div className="mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
                {error}
              </div>
            )}
          </>
        ) : (
          // 关于页：展示软件版本和版权信息。
          <div className="rounded border border-base-300 bg-base-100 p-4">
            {/* 关于标题。 */}
            <h2 className="text-[14px] font-semibold">关于</h2>
            {/* 版本信息。 */}
            <p className="mt-2 text-[12px]">
              软件版本：
              <span className="ml-1 font-semibold">{appVersion}</span>
            </p>
            {/* 版权信息。 */}
            <p className="mt-1 text-[12px] text-neutral/80">© 2026 李炎</p>
          </div>
        )}
      </div>
    </div>
  );
}
