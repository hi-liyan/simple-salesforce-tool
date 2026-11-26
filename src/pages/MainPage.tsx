import { Suspense, lazy, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api } from "../api";
import { Blocks, Cpu, Trash2, Upload, X } from "lucide-react";
import { NoticeAlert } from "../components/NoticeAlert";
import { listDataSourceDrivers } from "../drivers/registry";
import { useMainPageQueryPanel } from "../features/main/QueryPanel/hooks/useMainPageQueryPanel";
import { AppShellLayout } from "../layouts/AppShellLayout";
import { CustomTitleBar } from "../layouts/CustomTitleBar";
import {
  createPluginContext,
  getPlugin,
  listPlugins,
  PluginHost,
  registerExternalPluginRecord,
  unregisterPlugin
} from "../plugins/core";
import { useAppStore } from "../store/useAppStore";
import { useSoqlExecutorStore } from "../store/useSoqlExecutorStore";
import { useQueryWorkspaceTabsStore } from "../store/useQueryWorkspaceTabsStore";
import { useQuerySourceTreeStore } from "../store/useQuerySourceTreeStore";
import { enableStorageWrite } from "../store/tauriStorage";
import type { Update } from "@tauri-apps/plugin-updater";
import { checkAppUpdateWithFallback, installNativeAppUpdate, waitForUiIdleFrame } from "../utils/versionUpdate";
import { createStartupCoordinator, shouldKeepQueryPanelMounted, shouldMountQueryPanel } from "./mainPageStartup";
import { QueryPanel } from "../features/main/QueryPanel";
import { BottomConsoleDrawer } from "../features/terminal/BottomConsoleDrawer";
import { SourceConnectionModal, type SourceConnectionModalMode } from "../features/source-manager/SourceConnectionModal";
import { subscribeSourceActionEvent } from "../features/source-manager/sourceModalEvents";
import { SettingsModal } from "../features/settings/SettingsModal";
import { LogAuditModal } from "../features/logs/LogAuditModal";
import type { SalesforceSource } from "../types";

// 启动版本检查标志：避免 React StrictMode 在开发环境重复触发新版本通知。
let startupVersionCheckTriggered = false;

// 启动阶段标识：用于驱动遮罩进度条与当前动作文案。
type StartupStageKey = "rehydrate" | "enable-storage" | "restore-sources" | "ready";

// 启动阶段配置：定义每个阶段的进度百分比与展示文案。
type StartupStage = {
  key: StartupStageKey;
  progress: number;
  label: string;
  detail: string;
};

// 启动阶段顺序：与实际初始化流程保持一致，便于展示“已完成/进行中/待开始”。
const STARTUP_STAGES: StartupStage[] = [
  {
    key: "rehydrate",
    progress: 20,
    label: "恢复本地工作区状态",
    detail: "正在从数据库恢复界面、控制台与查询工作区快照..."
  },
  {
    key: "enable-storage",
    progress: 45,
    label: "启用本地状态写入",
    detail: "正在开启启动后的持久化写入门控..."
  },
  {
    key: "restore-sources",
    progress: 80,
    label: "恢复最近使用的数据源",
    detail: "正在加载本地数据源并恢复上次选择..."
  },
  {
    key: "ready",
    progress: 100,
    label: "准备进入主界面",
    detail: "正在完成启动收尾并进入工作区..."
  }
];

// 启动阶段索引：按 key 快速获取阶段配置，避免重复查找。
const STARTUP_STAGE_MAP = Object.fromEntries(STARTUP_STAGES.map((stage) => [stage.key, stage])) as Record<StartupStageKey, StartupStage>;
// 启动协调器：跨 StrictMode 双挂载共享一次性启动任务与阶段进度。
const mainPageStartupCoordinator = createStartupCoordinator<StartupStage>(STARTUP_STAGE_MAP.rehydrate);

// 懒加载工具页：避免首屏加载 JSON 工具相关编辑器与树组件。
const LazyToolsPanel = lazy(async () => {
  const module = await import("../features/main/ToolsPanel");
  return {
    default: module.ToolsPanel
  };
});

// 工作区懒加载占位：用于展示面板代码分片加载中的状态。
function WorkspaceLoadingFallback({ title }: { title: string }) {
  return (
    // 占位容器：保持主区域完整尺寸，避免切视图时闪动。
    <div className="flex h-full w-full items-center justify-center bg-base-200/35">
      {/* 占位卡片：展示当前正在加载的工作区名称。 */}
      <div className="rounded-xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
        <div className="flex items-center gap-3">
          {/* 旋转指示器：提示代码分片正在加载。 */}
          <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
          <div>
            {/* 标题文案：说明当前正在加载哪个工作区。 */}
            <p className="text-[13px] font-medium">{title}</p>
            {/* 补充说明：提示为首次按需加载。 */}
            <p className="mt-1 text-[12px] text-neutral/70">首次进入时正在按需加载相关模块...</p>
          </div>
        </div>
      </div>
    </div>
  );
}

