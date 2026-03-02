import { Cog, ExternalLink, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../../api";
import { CliPathProbe, CliPathSettings, CliPathStatus, LlmSettings, SalesforceSource } from "../../types";
import { SystemLogsPanel } from "./SystemLogsPanel";

// 设置面板：通过顶部 Tab 切换 CLI 设置、LLM 设置、数据源信息、系统日志和关于与反馈页面。
export function SettingsPanel() {
  // 反馈入口 URL：统一集中管理，便于后续替换反馈地址。
  const feedbackIssueUrl = "https://github.com/hi-liyan/simple-salesforce-tool/issues/new";
  // 顶部 Tab 状态：控制当前展示的设置分区。
  const [activeTab, setActiveTab] = useState<"cli" | "llm" | "sources" | "systemLogs" | "about">("cli");
  // CLI 路径设置：包含自定义路径、生效路径和探测信息。
  const [settings, setSettings] = useState<CliPathSettings | null>(null);
  // CLI 自定义路径输入值：支持手动输入和候选回填。
  const [customPathInput, setCustomPathInput] = useState("");
  // CLI 当前状态：包含可用性、版本和更新信息。
  const [cliStatus, setCliStatus] = useState<CliPathStatus | null>(null);
  // 本机探测出的 CLI 候选路径列表。
  const [detectedOptions, setDetectedOptions] = useState<CliPathProbe[]>([]);
  // CLI 设置加载状态：用于禁用保存/刷新按钮。
  const [loading, setLoading] = useState(false);
  // CLI 状态检测加载状态：用于“检测有效”按钮。
  const [checkingStatus, setCheckingStatus] = useState(false);
  // 本地 CLI 路径探测加载状态：用于“自动探测本地路径”按钮。
  const [detectingOptions, setDetectingOptions] = useState(false);
  // LLM 设置快照：用于展示当前配置。
  const [llmSettings, setLlmSettings] = useState<LlmSettings | null>(null);
  // LLM baseUrl 输入值。
  const [llmBaseUrlInput, setLlmBaseUrlInput] = useState("");
  // LLM model 输入值。
  const [llmModelInput, setLlmModelInput] = useState("");
  // LLM apiKey 覆盖输入值（为空表示不覆盖）。
  const [llmApiKeyInput, setLlmApiKeyInput] = useState("");
  // LLM 保存加载状态：用于禁用保存按钮。
  const [llmSaving, setLlmSaving] = useState(false);
  // 通用错误信息：保存/加载/探测失败时展示。
  const [error, setError] = useState("");
  // 应用版本号：通过 Tauri API 获取。
  const [appVersion, setAppVersion] = useState("-");
  // 数据源列表：用于“数据源”Tab 展示完整信息（含 token）。
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  // 数据源加载状态：用于刷新按钮与加载提示。
  const [sourcesLoading, setSourcesLoading] = useState(false);
  // MySQL 编辑弹窗开关：仅用于设置页编辑现有 MySQL 数据源。
  const [showMySqlEditModal, setShowMySqlEditModal] = useState(false);
  // 当前正在编辑的 MySQL 数据源。
  const [editingMySqlSource, setEditingMySqlSource] = useState<SalesforceSource | null>(null);
  // MySQL 编辑表单状态。
  const [mySqlEditForm, setMySqlEditForm] = useState({
    name: "",
    host: "",
    port: 3306,
    database: "",
    username: "",
    password: "",
    primaryKey: ""
  });
  // MySQL 编辑弹窗提示文本（测试连接结果/保存失败等）。
  const [mySqlEditMessage, setMySqlEditMessage] = useState("");
  // MySQL 编辑提交中状态。
  const [mySqlEditSubmitting, setMySqlEditSubmitting] = useState(false);
  // MySQL 测试连接中状态。
  const [mySqlEditTesting, setMySqlEditTesting] = useState(false);
  // 反馈提交中状态：用于避免重复点击并反馈按钮处理中。
  const [feedbackSubmitting, setFeedbackSubmitting] = useState(false);

  // 记录各 Tab 是否已完成首次数据加载，避免切换 Tab 时重复请求。
  const loadedTabs = useRef<Record<string, boolean>>({});

  // 初始化加载：仅加载轻量级全局数据（CLI 配置 + 版本号），不阻塞 UI。
  useEffect(() => {
    void loadSettings(); // 加载 CLI 配置（轻量读取）。
    void loadAppVersion(); // 加载应用版本号（本地 API，极快）。
  }, []);

  // 按需懒加载：仅在首次切换到目标 Tab 时加载对应数据。
  useEffect(() => {
    if (activeTab === "cli" && !loadedTabs.current.cli) {
      loadedTabs.current.cli = true;
      void loadCurrentCliStatus(null);
    } else if (activeTab === "llm" && !loadedTabs.current.llm) {
      loadedTabs.current.llm = true;
      void loadLlmSettings();
    } else if (activeTab === "sources" && !loadedTabs.current.sources) {
      loadedTabs.current.sources = true;
      void loadSources();
    }
  }, [activeTab]);

  // 加载数据源列表：用于数据源 Tab 展示。
  async function loadSources() {
    setSourcesLoading(true);
    setError("");
    try {
      const list = await api.listSources(); // 调用后端列出全部数据源。
      setSources(list);
    } catch (loadError) {
      setSources([]); // 失败时清空旧列表，避免展示脏数据。
      setError(String(loadError));
    } finally {
      setSourcesLoading(false);
    }
  }

  // 将数据源类型归一化为徽标文本。
  function getSourceTypeBadge(sourceType: string | undefined): string {
    const normalizedType = (sourceType || "salesforce").toLowerCase();
    if (normalizedType === "mysql") {
      return "MySQL";
    }
    return "SF";
  }

  // 生成数据源徽标样式：不同类型使用不同强调色。
  function getSourceBadgeClassName(sourceType: string | undefined): string {
    const normalizedType = (sourceType || "salesforce").toLowerCase();
    if (normalizedType === "mysql") {
      return "border border-amber-300 bg-amber-100 text-amber-700";
    }
    return "border border-sky-300 bg-sky-100 text-sky-700";
  }

  // 打开 MySQL 编辑弹窗：从 source.configJson 回填表单。
  function openMySqlEditModal(source: SalesforceSource) {
    const rawConfig = (source.configJson || {}) as Record<string, unknown>;
    const host = String(rawConfig.host || "");
    const port = Number(rawConfig.port || 3306);
    const database = String(rawConfig.database || "");
    const username = String(rawConfig.username || "");
    const password = String(rawConfig.password || "");
    const primaryKey = String(rawConfig.primaryKey || "");
    setEditingMySqlSource(source);
    setMySqlEditForm({
      name: source.name || "",
      host,
      port: Number.isFinite(port) && port > 0 ? port : 3306,
      database,
      username,
      password,
      primaryKey
    });
    setMySqlEditMessage("");
    setShowMySqlEditModal(true);
  }

  // 关闭 MySQL 编辑弹窗并清理状态。
  function closeMySqlEditModal() {
    setShowMySqlEditModal(false);
    setEditingMySqlSource(null);
    setMySqlEditMessage("");
  }

  // 构建 MySQL 更新 payload：用于测试连接与保存。
  function buildMySqlPayloadFromEditForm() {
    const primaryKey = mySqlEditForm.primaryKey.trim();
    const normalizedPort = Number(mySqlEditForm.port) || 3306;
    return {
      name: mySqlEditForm.name.trim(),
      sourceType: "mysql",
      configJson: {
        host: mySqlEditForm.host.trim(),
        port: normalizedPort,
        database: mySqlEditForm.database.trim(),
        username: mySqlEditForm.username.trim(),
        password: mySqlEditForm.password,
        ...(primaryKey ? { primaryKey } : {})
      },
      instanceUrl: `mysql://${mySqlEditForm.host.trim()}:${normalizedPort}/${mySqlEditForm.database.trim()}`,
      accessToken: "",
      apiVersion: "mysql"
    };
  }

  // 测试当前 MySQL 编辑表单连接。
  async function testMySqlEditConnection() {
    setMySqlEditMessage("");
    setMySqlEditTesting(true);
    try {
      await api.testSourceConnection(buildMySqlPayloadFromEditForm());
      setMySqlEditMessage("MySQL 连接测试成功。");
    } catch (testError) {
      setMySqlEditMessage(`MySQL 连接测试失败：${String(testError)}`);
    } finally {
      setMySqlEditTesting(false);
    }
  }

  // 保存 MySQL 数据源编辑结果。
  async function saveMySqlEditSource() {
    if (!editingMySqlSource) return;
    setMySqlEditMessage("");
    setMySqlEditSubmitting(true);
    try {
      await api.updateSource(editingMySqlSource.id, buildMySqlPayloadFromEditForm());
      await loadSources(); // 保存后立即刷新设置页列表，保持展示一致。
      closeMySqlEditModal();
    } catch (saveError) {
      setMySqlEditMessage(`更新 MySQL 数据源失败：${String(saveError)}`);
    } finally {
      setMySqlEditSubmitting(false);
    }
  }

  // 加载 CLI 配置：仅读取配置与生效路径，不触发本地全量探测。
  async function loadSettings() {
    setLoading(true);
    setError("");
    try {
      const next = await api.getCliPathSettings();
      setSettings(next);
      setCustomPathInput(next.customCliPath || ""); // 回填输入框。
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setLoading(false);
    }
  }

  // 加载 LLM 配置：读取并回填可编辑字段。
  async function loadLlmSettings() {
    setError("");
    try {
      const next = await api.getLlmSettings();
      setLlmSettings(next);
      setLlmBaseUrlInput(next.baseUrl || "");
      setLlmModelInput(next.model || "");
      setLlmApiKeyInput(""); // 每次重载都清空覆盖输入，防止误覆盖。
    } catch (loadError) {
      setError(String(loadError));
    }
  }

  // 保存 LLM 配置：apiKey 为空时不覆盖，非空时执行覆盖保存。
  async function saveLlmSettings() {
    setLlmSaving(true);
    setError("");
    try {
      const next = await api.saveLlmSettings({
        baseUrl: llmBaseUrlInput.trim(),
        model: llmModelInput.trim(),
        apiKey: llmApiKeyInput.trim() || undefined
      });
      setLlmSettings(next);
      setLlmApiKeyInput(""); // 保存成功后清空覆盖输入。
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setLlmSaving(false);
    }
  }

  // 加载 CLI 状态：检测指定路径或当前生效路径可用性。
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

  // 加载应用版本号：失败时回退为“-”。
  async function loadAppVersion() {
    try {
      const version = await getVersion();
      setAppVersion(version || "-");
    } catch {
      setAppVersion("-");
    }
  }

  // 保存自定义 CLI 路径：输入为空时清空配置。
  async function saveCustomPath() {
    setLoading(true);
    setError("");
    try {
      const normalized = customPathInput.trim();
      const next = await api.saveCliPathSettings(normalized ? normalized : null);
      setSettings(next);
      setCustomPathInput(next.customCliPath || "");
      await loadCurrentCliStatus(null); // 保存后按生效路径重新检测状态。
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setLoading(false);
    }
  }

  // 清空自定义 CLI 路径：恢复自动生效策略。
  async function clearCustomPath() {
    setLoading(true);
    setError("");
    try {
      const next = await api.saveCliPathSettings(null);
      setSettings(next);
      setCustomPathInput("");
      await loadCurrentCliStatus(null); // 清空后刷新状态。
    } catch (clearError) {
      setError(String(clearError));
    } finally {
      setLoading(false);
    }
  }

  // 立即检测输入路径可用性：不保存配置。
  async function checkCustomPathNow() {
    const normalized = customPathInput.trim();
    await loadCurrentCliStatus(normalized || null);
  }

  // 自动探测本地 CLI 路径：写入下拉候选。
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

  // 提交反馈：通过后端命令调用系统默认浏览器打开 Issues 页面。
  async function submitFeedback() {
    setFeedbackSubmitting(true);
    setError("");
    try {
      await api.openExternalUrl(feedbackIssueUrl); // 统一走后端命令，避免前端直接 window.open。
    } catch (submitError) {
      setError(`打开反馈页面失败：${String(submitError)}`);
    } finally {
      setFeedbackSubmitting(false);
    }
  }

  return (
    // 面板外层：保持与主页面一致的滚动和留白风格。
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {/* 顶部 Tab 区：切换 CLI / LLM / 数据源 / 关于与反馈。 */}
      <div className="border-b border-base-300 px-4 pt-3">
        {/* Tab 组：使用 DaisyUI tab 样式。 */}
        <div className="tabs tabs-boxed inline-flex bg-base-200/60">
          {/* CLI 设置 Tab 按钮。 */}
          <button className={`tab ${activeTab === "cli" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("cli")}>
            CLI设置
          </button>
          {/* LLM 设置 Tab 按钮。 */}
          <button className={`tab ${activeTab === "llm" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("llm")}>
            LLM设置
          </button>
          {/* 数据源 Tab 按钮。 */}
          <button className={`tab ${activeTab === "sources" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("sources")}>
            数据源
          </button>
          {/* 系统日志 Tab 按钮。 */}
          <button className={`tab ${activeTab === "systemLogs" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("systemLogs")}>
            系统日志
          </button>
          {/* 关于与反馈 Tab 按钮。 */}
          <button className={`tab ${activeTab === "about" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("about")}>
            关于与反馈
          </button>
        </div>
      </div>

      {/* 内容区：根据当前 Tab 渲染对应设置面板。 */}
      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {activeTab === "cli" ? (
          <>
            {/* CLI 标题区：包含刷新配置入口。 */}
            <div className="mb-3 flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-2">
              {/* CLI 标题与说明。 */}
              <div>
                <h2 className="text-[14px] font-semibold">CLI 设置</h2>
                <p className="text-[12px] text-neutral/70">进入页面不会自动探测本地路径，可手动检测当前路径或主动探测本机可用路径。</p>
              </div>
              {/* 刷新配置按钮：重新读取已保存设置。 */}
              <button className="btn btn-outline btn-sm" disabled={loading} onClick={() => void loadSettings()}>
                <RefreshCw size={14} />
                刷新配置
              </button>
            </div>

            {/* CLI 生效状态卡片：展示路径、可用性和版本信息。 */}
            <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
              <p className="text-[12px]">
                当前生效路径:
                <span className="ml-1 font-semibold">{cliStatus?.path || settings?.resolvedCliPath || "-"}</span>
              </p>
              <p className="mt-1 text-[12px]">
                路径状态:
                <span className={`ml-1 font-semibold ${cliStatus?.ok ? "text-success" : "text-error"}`}>
                  {cliStatus ? (cliStatus.ok ? "有效" : "无效") : "未检测"}
                </span>
              </p>
              {cliStatus?.ok && (
                <>
                  <p className="mt-1 text-[12px]">
                    CLI 版本:
                    <span className="ml-1 font-semibold">{cliStatus.version || "-"}</span>
                  </p>
                  <p className="mt-1 text-[12px]">
                    可用更新:
                    <span className="ml-1 font-semibold">{cliStatus.hasUpdate === null ? "未知" : cliStatus.hasUpdate ? "有" : "无"}</span>
                    {cliStatus.hasUpdate && cliStatus.latestVersion && (
                      <span className="ml-1 text-neutral/80">(最新: {cliStatus.latestVersion})</span>
                    )}
                  </p>
                </>
              )}
              {!cliStatus?.ok && cliStatus?.detail && <p className="mt-1 text-[12px] text-error">详情: {cliStatus.detail}</p>}
            </div>

            {/* CLI 路径编辑卡片：输入、检测、探测与保存动作。 */}
            <div className="mb-3 rounded border border-base-300 bg-base-100 p-3">
              <label className="mb-1 block text-[12px] font-semibold">自定义 CLI 路径</label>
              <div className="flex flex-row items-center gap-2">
                <input
                  className="input input-bordered input-sm w-full"
                  placeholder="例如: C:\\Program Files\\sf\\bin\\sf.cmd"
                  value={customPathInput}
                  list="cli-path-options"
                  onChange={(event) => setCustomPathInput(event.target.value)}
                  disabled={loading}
                />
                <button className="btn btn-outline btn-sm" disabled={checkingStatus || loading} onClick={() => void checkCustomPathNow()}>
                  <Search size={14} />
                  检测有效
                </button>
                <button className="btn btn-outline btn-sm" disabled={detectingOptions || loading} onClick={() => void detectLocalCliPaths()}>
                  <RefreshCw size={14} />
                  自动探测本地路径
                </button>
              </div>

              <datalist id="cli-path-options">
                {detectedOptions.map((item) => (
                  <option key={item.path} value={item.path}>
                    {item.version || "-"}
                  </option>
                ))}
              </datalist>

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
          </>
        ) : activeTab === "llm" ? (
          <>
            {/* LLM 标题区：包含刷新配置入口。 */}
            <div className="mb-3 flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-2">
              <div>
                <h2 className="text-[14px] font-semibold">LLM 设置（OpenAI）</h2>
                <p className="text-[12px] text-neutral/70">支持配置 baseUrl、model 和 apiKey（仅掩码展示，输入新值后覆盖保存）。</p>
              </div>
              <button className="btn btn-outline btn-sm" disabled={llmSaving} onClick={() => void loadLlmSettings()}>
                <RefreshCw size={14} />
                刷新配置
              </button>
            </div>

            {/* LLM 表单区：编辑并保存 LLM 配置。 */}
            <div className="rounded border border-base-300 bg-base-100 p-3">
              <label className="mb-1 block text-[12px] font-semibold">Base URL</label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="例如: https://api.openai.com/v1"
                value={llmBaseUrlInput}
                onChange={(event) => setLlmBaseUrlInput(event.target.value)}
                disabled={llmSaving}
              />

              <label className="mb-1 mt-3 block text-[12px] font-semibold">Model</label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="例如: gpt-4.1-mini"
                value={llmModelInput}
                onChange={(event) => setLlmModelInput(event.target.value)}
                disabled={llmSaving}
              />

              <label className="mb-1 mt-3 block text-[12px] font-semibold">当前 API Key（掩码）</label>
              <div className="rounded border border-base-300 bg-base-200/40 px-3 py-2 text-[12px]">
                {llmSettings?.apiKeyConfigured ? llmSettings.apiKeyMasked || "已配置" : "未配置"}
              </div>

              <label className="mb-1 mt-3 block text-[12px] font-semibold">覆盖 API Key（可选）</label>
              <input
                className="input input-bordered input-sm w-full"
                placeholder="输入新 key 后点击保存；留空则不覆盖"
                value={llmApiKeyInput}
                onChange={(event) => setLlmApiKeyInput(event.target.value)}
                disabled={llmSaving}
              />

              <div className="mt-3 flex flex-row gap-2">
                <button className="btn btn-primary btn-sm" disabled={llmSaving} onClick={() => void saveLlmSettings()}>
                  <Save size={14} />
                  保存
                </button>
              </div>
            </div>
          </>
        ) : activeTab === "sources" ? (
          <>
            {/* 数据源标题区：提供手动刷新按钮。 */}
            <div className="mb-3 flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-2">
              <div>
                <h2 className="text-[14px] font-semibold">数据源列表</h2>
                <p className="text-[12px] text-neutral/70">展示当前已保存的全部数据源信息（含 accessToken）。</p>
              </div>
              <button className="btn btn-outline btn-sm" disabled={sourcesLoading} onClick={() => void loadSources()}>
                <RefreshCw size={14} />
                刷新数据源
              </button>
            </div>

            {/* 数据源列表区：按卡片显示每个数据源详细信息。 */}
            <div className="space-y-3">
              {sourcesLoading && (
                <div className="rounded border border-base-300 bg-base-100 px-3 py-2 text-[12px] text-neutral/70">
                  正在加载数据源...
                </div>
              )}

              {!sourcesLoading && sources.length === 0 && (
                <div className="rounded border border-base-300 bg-base-100 px-3 py-2 text-[12px] text-neutral/70">暂无数据源。</div>
              )}

              {!sourcesLoading &&
                sources.map((item) => (
                  <div key={item.id} className="rounded border border-base-300 bg-base-100 p-3 text-[12px]">
                    <div className="mb-2 flex items-start justify-between gap-2 border-b border-base-300 pb-2">
                      {/* 卡片标题区：增加数据源类型徽标。 */}
                      <div className="min-w-0">
                        <p className="flex items-center gap-2 text-[13px] font-semibold">
                          <span
                            className={`inline-flex min-w-[52px] items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${getSourceBadgeClassName(item.sourceType)}`}
                          >
                            {getSourceTypeBadge(item.sourceType)}
                          </span>
                          <span className="truncate">{item.name || "-"}</span>
                        </p>
                      </div>
                      {/* MySQL 专属齿轮按钮：点击打开编辑模态框。 */}
                      {(item.sourceType || "salesforce").toLowerCase() === "mysql" && (
                        <button
                          className="btn btn-ghost btn-xs"
                          aria-label="编辑 MySQL 数据源"
                          onClick={() => openMySqlEditModal(item)}
                        >
                          <Cog size={14} />
                        </button>
                      )}
                    </div>
                    <div className="mb-2">
                      <p className="mt-1 text-neutral/70">ID: {item.id}</p>
                    </div>
                    <div className="space-y-1 break-all">
                      <p>
                        <span className="font-semibold">instanceUrl:</span> {item.instanceUrl || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">apiVersion:</span> {item.apiVersion || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">accessToken:</span> {item.accessToken || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">createdAt:</span> {item.createdAt || "-"}
                      </p>
                      <p>
                        <span className="font-semibold">updatedAt:</span> {item.updatedAt || "-"}
                      </p>
                    </div>
                  </div>
                ))}
            </div>
          </>
        ) : activeTab === "systemLogs" ? (
          // 系统日志页：复用独立的 SystemLogsPanel 组件。
          <SystemLogsPanel />
        ) : (
          // 关于与反馈页：展示版本、版权信息和反馈引导。
          <>
            <div className="rounded border border-base-300 bg-base-100 p-4">
              <h2 className="text-[14px] font-semibold">关于</h2>
              <p className="mt-2 text-[12px]">
                软件版本:
                <span className="ml-1 font-semibold">{appVersion}</span>
              </p>
              <p className="mt-1 text-[12px] text-neutral/80">© 2026 李炎</p>
            </div>

            <div className="mt-3 rounded border border-base-300 bg-base-100 p-4">
              <h2 className="text-[14px] font-semibold">反馈与建议</h2>
              <p className="mt-2 text-[12px] leading-relaxed text-neutral/80">
                如果你在使用过程中遇到问题，或者有任何功能建议和改进想法，欢迎通过 GitHub Issues 告诉我们。你的每一条反馈都会帮助我们做得更好！
              </p>
              {/* 提交反馈按钮：点击后通过后端打开系统默认浏览器。 */}
              <button className="btn btn-outline btn-sm mt-3" type="button" disabled={feedbackSubmitting} onClick={() => void submitFeedback()}>
                <ExternalLink size={14} />
                {feedbackSubmitting ? "正在打开..." : "提交反馈"}
              </button>
            </div>
          </>
        )}

        {/* 错误提示：统一展示本页的加载/保存异常。 */}
        {error && (
          <div className="mt-3 rounded border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
            {error}
          </div>
        )}
      </div>

      {/* MySQL 编辑弹窗：仅在设置页用于编辑已存在的 MySQL 数据源。 */}
      {showMySqlEditModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">编辑 MySQL 数据源</h3>
            {/* MySQL 配置表单。 */}
            <div className="mt-3 space-y-2">
              <input
                className="input input-bordered input-sm w-full"
                placeholder="数据源名称"
                value={mySqlEditForm.name}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, name: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Host"
                value={mySqlEditForm.host}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, host: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Port"
                type="number"
                value={String(mySqlEditForm.port)}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, port: Number(event.target.value || 3306) }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Database"
                value={mySqlEditForm.database}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, database: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Username"
                value={mySqlEditForm.username}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, username: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Password"
                type="password"
                value={mySqlEditForm.password}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, password: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Primary Key（可选，默认自动检测）"
                value={mySqlEditForm.primaryKey}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setMySqlEditForm((state) => ({ ...state, primaryKey: event.target.value }))}
              />
            </div>
            {/* 编辑结果提示。 */}
            {mySqlEditMessage && <p className="mt-3 text-xs text-neutral/70">{mySqlEditMessage}</p>}
            {/* 底部操作按钮。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeMySqlEditModal} disabled={mySqlEditSubmitting || mySqlEditTesting}>
                取消
              </button>
              <button className="btn btn-secondary" onClick={() => void testMySqlEditConnection()} disabled={mySqlEditSubmitting || mySqlEditTesting}>
                {mySqlEditTesting ? "测试中..." : "测试连接"}
              </button>
              <button className="btn btn-primary" onClick={() => void saveMySqlEditSource()} disabled={mySqlEditSubmitting || mySqlEditTesting}>
                {mySqlEditSubmitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
