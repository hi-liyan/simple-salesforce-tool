import { Suspense, lazy, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Settings, SquareTerminal, Table2, Wrench } from "lucide-react";
import { NoticeAlert } from "../components/NoticeAlert";
import { useMainPageQueryPanel } from "../features/main/QueryPanel/hooks/useMainPageQueryPanel";
import { MainLayout } from "../layouts/MainLayout";
import { useAppStore } from "../store/useAppStore";
import { useSoqlExecutorStore } from "../store/useSoqlExecutorStore";
import { useTerminalStore } from "../store/useTerminalStore";
import { useQueryWorkspaceTabsStore } from "../store/useQueryWorkspaceTabsStore";
import { useQuerySourceTreeStore } from "../store/useQuerySourceTreeStore";
import { enableStorageWrite } from "../store/tauriStorage";
import { checkGithubLatestVersion, waitForUiIdleFrame } from "../utils/versionUpdate";
import { createStartupCoordinator, shouldMountQueryPanel } from "./mainPageStartup";
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

// 懒加载 Query 工作区：将 DataGrid / 控制台等较重 UI 拆出首包。
const LazyQueryPanel = lazy(async () => {
  const module = await import("../features/main/QueryPanel");
  return {
    default: module.QueryPanel
  };
});

// 懒加载 Terminal 工作区：将 xterm 与 Monaco 等重模块延后到首次进入时再加载。
const LazyTerminalPanel = lazy(async () => {
  const module = await import("../features/main/TerminalPanel");
  return {
    default: module.TerminalPanel
  };
});

