import { useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getVersion } from "@tauri-apps/api/app";
import { Settings, SquareTerminal, Table2 } from "lucide-react";
import { api } from "../api";
import { QueryPanel } from "../features/main/QueryPanel";
import { useMainPageQueryPanel } from "../features/main/QueryPanel/hooks/useMainPageQueryPanel";
import { SettingsPanel } from "../features/main/SettingsPanel";
import { TerminalPanel } from "../features/main/TerminalPanel";
import { MainLayout } from "../layouts/MainLayout";
import { useAppStore } from "../store/useAppStore";
import { useSoqlExecutorStore } from "../store/useSoqlExecutorStore";
import { enableStorageWrite } from "../store/tauriStorage";

// GitHub Releases 固定地址：用于更新提示中的展示与跳转。
const GITHUB_RELEASE_PAGE_URL = "https://github.com/hi-liyan/simple-salesforce-tool/releases";
// GitHub Latest Release API：用于读取最新版本号并做对比。
const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/hi-liyan/simple-salesforce-tool/releases/latest";
// 启动版本检查标志：避免 React StrictMode 在开发环境重复触发弹窗。
let startupVersionCheckTriggered = false;

// 主页面：对象列表 + 结果面板 + SOQL 抽屉。
export function MainPage() {
  // Store：视图模式与侧栏宽度（已通过 Zustand persist 自动持久化到 SQLite）。
  const viewMode = useAppStore((state) => state.viewMode);
  const setViewMode = useAppStore((state) => state.setViewMode);
  const soqlSidebarWidth = useAppStore((state) => state.soqlSidebarWidth);
  const setSoqlSidebarWidth = useAppStore((state) => state.setSoqlSidebarWidth);

  // 启动画面状态：首次初始化完成前显示全屏遮罩，避免用户误以为卡死。
  const [startupLoading, setStartupLoading] = useState(true);
  // 启动完成标记：用于在 QueryPanel 聚合层触发“数据源切换重置 Tab”逻辑。
  const [startupComplete, setStartupComplete] = useState(false);
  // 新版本提示模态框状态：有值时显示升级弹窗。
  const [versionUpdateModal, setVersionUpdateModal] = useState<VersionUpdateModalState | null>(null);
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
    startupComplete,
    tokenRefreshing
  });

  // 初始化加载：先恢复本地持久化状态，再将 CLI 同步放到后台静默执行。
  useEffect(() => {
    let active = true;

    const setup = async () => {
      // 手动触发 rehydrate（skipHydration: true），从 SQLite 恢复持久化状态。
      await Promise.all([useAppStore.persist.rehydrate(), useSoqlExecutorStore.persist.rehydrate()]);
      if (!active) return;

      // rehydrate 完成且确认组件仍存活后，才开启写入门控。
      enableStorageWrite();

      // hydration 完成后从 store 读取持久化的数据源 ID。
      const persistedSourceId = useAppStore.getState().selectedSourceId;
      // 首屏只恢复本地数据源与上次选择，避免 CLI 同步和对象强刷阻塞启动遮罩。
      await refreshSources(false, undefined, persistedSourceId, {
        forceObjectRefresh: false
      });
      if (!active) return;

      // 首次初始化结束后关闭启动遮罩，并标记启动完成。
      setStartupLoading(false);
      setStartupComplete(true);

      // 异步重新拉取恢复的 Tab 数据（describe + query），不阻塞主界面。
      const finalSelectedSourceId = useAppStore.getState().selectedSourceId;
      void reloadRestoredTabs(finalSelectedSourceId);

      // 启动后在后台静默同步 CLI 数据源，不再影响首屏可交互时间。
      void refreshSources(true, undefined, finalSelectedSourceId, {
        forceObjectRefresh: false,
        showLoading: false
      });

      if (!startupVersionCheckTriggered) {
        startupVersionCheckTriggered = true;
        void checkLatestVersionOnStartup(showVersionUpdateModal);
      }
    };

    void setup();
    return () => {
      active = false;
    };
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

  // 记录 Terminal 是否访问过：一旦访问即常驻挂载，仅通过显示/隐藏切换。
  useEffect(() => {
    if (viewMode !== "terminal") return;
    setTerminalPanelMounted(true);
  }, [viewMode]);

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

  // 版本检查命中时展示升级模态框。
  function showVersionUpdateModal(payload: VersionUpdateModalState) {
    setVersionUpdateModal(payload);
  }

  // 关闭升级模态框。
  function closeVersionUpdateModal() {
    setVersionUpdateModal(null);
  }

  // 点击“前往更新”：由后端调用系统浏览器打开发布页，避免 window.open。
  async function handleConfirmVersionUpdateModal() {
    if (!versionUpdateModal) return;
    try {
      await api.openExternalUrl(versionUpdateModal.releasePageUrl);
      setVersionUpdateModal(null);
    } catch (error) {
      showWorkspaceNotice(
        {
          type: "error",
          message: `打开发布页失败：${String(error)}`
        },
        5000
      );
    }
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
            {/* Query 工作区：对象树 + 数据/控制台统一 Tab。 */}
            {viewMode === "query" && <QueryPanel viewState={queryPanelViewState} actions={queryPanelActions} />}
            {/* Terminal 工作区：首次进入后常驻挂载，切换视图仅隐藏，避免终端进程重建。 */}
            {terminalPanelMounted && (
              <div className={viewMode === "terminal" ? "h-full w-full" : "hidden h-full w-full"}>
                <TerminalPanel visible={viewMode === "terminal"} />
              </div>
            )}
            {/* 设置视图。 */}
            {viewMode === "settings" && <SettingsPanel />}
          </>
        }
      />
      {versionUpdateModal && (
        // 新版本提示模态框：统一替代 confirm + 通知的双提示流程。
        <div className="fixed inset-0 z-[130] flex items-center justify-center bg-base-300/45 p-4 backdrop-blur-[2px]">
          {/* 模态框卡片：展示版本信息与更新入口。 */}
          <div className="w-full max-w-xl rounded-xl border border-base-300 bg-base-100 p-6 shadow-2xl">
            {/* 标题区：强调发现新版本。 */}
            <div className="mb-3">
              <h3 className="text-lg font-semibold">检测到新版本</h3>
              <p className="mt-1 text-sm text-neutral/70">发现可用更新，是否现在前往 GitHub Releases 页面查看并下载？</p>
            </div>
            {/* 版本信息：便于快速确认升级差异。 */}
            <div className="rounded-lg border border-base-300 bg-base-200/60 p-3 text-sm">
              <p>
                <span className="text-neutral/70">当前版本：</span>
                <span className="font-medium">{versionUpdateModal.currentVersion}</span>
              </p>
              <p className="mt-1">
                <span className="text-neutral/70">最新版本：</span>
                <span className="font-medium text-primary">{versionUpdateModal.latestVersion}</span>
              </p>
              <p className="mt-1 break-all text-xs text-neutral/70">{versionUpdateModal.releasePageUrl}</p>
            </div>
            {/* 操作区：支持暂不更新或立即前往发布页。 */}
            <div className="mt-5 flex justify-end gap-2">
              <button className="btn btn-ghost" onClick={closeVersionUpdateModal}>
                稍后再说
              </button>
              <button className="btn btn-primary" onClick={() => void handleConfirmVersionUpdateModal()}>
                前往更新
              </button>
            </div>
          </div>
        </div>
      )}
      {startupLoading && (
        // 启动遮罩：初始化期间覆盖全屏并拦截鼠标事件。
        <div className="fixed inset-0 z-[120] flex items-center justify-center bg-base-200/95 backdrop-blur-sm">
          {/* 启动卡片：展示加载状态与提示文案。 */}
          <div className="w-[380px] rounded-xl border border-base-300 bg-base-100 p-6 shadow-xl">
            <div className="flex items-center gap-3">
              <span className="loading loading-spinner text-primary" style={{ width: 26, height: 26 }} />
              <div className="min-w-0">
                <p className="text-[14px] font-semibold">正在启动应用</p>
                <p className="mt-1 text-[12px] text-neutral/70">正在加载数据源与对象元数据，请稍候...</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// GitHub Latest Release API 返回结构：仅取版本号字段即可完成比较。
type GithubLatestReleasePayload = {
  tag_name?: string;
};

// 新版本提示模态框载荷：包含版本差异与发布页地址。
type VersionUpdateModalState = {
  currentVersion: string;
  latestVersion: string;
  releasePageUrl: string;
};

// 语义版本结构：拆分主版本段与预发布标签，便于稳定比较。
type ParsedSemanticVersion = {
  coreParts: number[];
  preRelease: string | null;
};

// 启动时检查 GitHub 最新版本；若有更新则触发升级模态框。
async function checkLatestVersionOnStartup(onFoundNewVersion: (payload: VersionUpdateModalState) => void): Promise<void> {
  try {
    const currentVersion = (await getVersion()).trim();
    if (!currentVersion) return;

    const latestVersion = await fetchLatestGithubReleaseVersion();
    if (!latestVersion) return;
    if (!isGithubVersionNewer(currentVersion, latestVersion)) return;
    onFoundNewVersion({
      currentVersion,
      latestVersion,
      releasePageUrl: GITHUB_RELEASE_PAGE_URL
    });
  } catch (error) {
    // 版本检查失败不影响业务启动，只打印调试日志。
    console.warn("启动版本检查失败：", error);
  }
}

// 拉取 GitHub 最新发布版本号（tag_name），失败时返回 null。
async function fetchLatestGithubReleaseVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as GithubLatestReleasePayload;
  const version = (payload.tag_name ?? "").trim();
  return version || null;
}

// 判断 GitHub 版本是否高于当前版本。
function isGithubVersionNewer(currentVersion: string, latestVersion: string): boolean {
  return compareSemanticVersion(latestVersion, currentVersion) > 0;
}

// 比较两个语义版本：返回 1 表示 left 更新，-1 表示 right 更新，0 表示相等。
function compareSemanticVersion(leftVersion: string, rightVersion: string): number {
  // 比较前统一忽略版本号前缀 `v/V`，避免 `v1.2.3` 与 `1.2.3` 被误判为不相等。
  const normalizedLeftVersion = leftVersion.trim().replace(/^[vV]/, "");
  const normalizedRightVersion = rightVersion.trim().replace(/^[vV]/, "");
  const left = parseSemanticVersion(normalizedLeftVersion);
  const right = parseSemanticVersion(normalizedRightVersion);
  if (!left || !right) {
    // 兜底比较：非标准版本格式时使用带数字感知的字符串比较。
    return normalizedLeftVersion.localeCompare(normalizedRightVersion, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  const compareLength = Math.max(left.coreParts.length, right.coreParts.length);
  for (let index = 0; index < compareLength; index += 1) {
    const leftPart = left.coreParts[index] ?? 0;
    const rightPart = right.coreParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  const leftIsStable = !left.preRelease;
  const rightIsStable = !right.preRelease;
  // 主版本一致时：正式版 > 预发布版。
  if (leftIsStable && !rightIsStable) return 1;
  if (!leftIsStable && rightIsStable) return -1;
  if (left.preRelease && right.preRelease) {
    return left.preRelease.localeCompare(right.preRelease, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }
  return 0;
}

// 解析语义版本字符串，兼容 `v1.2.3` 与 `1.2.3-beta.1`。
function parseSemanticVersion(rawVersion: string): ParsedSemanticVersion | null {
  const normalizedVersion = rawVersion.trim().replace(/^[vV]/, "");
  if (!normalizedVersion) return null;

  const [coreSegment, preReleaseSegment = ""] = normalizedVersion.split("-", 2);
  if (!/^\d+(\.\d+)*$/.test(coreSegment)) return null;

  return {
    coreParts: coreSegment.split(".").map((part) => Number.parseInt(part, 10)),
    preRelease: preReleaseSegment.trim() || null
  };
}