// 主页面：对象列表 + 结果面板 + SOQL 抽屉。
export function MainPage() {
  // Store：视图模式与侧栏宽度（已通过 Zustand persist 自动持久化到 SQLite）。
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const soqlSidebarWidth = useAppStore((state) => state.soqlSidebarWidth);
  const setSoqlSidebarWidth = useAppStore((state) => state.setSoqlSidebarWidth);
  const compactPersistedTabsSnapshot = useAppStore((state) => state.compactPersistedTabsSnapshot);

  // 启动画面快照：由模块级协调器托管，避免 StrictMode 双挂载重复执行启动重任务。
  const [startupState, setStartupState] = useState(() => mainPageStartupCoordinator.getSnapshot());
  // 新版本提示通知状态：有值时在右上角显示升级通知。
  const [versionUpdateNotice, setVersionUpdateNotice] = useState<VersionUpdateNoticeState | null>(null);
  // Query 工作区是否已初始化：首次进入后保持挂载，避免切页时重建 DataGrid 等重组件。
  const [queryPanelMounted, setQueryPanelMounted] = useState(() => shouldMountQueryPanel(viewMode, mainPageStartupCoordinator.getSnapshot().complete));
  // VSCode 风格底部集成终端抽屉开关（支持 Ctrl + ` 呼出/收起）。
  const [bottomConsoleOpen, setBottomConsoleOpen] = useState(false);
  // 统一新建/编辑/复制数据源弹窗状态。
  const [sourceModalState, setSourceModalState] = useState<{
    open: boolean;
    mode: SourceConnectionModalMode;
    source: SalesforceSource | null;
  }>({ open: false, mode: "create", source: null });
  // 待确认删除的数据源。
  const [pendingDeleteSource, setPendingDeleteSource] = useState<SalesforceSource | null>(null);
  const [deletingSource, setDeletingSource] = useState(false);
  // 应用设置弹窗开关（支持 Ctrl + , 快捷键）。
  const [settingsModalOpen, setSettingsModalOpen] = useState(false);
  // 日志与 SQL 审计中心弹窗开关。
  const [logAuditModalOpen, setLogAuditModalOpen] = useState(false);
  // 右侧停靠插件面板（如命令库 / 局域网接收）：默认收起，可从标题栏或插件中心开启。
  const [rightDockPluginId, setRightDockPluginId] = useState<string | null>(null);
  // 插件中心弹窗开关。
  const [pluginCenterOpen, setPluginCenterOpen] = useState(false);
  // 插件列表刷新版本号：安装/启停/卸载外部插件后触发重渲染。
  const [pluginRegistryTick, setPluginRegistryTick] = useState(0);
  // 待审批安装的 `.sstplugin` 预览包信息。
  const [pendingPluginInstall, setPendingPluginInstall] = useState<{
    bytes: number[];
    inspection: Awaited<ReturnType<typeof api.inspectPluginPackageBytes>>;
  } | null>(null);
  // 外部插件包操作中的错误或状态提示。
  const [pluginInstallError, setPluginInstallError] = useState("");
  const pluginFileInputRef = useRef<HTMLInputElement | null>(null);
  // 驱动管理弹窗开关。
  const [driverManagerOpen, setDriverManagerOpen] = useState(false);
  // 当前打开的工作区插件 ID（当 viewMode === "tools" 且通过插件中心打开指定插件时使用）。
  const [activeWorkspacePluginId, setActiveWorkspacePluginId] = useState<string | null>(null);

  // 认证凭证刷新计数器：用于处理并发 API 请求下的开始/结束配对。
  const tokenRefreshingCountRef = useRef(0);
  // 是否正在通过 CLI 重新获取 accessToken。
  const [tokenRefreshing, setTokenRefreshing] = useState(false);

  // QueryPanel 聚合控制：统一返回 QueryPanel 渲染态、交互行为和启动阶段需要的能力。
  const { queryPanelViewState, queryPanelActions, refreshSources, reloadRestoredTabs, showWorkspaceNotice } = useMainPageQueryPanel({
    viewMode,
    setViewMode,
    soqlSidebarWidth,
    setSoqlSidebarWidth,
    startupComplete: startupState.complete,
    tokenRefreshing
  });

  // 初始化加载：先恢复本地持久化状态，再将 CLI 同步放到后台静默执行。
  useEffect(() => {
    const unsubscribe = mainPageStartupCoordinator.subscribe((snapshot) => {
      setStartupState(snapshot);
    });

    void mainPageStartupCoordinator.ensureStarted(async ({ setStage, finish }) => {
      // 启动第一阶段：恢复持久化工作区快照。
      setStage(STARTUP_STAGE_MAP.rehydrate);
      // 手动触发 rehydrate（skipHydration: true），从 SQLite 恢复持久化状态。
      await Promise.all([
        useAppStore.persist.rehydrate(),
        useSoqlExecutorStore.persist.rehydrate(),
        useQueryWorkspaceTabsStore.persist.rehydrate(),
        useQuerySourceTreeStore.persist.rehydrate()
      ]);

      // 启动第二阶段：允许后续状态重新写回本地存储。
      setStage(STARTUP_STAGE_MAP["enable-storage"]);
      // rehydrate 完成后开启写入门控，并主动把旧版重快照压缩为轻量结构。
      enableStorageWrite();
      compactPersistedTabsSnapshot();

      // 启动第三阶段：恢复本地数据源与上次选择结果。
      setStage(STARTUP_STAGE_MAP["restore-sources"]);
      // hydration 完成后从 store 读取持久化的数据源 ID。
      const persistedSourceId = useAppStore.getState().selectedSourceId;
      // 首屏只恢复本地数据源与上次选择，避免 CLI 同步和对象强刷阻塞启动遮罩。
      await refreshSources(false, undefined, persistedSourceId, {
        forceObjectRefresh: false
      });

      // 启动最后阶段：主界面已具备可交互条件，准备收起启动遮罩。
      setStage(STARTUP_STAGE_MAP.ready);
      finish();

      // 异步重新拉取恢复的 Tab 数据（describe + query），不阻塞主界面。
      const finalSelectedSourceId = useAppStore.getState().selectedSourceId;
      // 将恢复任务句柄保留下来，供后续版本检查避开启动重任务窗口。
      const restoredTabsPromise = reloadRestoredTabs(finalSelectedSourceId);

      // 启动后后台加载已安装的外部 `.sstplugin` 插件并注册到前端沙箱注册表。
      void api
        .listInstalledPlugins()
        .then((records) => {
          records.forEach((record) => registerExternalPluginRecord(record));
          setPluginRegistryTick((n) => n + 1);
        })
        .catch(() => {
          // 非 Tauri 环境或首次无外部插件时静默忽略。
        });

      // 启动后在后台静默同步 CLI 数据源，不再影响首屏可交互时间。
      // 这里继续沿用持久化的数据源 ID，避免“首屏本地列表未命中 -> 选中被清空”后无法恢复 CLI 数据源。
      void refreshSources(true, undefined, persistedSourceId, {
        forceObjectRefresh: false,
        showLoading: false
      }).then(() => {
        // 后台同步后若恢复出了不同于首屏的目标数据源，则补做一次恢复 Tab 数据。
        const syncedSelectedSourceId = useAppStore.getState().selectedSourceId;
        if (!syncedSelectedSourceId || syncedSelectedSourceId === finalSelectedSourceId) return;
        void reloadRestoredTabs(syncedSelectedSourceId);
      });

      if (!startupVersionCheckTriggered) {
        startupVersionCheckTriggered = true;
        void restoredTabsPromise.finally(() => {
          // 等恢复 Tab 的重任务收尾后再做版本检查，避免启动阶段的重任务影响通知交互。
          void checkLatestVersionOnStartup(showVersionUpdateNotice);
        });
      }
    });

    return () => {
      unsubscribe();
    };
  }, [compactPersistedTabsSnapshot, refreshSources, reloadRestoredTabs]);

  // 全局快捷键：Ctrl + ` 切换底部终端抽屉；Ctrl + , 打开应用设置。
  useEffect(() => {
    const handleGlobalShortcuts = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey || event.shiftKey) return;
      const isBackquote = event.code === "Backquote" || event.key === "`";
      if (isBackquote) {
        event.preventDefault();
        event.stopPropagation();
        setBottomConsoleOpen((prev) => !prev);
        return;
      }
      if (event.key === "," || event.code === "Comma") {
        event.preventDefault();
        event.stopPropagation();
        setSettingsModalOpen((prev) => !prev);
      }
    };

    window.addEventListener("keydown", handleGlobalShortcuts, { capture: true });
    return () => {
      window.removeEventListener("keydown", handleGlobalShortcuts, { capture: true });
    };
  }, []);

  // 订阅来自左侧树或工具栏的数据源弹窗/删除请求。
  useEffect(() => {
    return subscribeSourceActionEvent((detail) => {
      if (detail.action === "modal") {
        setSourceModalState({
          open: true,
          mode: detail.mode,
          source: detail.source ?? null
        });
      } else if (detail.action === "delete") {
        setPendingDeleteSource(detail.source);
      }
    });
  }, []);

  // 监听 token 刷新事件：用于在 loading 遮罩中显示更明确文案。
  useEffect(() => {
    let active = true;
    let unlistenStart: (() => void) | undefined;
    let unlistenEnd: (() => void) | undefined;

    const setup = async () => {
      unlistenStart = await listen("sf:token-refresh-start", () => {
        if (!active) return;
        tokenRefreshingCountRef.current += 1;
        setTokenRefreshing(true);
      });

      unlistenEnd = await listen("sf:token-refresh-end", () => {
        if (!active) return;
        tokenRefreshingCountRef.current = Math.max(0, tokenRefreshingCountRef.current - 1);
        setTokenRefreshing(tokenRefreshingCountRef.current > 0);
      });
    };

    void setup();
    return () => {
      active = false;
      unlistenStart?.();
      unlistenEnd?.();
      tokenRefreshingCountRef.current = 0;
    };
  }, []);

  // 记录 Query 是否访问过：首次进入后保持挂载，仅通过显示/隐藏切换。
  useEffect(() => {
    if (!shouldKeepQueryPanelMounted(queryPanelMounted, viewMode, startupState.complete)) return;
    setQueryPanelMounted(true);
  }, [queryPanelMounted, startupState.complete, viewMode]);

  // 启动步骤列表：用于在遮罩中展示每个阶段的完成状态。
  const startupStageItems = STARTUP_STAGES.map((stage) => {
    const isCurrentStage = stage.key === startupState.stage.key;
    const isCompletedStage = stage.progress < startupState.stage.progress;
    // 根据当前阶段进度，推导遮罩中的步骤状态文案。
    const statusText = isCompletedStage ? "已完成" : isCurrentStage ? "进行中" : "待开始";
    return {
      ...stage,
      isCurrentStage,
      isCompletedStage,
      statusText
    };
  });

  // 监听登录成功事件：自动刷新数据源并切换到新登录的 org。
  useEffect(() => {
    let active = true;

    const setup = async () => {
      const unlisten = await listen<{ orgId: string }>("sf:login-success", async (event) => {
        if (!active) return;
        await refreshSources(true, event.payload?.orgId);
        showWorkspaceNotice({
          type: "success",
          message: "Salesforce 认证成功。"
        });
      });
      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setup().then((unlisten) => {
      cleanup = unlisten;
    });

    return () => {
      active = false;
      cleanup?.();
    };
  }, []);

  // 版本检查命中时展示右上角升级通知。
  function showVersionUpdateNotice(payload: VersionUpdateNoticeState) {
    setVersionUpdateNotice(payload);
  }

  // 关闭升级通知。
  function closeVersionUpdateNotice() {
    setVersionUpdateNotice(null);
  }

  // 打开指定插件：根据挂载能力路由到工作区或右侧停靠浮岛。
  function handleLaunchPlugin(pluginId: string) {
    const manifest = getPlugin(pluginId);
    if (!manifest) return;
    setPluginCenterOpen(false);
    if (pluginId === "builtin.terminal-workspace") {
      setBottomConsoleOpen(true);
      return;
    }
    if (manifest.mountTargets.includes("dock-right")) {
      setRightDockPluginId(pluginId);
      return;
    }
    setActiveWorkspacePluginId(pluginId);
    queryPanelActions.onSetViewMode("tools");
  }

  // 为右侧停靠插件或工作区插件构建隔离上下文。
  const dockPluginContext = useMemo(() => {
    if (!rightDockPluginId) return null;
    return createPluginContext({
      pluginId: rightDockPluginId,
      onNotify: (message, tone) =>
        showWorkspaceNotice({
          type: tone === "error" ? "error" : "success",
          message
        }),
      onOpenPlugin: (targetId) => handleLaunchPlugin(targetId),
      onCloseSelf: () => setRightDockPluginId(null),
      getActiveSourceSummary: () =>
        queryPanelViewState.selectedSourceId
          ? {
              id: queryPanelViewState.selectedSourceId,
              name:
                queryPanelViewState.sources.find((s) => s.id === queryPanelViewState.selectedSourceId)?.name || "",
              sourceType: queryPanelViewState.selectedSourceType
            }
          : null,
      getActiveEditorSelection: () => "",
      insertTextToActiveEditor: () => {}
    });
  }, [rightDockPluginId, queryPanelViewState.selectedSourceId, queryPanelViewState.selectedSourceType, queryPanelViewState.sources]);

  const workspacePluginContext = useMemo(() => {
    if (!activeWorkspacePluginId) return null;
    return createPluginContext({
      pluginId: activeWorkspacePluginId,
      onNotify: (message, tone) =>
        showWorkspaceNotice({
          type: tone === "error" ? "error" : "success",
          message
        }),
      onOpenPlugin: (targetId) => handleLaunchPlugin(targetId),
      onCloseSelf: () => {
        setActiveWorkspacePluginId(null);
        queryPanelActions.onSetViewMode("query");
      },
      getActiveSourceSummary: () =>
        queryPanelViewState.selectedSourceId
          ? {
              id: queryPanelViewState.selectedSourceId,
              name:
                queryPanelViewState.sources.find((s) => s.id === queryPanelViewState.selectedSourceId)?.name || "",
              sourceType: queryPanelViewState.selectedSourceType
            }
          : null,
      getActiveEditorSelection: () => "",
      insertTextToActiveEditor: () => {}
    });
  }, [activeWorkspacePluginId, queryPanelViewState.selectedSourceId, queryPanelViewState.selectedSourceType, queryPanelViewState.sources]);

  const registeredPlugins = useMemo(() => listPlugins(), [pluginCenterOpen, pluginRegistryTick]);
  const registeredDrivers = useMemo(() => listDataSourceDrivers(), []);

  return (
    <AppShellLayout
      titleBar={
        <CustomTitleBar
          aiDockOpen={Boolean(rightDockPluginId)}
          onToggleAiDock={() => {
            if (rightDockPluginId) {
              setRightDockPluginId(null);
              return;
            }
            const dockPlugin = registeredPlugins.find(
              (plugin) => plugin.enabled !== false && plugin.mountTargets.includes("dock-right")
            );
            if (dockPlugin) {
              setRightDockPluginId(dockPlugin.id);
              return;
            }
            setPluginCenterOpen(true);
          }}
          onNewConnection={() => setSourceModalState({ open: true, mode: "create", source: null })}
          onNewQuery={() => {
            queryPanelActions.onSetViewMode("query");
            queryPanelActions.onOpenConsole();
          }}
          onOpenDriverManager={() => setDriverManagerOpen(true)}
          onOpenPluginCenter={() => setPluginCenterOpen(true)}
          onOpenTerminal={() => setBottomConsoleOpen((prev) => !prev)}
          onOpenSystemLogs={() => setLogAuditModalOpen(true)}
          onOpenSettings={() => setSettingsModalOpen(true)}
        />
      }
      statusBar={
        <>
          <div className="flex items-center gap-2">
            <span className="inline-block h-2 w-2 rounded-full bg-success" />
            <span>
              {startupState.loading
                ? `正在后台恢复工作区：${startupState.stage.label} (${startupState.stage.progress}%)`
                : "工作区已就绪"}
            </span>
          </div>
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={() => queryPanelActions.onSetViewMode("query")}
              className={`hover:text-neutral ${viewMode === "query" ? "font-semibold text-primary" : ""}`}
            >
              查询工作区
            </button>
            <button
              type="button"
              onClick={() => setBottomConsoleOpen((prev) => !prev)}
              className={`hover:text-neutral ${bottomConsoleOpen ? "font-semibold text-primary" : ""}`}
              title="切换底部终端 (Ctrl + `)"
            >
              终端 (Ctrl+`)
            </button>
            <button
              type="button"
              onClick={() => setPluginCenterOpen(true)}
              className="hover:text-neutral"
            >
              插件 ({registeredPlugins.length})
            </button>
          </div>
        </>
      }
      overlay={
        <>
          {queryPanelViewState.workspaceNotice && (
            <NoticeAlert
              tone={
                queryPanelViewState.workspaceNotice.type === "error"
                  ? "error"
                  : queryPanelViewState.workspaceNotice.type === "warning"
                    ? "warning"
                    : "success"
              }
              message={queryPanelViewState.workspaceNotice.message}
              onClose={queryPanelActions.onCloseWorkspaceNotice}
              className="fixed bottom-8 right-4 z-[70] max-w-[380px] rounded-xl shadow-lg"
            />
          )}

          {versionUpdateNotice && (
            <div className="fixed right-4 top-12 z-[70] flex max-w-[400px] items-center gap-3 rounded-xl border border-success/40 bg-base-100 px-3.5 py-2.5 text-[12px] shadow-lg">
              <div className="min-w-0 flex-1">
                <p className="font-medium text-neutral">
                  发现新版本 v{versionUpdateNotice.latestVersion.replace(/^[vV]/, "")}（当前 v{versionUpdateNotice.currentVersion}）
                </p>
                {versionUpdateNotice.progressText && (
                  <p className="mt-0.5 text-[11px] text-primary">{versionUpdateNotice.progressText}</p>
                )}
              </div>
              {versionUpdateNotice.nativeUpdate && (
                <button
                  type="button"
                  disabled={Boolean(versionUpdateNotice.installing)}
                  className="btn btn-primary btn-xs shrink-0"
                  onClick={async () => {
                    const targetUpdate = versionUpdateNotice.nativeUpdate;
                    if (!targetUpdate) return;
                    setVersionUpdateNotice((prev) =>
                      prev ? { ...prev, installing: true, progressText: "正在下载更新包..." } : prev
                    );
                    try {
                      await installNativeAppUpdate(targetUpdate, ({ phase, percent }) => {
                        setVersionUpdateNotice((prev) =>
                          prev
                            ? {
                                ...prev,
                                progressText:
                                  phase === "downloading"
                                    ? percent !== null
                                      ? `正在下载 ${percent}%...`
                                      : "正在下载..."
                                    : "正在安装并重启..."
                              }
                            : prev
                        );
                      });
                    } catch (error) {
                      setVersionUpdateNotice((prev) =>
                        prev ? { ...prev, installing: false, progressText: `更新失败：${String(error)}` } : prev
                      );
                    }
                  }}
                >
                  {versionUpdateNotice.installing ? "更新中" : "立即更新"}
                </button>
              )}
              <button
                type="button"
                onClick={closeVersionUpdateNotice}
                className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md text-neutral/60 hover:bg-base-200"
                aria-label="关闭更新提示"
              >
                <X size={13} />
              </button>
            </div>
          )}

          {/* 插件中心弹窗：展示全部已注册内置/外部插件，支持 `.sstplugin` 安装、权限审批、启停与卸载。 */}
          {pluginCenterOpen && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
              <div className="w-[660px] max-w-[92vw] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[14px] font-semibold">
                    <Blocks size={16} className="text-primary" />
                    <span>插件中心</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <input
                      ref={pluginFileInputRef}
                      type="file"
                      accept=".sstplugin,.zip"
                      className="hidden"
                      onChange={async (event) => {
                        const file = event.target.files?.[0];
                        event.target.value = "";
                        if (!file) return;
                        setPluginInstallError("");
                        try {
                          const buffer = await file.arrayBuffer();
                          const bytes = Array.from(new Uint8Array(buffer));
                          const inspection = await api.inspectPluginPackageBytes(bytes);
                          setPendingPluginInstall({ bytes, inspection });
                        } catch (error) {
                          setPluginInstallError(String(error));
                        }
                      }}
                    />
                    <button
                      type="button"
                      onClick={() => pluginFileInputRef.current?.click()}
                      className="btn btn-primary btn-xs gap-1"
                    >
                      <Upload size={12} />
                      安装 .sstplugin
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setPendingPluginInstall(null);
                        setPluginInstallError("");
                        setPluginCenterOpen(false);
                      }}
                      className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
                    >
                      <X size={15} />
                    </button>
                  </div>
                </div>

                {pluginInstallError && (
                  <div className="mb-3 rounded-lg border border-error/40 bg-error/10 px-3 py-2 text-[12px] text-error">
                    {pluginInstallError}
                  </div>
                )}

                {pendingPluginInstall && (
                  <div className="mb-3 rounded-xl border border-primary/40 bg-primary/5 p-3 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold">
                        确认{pendingPluginInstall.inspection.isUpgrade ? "升级" : "安装"}插件：
                        {pendingPluginInstall.inspection.manifest.name} (v
                        {pendingPluginInstall.inspection.manifest.version})
                      </span>
                      <span className="font-mono text-[11px] text-neutral/70">
                        {pendingPluginInstall.inspection.manifest.id}
                      </span>
                    </div>
                    <p className="mt-1 text-neutral/75">
                      申请权限：
                      {pendingPluginInstall.inspection.manifest.permissions.length > 0
                        ? pendingPluginInstall.inspection.manifest.permissions.join(", ")
                        : "无特殊权限"}
                    </p>
                    <div className="mt-2.5 flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => setPendingPluginInstall(null)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn btn-primary btn-xs"
                        onClick={async () => {
                          try {
                            const installed = await api.installPluginPackageBytes(pendingPluginInstall.bytes);
                            registerExternalPluginRecord(installed);
                            setPendingPluginInstall(null);
                            setPluginRegistryTick((n) => n + 1);
                          } catch (error) {
                            setPluginInstallError(String(error));
                          }
                        }}
                      >
                        授权并安装
                      </button>
                    </div>
                  </div>
                )}

                <div className="grid max-h-[60vh] grid-cols-2 gap-2.5 overflow-auto pr-0.5">
                  {registeredPlugins.length === 0 && (
                    <div className="col-span-2 rounded-xl border border-dashed border-base-300 bg-base-200/30 px-4 py-8 text-center text-[12px] text-neutral/70">
                      暂无已安装插件，可点击右上角「安装 .sstplugin」导入本地插件包。
                    </div>
                  )}
                  {registeredPlugins.map((plugin) => {
                    const Icon = plugin.icon;
                    const isDisabled = plugin.isExternal && plugin.enabled === false;
                    return (
                      <div
                        key={plugin.id}
                        className={`flex items-start gap-2.5 rounded-xl border border-base-300/80 bg-base-200/35 p-3 transition-colors ${isDisabled ? "opacity-60" : "hover:border-primary/40 hover:bg-primary/5"}`}
                      >
                        <button
                          type="button"
                          disabled={isDisabled}
                          onClick={() => handleLaunchPlugin(plugin.id)}
                          className="flex min-w-0 flex-1 items-start gap-2.5 text-left"
                        >
                          <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                            <Icon size={16} />
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate text-[13px] font-semibold">{plugin.name}</span>
                              <span className="rounded bg-base-300/60 px-1.5 py-0.5 text-[10px] text-neutral/70">
                                v{plugin.version}
                              </span>
                            </div>
                            <p className="mt-1 line-clamp-2 text-[11px] text-neutral/70">{plugin.description}</p>
                          </div>
                        </button>
                        {plugin.isExternal && (
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <input
                              type="checkbox"
                              className="toggle toggle-xs toggle-primary"
                              checked={!isDisabled}
                              title={isDisabled ? "启用插件" : "禁用插件"}
                              onChange={async () => {
                                const nextEnabled = Boolean(isDisabled);
                                await api.setInstalledPluginEnabled(plugin.id, nextEnabled);
                                const records = await api.listInstalledPlugins();
                                const target = records.find((r) => r.pluginId === plugin.id);
                                if (target) registerExternalPluginRecord(target);
                                setPluginRegistryTick((n) => n + 1);
                              }}
                            />
                            <button
                              type="button"
                              title="卸载插件"
                              className="btn btn-ghost btn-xs px-1 text-error"
                              onClick={async () => {
                                await api.uninstallPlugin(plugin.id);
                                unregisterPlugin(plugin.id);
                                setPluginRegistryTick((n) => n + 1);
                              }}
                            >
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          )}

          {/* 统一新建/编辑/复制数据源弹窗。 */}
          <SourceConnectionModal
            open={sourceModalState.open}
            mode={sourceModalState.mode}
            source={sourceModalState.source}
            onClose={() => setSourceModalState((prev) => ({ ...prev, open: false }))}
            onOpenOAuthWindow={() => void api.openAuthWindow()}
            onSaved={async (savedId) => {
              await refreshSources(false, savedId, undefined, { forceObjectRefresh: false });
              showWorkspaceNotice({
                type: "success",
                message: sourceModalState.mode === "edit" ? "数据源连接已更新。" : "数据源连接已创建。"
              });
            }}
          />

          {/* 删除数据源确认弹窗。 */}
          {pendingDeleteSource && (
            <div
              className="fixed inset-0 z-[115] flex items-center justify-center bg-black/30 backdrop-blur-[2px]"
              onClick={() => !deletingSource && setPendingDeleteSource(null)}
            >
              <div
                className="w-[400px] max-w-[92vw] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl"
                onClick={(event) => event.stopPropagation()}
              >
                <h3 className="text-[14px] font-semibold text-neutral">确认删除数据源</h3>
                <p className="mt-2 text-[12px] text-neutral/75">
                  确定删除数据源“{pendingDeleteSource.name}”吗？删除后将清理该连接及其本地元数据缓存。
                </p>
                <div className="mt-4 flex justify-end gap-2">
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm rounded-lg"
                    disabled={deletingSource}
                    onClick={() => setPendingDeleteSource(null)}
                  >
                    取消
                  </button>
                  <button
                    type="button"
                    className="btn btn-error btn-sm rounded-lg"
                    disabled={deletingSource}
                    onClick={async () => {
                      setDeletingSource(true);
                      try {
                        await api.deleteSource(pendingDeleteSource.id);
                        setPendingDeleteSource(null);
                        await refreshSources(false, undefined, undefined, { forceObjectRefresh: false });
                        showWorkspaceNotice({ type: "success", message: "数据源已删除。" });
                      } catch (err) {
                        showWorkspaceNotice({ type: "error", message: `删除数据源失败：${String(err)}` });
                      } finally {
                        setDeletingSource(false);
                      }
                    }}
                  >
                    {deletingSource ? "删除中..." : "确认删除"}
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* 应用设置中心弹窗（Ctrl + ,）。 */}
          <SettingsModal open={settingsModalOpen} onClose={() => setSettingsModalOpen(false)} />

          {/* 统一日志与 SQL 审计中心弹窗。 */}
          <LogAuditModal
            open={logAuditModalOpen}
            onClose={() => setLogAuditModalOpen(false)}
            sources={queryPanelViewState.sources}
          />

          {/* 驱动管理弹窗：展示全部已接入数据源驱动及其能力声明。 */}
          {driverManagerOpen && (
            <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/25 backdrop-blur-[2px]">
              <div className="w-[560px] max-w-[92vw] rounded-2xl border border-base-300 bg-base-100 p-4 shadow-2xl">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2 text-[14px] font-semibold">
                    <Cpu size={16} className="text-primary" />
                    <span>数据源驱动管理</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDriverManagerOpen(false)}
                    className="flex h-7 w-7 items-center justify-center rounded-lg text-neutral/70 hover:bg-base-200"
                  >
                    <X size={15} />
                  </button>
                </div>
                <div className="space-y-2.5">
                  {registeredDrivers.map((driver) => (
                    <div
                      key={driver.kind}
                      className="rounded-xl border border-base-300/80 bg-base-200/35 p-3 text-[12px]"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className={`rounded px-1.5 py-0.5 text-[11px] font-semibold ${driver.badgeClassName}`}>
                            {driver.badgeLabel}
                          </span>
                          <span className="font-semibold">{driver.displayName}</span>
                        </div>
                        <span className="font-mono text-[11px] text-neutral/60">
                          lang: {driver.capabilities.queryLanguage}
                        </span>
                      </div>
                      <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] text-neutral/75">
                        <span className="rounded bg-base-100 px-2 py-0.5">
                          DDL: {driver.capabilities.supportsDdl ? "支持" : "不支持"}
                        </span>
                        <span className="rounded bg-base-100 px-2 py-0.5">
                          事务批量提交: {driver.capabilities.supportsTransactionalBatch ? "支持" : "不支持"}
                        </span>
                        <span className="rounded bg-base-100 px-2 py-0.5">
                          SQL 预览: {driver.capabilities.supportsMutationPreview ? "支持" : "不支持"}
                        </span>
                        <span className="rounded bg-base-100 px-2 py-0.5">
                          空值占位: {driver.gridAdapter.nullPlaceholder}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </>
      }
    >
      {/* 三栏 Islands 浮岛内容区：中央工作区列（主面板 + VSCode 风格底部终端抽屉）+ 可选右侧停靠插件浮岛。 */}
      <div className="flex h-full min-h-0 w-full gap-1.5 overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-1.5 overflow-hidden">
          <div className="relative min-h-0 min-w-0 flex-1 overflow-hidden rounded-xl border border-base-300/80 bg-base-100 shadow-2xs">
            {/* Query 工作区：首帧直接挂载且常驻保活，后台水合数据源不阻塞用户交互。 */}
            {queryPanelMounted && (
              <div
                className={
                  shouldMountQueryPanel(viewMode, startupState.complete)
                    ? "absolute inset-0 z-10 h-full w-full"
                    : "absolute inset-0 z-0 h-full w-full invisible pointer-events-none"
                }
                aria-hidden={!shouldMountQueryPanel(viewMode, startupState.complete)}
              >
                <QueryPanel viewState={queryPanelViewState} actions={queryPanelActions} />
              </div>
            )}

            {/* 工具/插件视图：优先渲染已选工作区插件，否则渲染传统工具面板。 */}
            {viewMode === "tools" && (
              <div className="absolute inset-0 z-10 h-full w-full">
                {activeWorkspacePluginId && workspacePluginContext ? (
                  <PluginHost pluginId={activeWorkspacePluginId} ctx={workspacePluginContext} />
                ) : (
                  <Suspense fallback={<WorkspaceLoadingFallback title="正在加载工具面板" />}>
                    <LazyToolsPanel />
                  </Suspense>
                )}
              </div>
            )}
          </div>

          {/* VSCode 风格底部集成终端抽屉：支持 Ctrl + ` 呼出/收起，隐藏时 PTY 进程持续保活。 */}
          <BottomConsoleDrawer
            open={bottomConsoleOpen}
            onOpen={() => setBottomConsoleOpen(true)}
            onClose={() => setBottomConsoleOpen(false)}
          />
        </div>

        {/* 右侧停靠插件浮岛（如命令库 / 局域网文件接收）。 */}
        {rightDockPluginId && dockPluginContext && (
          <aside className="flex h-full w-[320px] shrink-0 flex-col overflow-hidden rounded-xl border border-base-300/80 bg-base-100 shadow-2xs">
            <div className="flex h-9 shrink-0 items-center justify-between border-b border-base-300/70 px-3 text-[12px]">
              <span className="font-semibold">{getPlugin(rightDockPluginId)?.name || "插件面板"}</span>
              <button
                type="button"
                onClick={() => setRightDockPluginId(null)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-neutral/70 hover:bg-base-200"
              >
                <X size={13} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-hidden">
              <PluginHost pluginId={rightDockPluginId} ctx={dockPluginContext} />
            </div>
          </aside>
        )}
      </div>
    </AppShellLayout>
  );
}

// 新版本提示通知载荷：包含版本差异与原生热更新句柄。
type VersionUpdateNoticeState = {
  currentVersion: string;
  latestVersion: string;
  nativeUpdate: Update | null;
  installing?: boolean;
  progressText?: string;
};

// 启动时检查 GitHub 最新版本；若有更新则触发右上角升级通知。
async function checkLatestVersionOnStartup(onFoundNewVersion: (payload: VersionUpdateNoticeState) => void): Promise<void> {
  try {
    const result = await checkAppUpdateWithFallback();
    if (!result?.hasUpdate) return;
    // 命中新版本后先让出 UI 一帧，减少通知出现瞬间与启动尾任务竞争主线程。
    await waitForUiIdleFrame();
    onFoundNewVersion({
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion,
      nativeUpdate: result.nativeUpdate
    });
  } catch (error) {
    // 版本检查失败不影响业务启动，只打印调试日志。
    console.warn("启动版本检查失败：", error);
  }
}
