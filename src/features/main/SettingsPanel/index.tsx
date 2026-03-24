import { Cog, ExternalLink, GripVertical, RefreshCw, Save, Search, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  closestCenter,
  DndContext,
  DragEndEvent,
  DragStartEvent,
  PointerSensor,
  useSensor,
  useSensors
} from "@dnd-kit/core";
import { arrayMove, SortableContext, useSortable, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { getVersion } from "@tauri-apps/api/app";
import { api } from "../../../api";
import { NoticeAlert } from "../../../components/NoticeAlert";
import { CliPathProbe, CliPathSettings, CliPathStatus, LlmSettings, SalesforceSource, TerminalShellOption } from "../../../types";
import { checkGithubLatestVersion } from "../../../utils/versionUpdate";
import { SystemLogsPanel } from "./SystemLogs";

// 判断当前 Shell 路径是否为绝对路径：Windows 支持盘符路径与 UNC 路径，Unix 支持 `/` 开头路径。
function isAbsoluteShellPath(shellPath: string): boolean {
  const normalizedShellPath = shellPath.trim();
  return /^[a-zA-Z]:[\\/]/.test(normalizedShellPath) || normalizedShellPath.startsWith("\\\\") || normalizedShellPath.startsWith("/");
}

// 根据保存值或旧版偏好值匹配当前探测到的 Shell 选项。
function findTerminalShellOption(options: TerminalShellOption[], commandValue: string): TerminalShellOption | null {
  const normalizedCommandValue = commandValue.trim().toLowerCase();
  if (!normalizedCommandValue) return null;

  // 先按完整路径精确匹配，确保已保存的绝对路径优先回显。
  const exactMatchedOption = options.find((option) => option.command.trim().toLowerCase() === normalizedCommandValue);
  if (exactMatchedOption) return exactMatchedOption;

  // 兼容旧值（如 `pwsh.exe` / `powershell.exe`），通过命令名后缀映射到当前绝对路径。
  return (
    options.find((option) => {
      const normalizedOptionCommand = option.command.trim().toLowerCase();
      return (
        normalizedOptionCommand.endsWith(`\\${normalizedCommandValue}`) ||
        normalizedOptionCommand.endsWith(`/${normalizedCommandValue}`)
      );
    }) || null
  );
}

// 设置面板：通过顶部 Tab 切换数据源、CLI 设置、LLM 设置、系统日志和关于与反馈页面。
export function SettingsPanel() {
  // 反馈入口 URL：统一集中管理，便于后续替换反馈地址。
  const feedbackIssueUrl = "https://github.com/hi-liyan/simple-salesforce-tool/issues/new";
  // 顶部 Tab 状态：控制当前展示的设置分区。
  const [activeTab, setActiveTab] = useState<"cli" | "terminal" | "llm" | "sources" | "systemLogs" | "about">("sources");
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
  // 终端首选 Shell 命令：保存后用于新建终端进程。
  const [terminalShellCommand, setTerminalShellCommand] = useState("");
  // 终端可用 Shell 列表：由后端动态探测，不限制固定版本。
  const [terminalShellOptions, setTerminalShellOptions] = useState<TerminalShellOption[]>([]);
  // 终端配置加载状态。
  const [terminalSettingsLoading, setTerminalSettingsLoading] = useState(false);
  // 终端配置保存状态。
  const [terminalSettingsSaving, setTerminalSettingsSaving] = useState(false);
  // 平台标识：用于提示不同平台行为。
  const isWindowsPlatform = useMemo(() => /Win/i.test(navigator.platform || navigator.userAgent), []);
  // 通用错误信息：保存/加载/探测失败时展示。
  const [error, setError] = useState("");
  // 应用版本号：通过 Tauri API 获取。
  const [appVersion, setAppVersion] = useState("-");
  // 手动检查更新中的状态：用于禁用按钮并展示“检查中”文案。
  const [checkingAppUpdate, setCheckingAppUpdate] = useState(false);
  // 手动检查更新结果：用于展示版本检查反馈。
  const [appUpdateNotice, setAppUpdateNotice] = useState<{ tone: "success" | "info" | "error"; message: string } | null>(null);
  // 手动检查到的新版本信息：命中更新时显示“前往更新”按钮。
  const [appUpdateResult, setAppUpdateResult] = useState<{ latestVersion: string; releasePageUrl: string } | null>(null);
  // 数据源列表：用于“数据源”Tab 展示完整信息（含 token）。
  const [sources, setSources] = useState<SalesforceSource[]>([]);
  // 当前拖拽中的数据源 ID：用于渲染拖拽态样式。
  const [activeDragSourceId, setActiveDragSourceId] = useState("");
  // 数据源加载状态：用于刷新按钮与加载提示。
  const [sourcesLoading, setSourcesLoading] = useState(false);
  // Salesforce 编辑弹窗开关：仅用于设置页编辑非 CLI 的 Salesforce 数据源。
  const [showSalesforceEditModal, setShowSalesforceEditModal] = useState(false);
  // 当前正在编辑的 Salesforce 数据源。
  const [editingSalesforceSource, setEditingSalesforceSource] = useState<SalesforceSource | null>(null);
  // Salesforce 编辑表单状态。
  const [salesforceEditForm, setSalesforceEditForm] = useState({
    name: "",
    instanceUrl: "",
    accessToken: "",
    apiVersion: "v61.0"
  });
  // Salesforce 编辑弹窗提示文本（测试连接结果/保存失败等）。
  const [salesforceEditMessage, setSalesforceEditMessage] = useState("");
  // Salesforce 编辑提交中状态。
  const [salesforceEditSubmitting, setSalesforceEditSubmitting] = useState(false);
  // Salesforce 测试连接中状态。
  const [salesforceEditTesting, setSalesforceEditTesting] = useState(false);
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
    } else if (activeTab === "terminal" && !loadedTabs.current.terminal) {
      loadedTabs.current.terminal = true;
      void loadTerminalSettings();
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

  // 设置页数据源视图：按 sortOrder 升序展示，序号相同则按名称兜底。
  const sortedSources = useMemo(
    () =>
      [...sources].sort((a, b) => {
        const sortDiff = (a.sortOrder || 0) - (b.sortOrder || 0);
        if (sortDiff !== 0) return sortDiff;
        return a.name.localeCompare(b.name, "zh-CN");
      }),
    [sources]
  );
  // 排序上下文 IDs：供 dnd-kit 计算拖拽位置。
  const sortedSourceIds = useMemo(() => sortedSources.map((item) => item.id), [sortedSources]);
  // 鼠标拖拽传感器：设置激活距离，降低误触。
  const dndSensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 6 }
    })
  );

  // 持久化当前排序结果：失败时回滚到后端顺序。
  async function persistSourceOrder(nextSources: SalesforceSource[]) {
    try {
      const orderedIds = nextSources.map((item) => item.id);
      const persistedSources = await api.reorderSources(orderedIds);
      setSources(persistedSources); // 使用后端归一化后的结果覆盖，保证序号绝对一致。
    } catch (reorderError) {
      setError(`拖拽排序失败：${String(reorderError)}`);
      await loadSources(); // 失败后回滚为服务端顺序，避免前后端状态不一致。
    }
  }

  // 拖拽开始：记录当前拖拽源，供 UI 高亮。
  function onSourceDragStart(event: DragStartEvent) {
    setActiveDragSourceId(String(event.active.id)); // 记录当前拖拽的数据源 ID。
  }

  // 拖拽结束：计算新顺序并落库。
  function onSourceDragEnd(event: DragEndEvent) {
    const activeId = String(event.active.id || "");
    const overId = String(event.over?.id || "");
    setActiveDragSourceId(""); // 无论成功与否都先清理拖拽态。
    if (!activeId || !overId || activeId === overId) return;

    const oldIndex = sortedSources.findIndex((item) => item.id === activeId);
    const newIndex = sortedSources.findIndex((item) => item.id === overId);
    if (oldIndex < 0 || newIndex < 0) return;

    const nextSources = arrayMove(sortedSources, oldIndex, newIndex);
    setSources(nextSources); // 先乐观更新，提升拖拽反馈即时性。
    void persistSourceOrder(nextSources); // 异步持久化序号到后端。
  }

  // 拖拽取消：清理拖拽态标记。
  function onSourceDragCancel() {
    setActiveDragSourceId(""); // 用户取消拖拽时重置状态。
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

  // 打开 Salesforce 编辑弹窗：仅允许编辑非 CLI 数据源。
  function openSalesforceEditModal(source: SalesforceSource) {
    setEditingSalesforceSource(source);
    setSalesforceEditForm({
      name: source.name || "",
      instanceUrl: source.instanceUrl || "",
      accessToken: source.accessToken || "",
      apiVersion: source.apiVersion || "v61.0"
    });
    setSalesforceEditMessage("");
    setShowSalesforceEditModal(true);
  }

  // 关闭 Salesforce 编辑弹窗并清理状态。
  function closeSalesforceEditModal() {
    setShowSalesforceEditModal(false);
    setEditingSalesforceSource(null);
    setSalesforceEditMessage("");
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

  // 构建 Salesforce 更新 payload：用于测试连接与保存。
  function buildSalesforcePayloadFromEditForm() {
    return {
      name: salesforceEditForm.name.trim(),
      sourceType: "salesforce",
      configJson: {},
      instanceUrl: salesforceEditForm.instanceUrl.trim(),
      accessToken: salesforceEditForm.accessToken.trim(),
      apiVersion: salesforceEditForm.apiVersion.trim()
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

  // 测试当前 Salesforce 编辑表单连接。
  async function testSalesforceEditConnection() {
    setSalesforceEditMessage("");
    setSalesforceEditTesting(true);
    try {
      await api.testSourceConnection(buildSalesforcePayloadFromEditForm());
      setSalesforceEditMessage("Salesforce 连接测试成功。");
    } catch (testError) {
      setSalesforceEditMessage(`Salesforce 连接测试失败：${String(testError)}`);
    } finally {
      setSalesforceEditTesting(false);
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

  // 保存 Salesforce 数据源编辑结果。
  async function saveSalesforceEditSource() {
    if (!editingSalesforceSource) return;
    setSalesforceEditMessage("");
    setSalesforceEditSubmitting(true);
    try {
      await api.updateSource(editingSalesforceSource.id, buildSalesforcePayloadFromEditForm());
      await loadSources(); // 保存后立即刷新设置页列表，保持展示一致。
      closeSalesforceEditModal();
    } catch (saveError) {
      setSalesforceEditMessage(`更新 Salesforce 数据源失败：${String(saveError)}`);
    } finally {
      setSalesforceEditSubmitting(false);
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

  // 加载终端设置：读取可用 Shell 列表和当前已保存命令。
  async function loadTerminalSettings() {
    setTerminalSettingsLoading(true);
    setError("");
    try {
      const [options, commandValue, legacyPreference] = await Promise.all([
        api.listAvailableTerminalShells(),
        api.getUiState("terminal.shell.command"),
        api.getUiState("terminal.shell.preference")
      ]);
      const normalizedOptions = Array.isArray(options) ? options : [];
      setTerminalShellOptions(normalizedOptions);

      const savedCommand = (commandValue || "").trim();
      if (savedCommand) {
        // 优先将数据库中的保存值映射到本次探测到的绝对路径选项，失效配置则清空以引导用户重新选择。
        const matchedSavedOption = findTerminalShellOption(normalizedOptions, savedCommand);
        setTerminalShellCommand(matchedSavedOption?.command || "");
        return;
      }

      // 兼容旧配置值（pwsh/powershell），自动映射到命令名。
      const legacy = (legacyPreference || "").trim().toLowerCase();
      if (legacy === "powershell") {
        const matchedLegacyOption = findTerminalShellOption(normalizedOptions, "powershell.exe");
        setTerminalShellCommand(matchedLegacyOption?.command || "");
        return;
      }
      if (legacy === "pwsh") {
        const matchedLegacyOption = findTerminalShellOption(normalizedOptions, "pwsh.exe");
        setTerminalShellCommand(matchedLegacyOption?.command || "");
        return;
      }
      // 无配置时默认选择首个可用项（通常是最高版本）。
      setTerminalShellCommand(normalizedOptions[0]?.command || "");
    } catch (loadError) {
      setError(String(loadError));
    } finally {
      setTerminalSettingsLoading(false);
    }
  }

  // 保存终端设置：后续新建终端 Tab 会按该命令创建进程。
  async function saveTerminalSettings() {
    setTerminalSettingsSaving(true);
    setError("");
    try {
      const normalizedCommand = terminalShellCommand.trim();
      if (!normalizedCommand) {
        setError("请选择可用的终端 Shell。");
        return;
      }
      // 仅允许保存系统探测到的 Shell 绝对路径，确保后续创建终端时不再二次探测。
      const selectedShellOption = findTerminalShellOption(terminalShellOptions, normalizedCommand);
      if (!selectedShellOption) {
        setError("请选择系统探测到的可用终端 Shell。");
        return;
      }
      const absoluteShellPath = selectedShellOption.command.trim();
      if (!isAbsoluteShellPath(absoluteShellPath)) {
        setError("当前终端 Shell 不是绝对路径，请重新选择。");
        return;
      }
      await api.saveUiState("terminal.shell.command", absoluteShellPath);
      setTerminalShellCommand(absoluteShellPath);
    } catch (saveError) {
      setError(String(saveError));
    } finally {
      setTerminalSettingsSaving(false);
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

  // 手动检查应用更新：命中新版本时展示入口，未命中时给出明确提示。
  async function checkAppUpdate() {
    setCheckingAppUpdate(true);
    setAppUpdateNotice(null);
    try {
      const result = await checkGithubLatestVersion();
      if (!result) {
        setAppUpdateResult(null);
        setAppUpdateNotice({ tone: "error", message: "检查更新失败：未能读取当前版本或最新发布信息。" });
        return;
      }

      if (result.hasUpdate) {
        setAppUpdateResult({
          latestVersion: result.latestVersion,
          releasePageUrl: result.releasePageUrl
        });
        setAppUpdateNotice({
          tone: "success",
          message: `发现新版本：当前 ${result.currentVersion}，最新 ${result.latestVersion}。`
        });
        return;
      }

      setAppUpdateResult(null);
      setAppUpdateNotice({
        tone: "info",
        message: `当前已是最新版本：${result.currentVersion}。`
      });
    } catch (error) {
      setAppUpdateResult(null);
      setAppUpdateNotice({ tone: "error", message: `检查更新失败：${String(error)}` });
    } finally {
      setCheckingAppUpdate(false);
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
      {/* 顶部 Tab 区：切换 数据源 / CLI / LLM / 关于与反馈。 */}
      <div className="border-b border-base-300 px-4 pt-3">
        {/* Tab 组：使用 DaisyUI tab 样式。 */}
        <div className="tabs tabs-boxed inline-flex bg-base-200/60">
          {/* 数据源 Tab 按钮。 */}
          <button className={`tab ${activeTab === "sources" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("sources")}>
            数据源
          </button>
          {/* CLI 设置 Tab 按钮。 */}
          <button className={`tab ${activeTab === "cli" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("cli")}>
            CLI设置
          </button>
          {/* 终端设置 Tab 按钮。 */}
          <button className={`tab ${activeTab === "terminal" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("terminal")}>
            终端设置
          </button>
          {/* LLM 设置 Tab 按钮。 */}
          <button className={`tab ${activeTab === "llm" ? "tab-active" : ""}`} type="button" onClick={() => setActiveTab("llm")}>
            LLM设置
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
        ) : activeTab === "terminal" ? (
          <>
            {/* 终端设置标题区：包含刷新配置入口。 */}
            <div className="mb-3 flex items-center justify-between rounded border border-base-300 bg-base-100 px-3 py-2">
              <div>
                <h2 className="text-[14px] font-semibold">终端设置</h2>
                <p className="text-[12px] text-neutral/70">可配置新建终端 Tab 的默认 Shell。保存后对新建终端生效。</p>
              </div>
              <button
                className="btn btn-outline btn-sm"
                disabled={terminalSettingsLoading || terminalSettingsSaving}
                onClick={() => void loadTerminalSettings()}
              >
                <RefreshCw size={14} />
                刷新配置
              </button>
            </div>

            {/* 终端设置表单区。 */}
            <div className="rounded border border-base-300 bg-base-100 p-3">
              {isWindowsPlatform ? (
                <>
                  {/* Windows 终端版本选择器：动态展示可用版本。 */}
                  <label className="mb-1 block text-[12px] font-semibold">Windows 默认 Shell</label>
                  <select
                    className="select select-bordered select-sm w-full"
                    value={terminalShellCommand}
                    disabled={terminalSettingsLoading || terminalSettingsSaving}
                    onChange={(event) => setTerminalShellCommand(event.target.value)}
                  >
                    {terminalShellOptions.length === 0 && <option value="">未检测到可用终端</option>}
                    {terminalShellOptions.map((option) => (
                      <option key={option.command} value={option.command}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <p className="mt-2 text-[12px] text-neutral/70">
                    提示：列表来自系统动态探测；保存时会写入 Shell 绝对路径，后续新建终端 Tab 将直接使用该路径创建。
                  </p>
                </>
              ) : (
                // 非 Windows 平台提示：当前版本仍使用系统 SHELL。
                <p className="text-[12px] text-neutral/70">当前平台使用系统 SHELL 环境变量（如 /bin/bash），暂不支持图形化切换。</p>
              )}

              {/* 保存按钮。 */}
              <div className="mt-3 flex flex-row gap-2">
                <button
                  className="btn btn-primary btn-sm"
                  disabled={terminalSettingsLoading || terminalSettingsSaving || !isWindowsPlatform || !terminalShellCommand}
                  onClick={() => void saveTerminalSettings()}
                >
                  <Save size={14} />
                  保存
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
                sortedSources.length > 0 && (
                  <DndContext
                    sensors={dndSensors}
                    collisionDetection={closestCenter}
                    onDragStart={onSourceDragStart}
                    onDragEnd={onSourceDragEnd}
                    onDragCancel={onSourceDragCancel}
                  >
                    <SortableContext items={sortedSourceIds} strategy={verticalListSortingStrategy}>
                      {/* 可排序卡片列表：使用 dnd-kit 提供稳定拖拽能力。 */}
                      <div className="space-y-3">
                        {sortedSources.map((item) => (
                          <SortableSourceCard
                            key={item.id}
                            item={item}
                            isActiveDrag={activeDragSourceId === item.id}
                            getSourceBadgeClassName={getSourceBadgeClassName}
                            getSourceTypeBadge={getSourceTypeBadge}
                            onOpenSalesforceEdit={openSalesforceEditModal}
                            onOpenMySqlEdit={openMySqlEditModal}
                          />
                        ))}
                      </div>
                    </SortableContext>
                  </DndContext>
                )}
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
              {/* 检查更新操作区：支持手动检查并在命中新版本时前往发布页。 */}
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button className="btn btn-outline btn-sm" type="button" disabled={checkingAppUpdate} onClick={() => void checkAppUpdate()}>
                  {checkingAppUpdate ? "检查中..." : "检查更新"}
                </button>
                {appUpdateResult && (
                  <button
                    className="btn btn-primary btn-sm"
                    type="button"
                    onClick={() => {
                      void api.openExternalUrl(appUpdateResult.releasePageUrl); // 统一走后端命令打开 Releases 页面。
                    }}
                  >
                    前往更新
                  </button>
                )}
              </div>
              {/* 手动检查结果提示：展示是否有新版本或失败原因。 */}
              {appUpdateNotice && (
                <NoticeAlert
                  tone={appUpdateNotice.tone}
                  message={appUpdateNotice.message}
                  onClose={() => setAppUpdateNotice(null)}
                  className="mt-3 max-w-full"
                />
              )}
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

      {/* Salesforce 编辑弹窗：仅在设置页用于编辑非 CLI 的 Salesforce 数据源。 */}
      {showSalesforceEditModal && (
        <div className="modal modal-open">
          <div className="modal-box">
            {/* 弹窗标题。 */}
            <h3 className="text-base font-semibold">编辑 Salesforce 数据源</h3>
            {/* Salesforce 配置表单。 */}
            <div className="mt-3 space-y-2">
              <input
                className="input input-bordered input-sm w-full"
                placeholder="数据源名称"
                value={salesforceEditForm.name}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setSalesforceEditForm((state) => ({ ...state, name: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Instance URL"
                value={salesforceEditForm.instanceUrl}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setSalesforceEditForm((state) => ({ ...state, instanceUrl: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="Access Token"
                value={salesforceEditForm.accessToken}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setSalesforceEditForm((state) => ({ ...state, accessToken: event.target.value }))}
              />
              <input
                className="input input-bordered input-sm w-full"
                placeholder="API Version（例如 v61.0）"
                value={salesforceEditForm.apiVersion}
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                onChange={(event) => setSalesforceEditForm((state) => ({ ...state, apiVersion: event.target.value }))}
              />
            </div>
            {/* 编辑结果提示。 */}
            {salesforceEditMessage && <p className="mt-3 text-xs text-neutral/70">{salesforceEditMessage}</p>}
            {/* 底部操作按钮。 */}
            <div className="modal-action">
              <button className="btn btn-outline" onClick={closeSalesforceEditModal} disabled={salesforceEditSubmitting || salesforceEditTesting}>
                取消
              </button>
              <button className="btn btn-secondary" onClick={() => void testSalesforceEditConnection()} disabled={salesforceEditSubmitting || salesforceEditTesting}>
                {salesforceEditTesting ? "测试中..." : "测试连接"}
              </button>
              <button className="btn btn-primary" onClick={() => void saveSalesforceEditSource()} disabled={salesforceEditSubmitting || salesforceEditTesting}>
                {salesforceEditSubmitting ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

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

type SortableSourceCardProps = {
  // 当前卡片对应的数据源。
  item: SalesforceSource;
  // 当前卡片是否处于激活拖拽态。
  isActiveDrag: boolean;
  // 数据源类型徽标文案计算函数。
  getSourceTypeBadge: (sourceType: string | undefined) => string;
  // 数据源类型徽标样式计算函数。
  getSourceBadgeClassName: (sourceType: string | undefined) => string;
  // 打开 Salesforce 编辑弹窗回调。
  onOpenSalesforceEdit: (source: SalesforceSource) => void;
  // 打开 MySQL 编辑弹窗回调。
  onOpenMySqlEdit: (source: SalesforceSource) => void;
};

// 可拖拽数据源卡片：封装 dnd-kit sortable 行为，避免主组件 JSX 过长。
function SortableSourceCard({
  item,
  isActiveDrag,
  getSourceTypeBadge,
  getSourceBadgeClassName,
  onOpenSalesforceEdit,
  onOpenMySqlEdit
}: SortableSourceCardProps) {
  // 绑定 sortable：提供容器引用、拖拽 handle 监听和位移动画信息。
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({
    id: item.id
  });
  // 将 dnd-kit transform 映射为 CSS transform，驱动拖拽动画。
  const style = {
    transform: CSS.Transform.toString(transform),
    transition
  };

  return (
    // 卡片容器：setNodeRef 必须绑定到可排序根节点。
    <div
      ref={setNodeRef}
      style={style}
      className={`rounded border bg-base-100 p-3 text-[12px] ${isDragging || isActiveDrag ? "border-primary opacity-80" : "border-base-300"}`}
    >
      <div className="mb-2 border-b border-base-300 pb-2">
        {/* 卡片标题区：包含拖拽 handle、类型徽标、名称和编辑按钮。 */}
        <div className="min-w-0">
          <p className="flex items-center gap-2 text-[13px] font-semibold">
            {/* 拖拽 icon：通过 listeners/attributes 绑定可拖拽手柄。 */}
            <button
              ref={setActivatorNodeRef}
              type="button"
              className="cursor-grab text-neutral/60 active:cursor-grabbing"
              title="拖拽调整排序"
              {...attributes}
              {...listeners}
            >
              <GripVertical size={14} />
            </button>
            {/* 数据源类型徽标。 */}
            <span
              className={`inline-flex min-w-[52px] items-center justify-center rounded px-1.5 py-[1px] text-[10px] font-semibold ${getSourceBadgeClassName(item.sourceType)}`}
            >
              {getSourceTypeBadge(item.sourceType)}
            </span>
            {/* 数据源名称与序号。 */}
            <span className="truncate">
              [{item.sortOrder || 0}] {item.name || "-"}
            </span>
            {/* Salesforce 非 CLI 数据源支持编辑连接信息。 */}
            {(item.sourceType || "salesforce").toLowerCase() === "salesforce" && !item.id.startsWith("cli-") && (
              <button className="btn btn-ghost btn-xs" aria-label="编辑 Salesforce 数据源" onClick={() => onOpenSalesforceEdit(item)}>
                <Cog size={14} />
              </button>
            )}
            {/* MySQL 专属齿轮按钮：紧跟在名称后面。 */}
            {(item.sourceType || "salesforce").toLowerCase() === "mysql" && (
              <button className="btn btn-ghost btn-xs" aria-label="编辑 MySQL 数据源" onClick={() => onOpenMySqlEdit(item)}>
                <Cog size={14} />
              </button>
            )}
          </p>
        </div>
      </div>
      <div className="mb-2">
        <p className="mt-1 text-neutral/70">序号: {item.sortOrder || 0}</p>
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
  );
}