// 懒加载设置页：避免首屏加载非当前视图所需表单与管理逻辑。
const LazySettingsPanel = lazy(async () => {
  const module = await import("../features/main/SettingsPanel");
  return {
    default: module.SettingsPanel
  };
});

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
  const resetTerminalWorkspace = useTerminalStore((state) => state.resetTerminalWorkspace);

  // 启动画面快照：由模块级协调器托管，避免 StrictMode 双挂载重复执行启动重任务。
  const [startupState, setStartupState] = useState(() => mainPageStartupCoordinator.getSnapshot());
  // 新版本提示通知状态：有值时在右上角显示升级通知。
  const [versionUpdateNotice, setVersionUpdateNotice] = useState<VersionUpdateNoticeState | null>(null);
  // Terminal 面板是否已初始化：首次进入 Terminal 后保持挂载，避免切页时重建会话。
  const [terminalPanelMounted, setTerminalPanelMounted] = useState(viewMode === "terminal");

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
      // 终端工作区不参与启动恢复：每次启动都从空白标签开始。
      resetTerminalWorkspace();
      // 同步移除历史终端快照，避免后续误触发恢复旧 Tab。
      try {
        await Promise.resolve(useTerminalStore.persist.clearStorage());
      } catch {
        // 清理失败不阻断主界面启动，其它面板仍应继续恢复。
      }

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
  }, [compactPersistedTabsSnapshot, refreshSources, reloadRestoredTabs, resetTerminalWorkspace]);

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

  // 记录 Terminal 是否访问过：一旦访问即常驻挂载，仅通过显示/隐藏切换。
  useEffect(() => {
    if (viewMode !== "terminal") return;
    setTerminalPanelMounted(true);
  }, [viewMode]);

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

  return (
    // 页面容器：用于承载主布局与启动遮罩层。
    <div className="relative h-full w-full">
      {/* 主布局：MainPage 统一承接导航 rail 与三视图编排。 */}
      <MainLayout
        navRail={
          // 导航栏按钮区。
          <div className="flex flex-col items-center gap-1 py-2">
            {/* Query 工作区入口。 */}
            <button
              className={`tool-rail-btn ${viewMode === "query" ? "tool-rail-btn--active" : ""}`}
              title="Query 布局"
              onClick={() => queryPanelActions.onSetViewMode("query")}
            >
              <Table2 size={16} />
            </button>
            {/* Terminal 工作区入口。 */}
            <button
              className={`tool-rail-btn ${viewMode === "terminal" ? "tool-rail-btn--active" : ""}`}
              title="Terminal 布局"
              onClick={() => queryPanelActions.onSetViewMode("terminal")}
            >
              <SquareTerminal size={16} />
            </button>
            {/* 工具面板入口。 */}
            <button
              className={`tool-rail-btn ${viewMode === "tools" ? "tool-rail-btn--active" : ""}`}
              title="工具面板"
              onClick={() => queryPanelActions.onSetViewMode("tools")}
            >
              <Wrench size={16} />
            </button>
            {/* 设置入口。 */}
            <button
              className={`tool-rail-btn ${viewMode === "settings" ? "tool-rail-btn--active" : ""}`}
              title="设置"
              onClick={() => queryPanelActions.onSetViewMode("settings")}
            >
              <Settings size={16} />
            </button>
          </div>
        }
        content={
          <>
            {/* Query 工作区：对象树 + 数据/控制台统一 Tab，首次进入时按需加载。 */}
            {shouldMountQueryPanel(viewMode, startupState.complete) && (
              <Suspense fallback={<WorkspaceLoadingFallback title="正在加载 Query 工作区" />}>
                {/* Query 工作区主体。 */}
                <LazyQueryPanel viewState={queryPanelViewState} actions={queryPanelActions} />
              </Suspense>
            )}
            {/* Terminal 工作区：首次进入后常驻挂载，切换视图仅隐藏，避免终端进程重建。 */}
            {terminalPanelMounted && (
              <div className={viewMode === "terminal" ? "h-full w-full" : "hidden h-full w-full"}>
                <Suspense fallback={<WorkspaceLoadingFallback title="正在加载 Terminal 工作区" />}>
                  {/* Terminal 工作区主体。 */}
                  <LazyTerminalPanel visible={viewMode === "terminal"} />
                </Suspense>
              </div>
            )}
            {/* 工具视图：首次进入时按需加载。 */}
            {viewMode === "tools" && (
              <Suspense fallback={<WorkspaceLoadingFallback title="正在加载工具面板" />}>
                {/* 工具面板主体。 */}
                <LazyToolsPanel />
              </Suspense>
            )}
            {/* 设置视图：首次进入时按需加载。 */}
            {viewMode === "settings" && (
              <Suspense fallback={<WorkspaceLoadingFallback title="正在加载设置页" />}>
                {/* 设置页主体。 */}
                <LazySettingsPanel />
              </Suspense>
            )}
          </>
        }
      />
      {versionUpdateNotice && (
        <NoticeAlert
          // 启动更新通知：仅提示存在新版本，引导用户到设置页查看下载信息。
          tone="success"
          message={`发现新版本：当前 ${versionUpdateNotice.currentVersion}，最新 ${versionUpdateNotice.latestVersion}。可前往 设置 -> 关于与反馈 查看下载信息。`}
          onClose={closeVersionUpdateNotice}
          className="fixed right-4 top-4 z-[70] max-w-[380px] shadow-lg"
        />
      )}
      {startupState.loading && (
        // 启动遮罩：初始化期间覆盖全屏并拦截鼠标事件。
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-base-200/95 backdrop-blur-sm">
          {/* 启动卡片：展示加载状态、进度条与当前动作。 */}
          <div className="w-[420px] rounded-xl border border-base-300 bg-base-100 p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="loading loading-spinner text-primary" style={{ width: 26, height: 26 }} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">正在启动应用</p>
                <p className="mt-1 text-[12px] text-neutral/70">{startupState.stage.detail}</p>
              </div>
            </div>
            {/* 进度条：显示当前启动进度与动作名称。 */}
            <div className="mt-5">
              <div className="mb-2 flex items-center justify-between text-[12px] text-neutral/70">
                <span>{startupState.stage.label}</span>
                <span>{startupState.stage.progress}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-base-300">
                <div
                  className="h-full rounded-full bg-primary transition-all duration-300 ease-out"
                  style={{ width: `${startupState.stage.progress}%` }}
                />
              </div>
            </div>
            {/* 启动步骤清单：帮助用户理解遮罩阶段当前做了哪些动作。 */}
            <div className="mt-4 space-y-2">
              {startupStageItems.map((stage) => (
                <div
                  key={stage.key}
                  className={`flex items-center justify-between rounded-lg px-3 py-2 text-[12px] ${
                    stage.isCurrentStage
                      ? "bg-primary/10 text-primary"
                      : stage.isCompletedStage
                        ? "bg-success/10 text-success"
                        : "bg-base-200/70 text-neutral/60"
                  }`}
                >
                  {/* 步骤名称：说明当前启动流程的具体动作。 */}
                  <span>{stage.label}</span>
                  {/* 步骤状态：标记已完成、进行中或待开始。 */}
                  <span>{stage.statusText}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// 新版本提示通知载荷：包含版本差异与发布页地址。
type VersionUpdateNoticeState = {
  currentVersion: string;
  latestVersion: string;
};

// 启动时检查 GitHub 最新版本；若有更新则触发右上角升级通知。
async function checkLatestVersionOnStartup(onFoundNewVersion: (payload: VersionUpdateNoticeState) => void): Promise<void> {
  try {
    const result = await checkGithubLatestVersion();
    if (!result?.hasUpdate) return;
    // 命中新版本后先让出 UI 一帧，减少通知出现瞬间与启动尾任务竞争主线程。
    await waitForUiIdleFrame();
    onFoundNewVersion({
      currentVersion: result.currentVersion,
      latestVersion: result.latestVersion
    });
  } catch (error) {
    // 版本检查失败不影响业务启动，只打印调试日志。
    console.warn("启动版本检查失败：", error);
  }
}
