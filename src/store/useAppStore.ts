import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { TabState } from "../types";
import { tauriSqliteStorage } from "./tauriStorage";

// 主页面视图模式：用于左侧工具栏的页面切换。
export type MainViewMode = "query" | "soqlExecutor" | "systemLogs" | "settings";

// Tab 持久化时保留的字段子集：排除运行时/瞬态状态，减小存储体积。
type PersistedTabState = Pick<
  TabState,
  | "objectName"
  | "label"
  | "whereClause"
  | "limit"
  | "sortField"
  | "sortDirection"
  | "soqlDraft"
  | "currentSoql"
  | "showQueryBar"
  | "showDrawer"
  | "showLogs"
  | "logs"
  | "columnVisibility"
>;

// 将持久化快照恢复为完整 TabState，补全被排除的运行时字段默认值。
function hydrateTab(persisted: PersistedTabState): TabState {
  return {
    ...persisted,
    describe: null,
    result: { totalSize: 0, records: [] },
    selectedRecordIds: [],
    pendingDeleteRecordIds: [],
    dirtyCellKeys: [],
    baselineRecords: {},
    notice: null,
    loading: false
  };
}

// 全局应用状态：集中管理 Tab、视图模式与基础 UI 状态。
type AppState = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 主页面视图模式。
  viewMode: MainViewMode;
  // SOQL 执行器左侧栏宽度（像素）。
  soqlSidebarWidth: number;
  // 已打开的对象 Tab 列表。
  tabs: TabState[];
  // 当前激活的对象名称。
  activeTabObjectName: string;
  // 页面级全局加载标记。
  loading: boolean;
  // 更新选中数据源。
  setSelectedSourceId: (sourceId: string) => void;
  // 更新视图模式。
  setViewMode: (viewMode: MainViewMode) => void;
  // 更新 SOQL 侧栏宽度。
  setSoqlSidebarWidth: (width: number) => void;
  // 更新激活的 Tab。
  setActiveTabObjectName: (objectName: string) => void;
  // 批量设置 Tab 列表或使用更新函数。
  setTabs: (tabs: TabState[] | ((tabs: TabState[]) => TabState[])) => void;
  // 更新全局加载状态。
  setLoading: (loading: boolean) => void;
  // 对指定 Tab 打补丁更新。
  patchTab: (objectName: string, updater: (tab: TabState) => TabState) => void;
  // 关闭指定 Tab。
  closeTab: (objectName: string) => void;
  // 清空所有 Tab。
  resetTabs: () => void;
};

// Zustand Store：提供简洁的状态更新 API，通过 persist 中间件自动持久化到 SQLite。
export const useAppStore = create<AppState>()(
  persist(
    (set, get) => ({
      selectedSourceId: "",
      viewMode: "query" as MainViewMode,
      soqlSidebarWidth: 320,
      tabs: [],
      activeTabObjectName: "",
      loading: false,
      setSelectedSourceId: (sourceId) => set({ selectedSourceId: sourceId }),
      setViewMode: (viewMode) => set({ viewMode }),
      setSoqlSidebarWidth: (width) => set({ soqlSidebarWidth: Math.max(240, Math.min(1200, Math.round(width))) }),
      setActiveTabObjectName: (objectName) => set({ activeTabObjectName: objectName }),
      setTabs: (tabs) =>
        set((state) => ({
          tabs: typeof tabs === "function" ? tabs(state.tabs) : tabs
        })),
      setLoading: (loading) => set({ loading }),
      patchTab: (objectName, updater) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.objectName === objectName ? updater(tab) : tab))
        }));
      },
      closeTab: (objectName) => {
        const { tabs, activeTabObjectName } = get();
        const nextTabs = tabs.filter((tab) => tab.objectName !== objectName);
        const nextActive = activeTabObjectName === objectName ? nextTabs[0]?.objectName || "" : activeTabObjectName;
        set({ tabs: nextTabs, activeTabObjectName: nextActive });
      },
      resetTabs: () => set({ tabs: [], activeTabObjectName: "" })
    }),
    {
      name: "ui.app-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 跳过自动 hydration，由 MainPage 启动流程手动控制恢复时机，
      // 避免异步 hydration 与初始化逻辑竞态导致默认值覆盖已存储数据。
      skipHydration: true,
      // 只持久化需要保存的字段，排除 loading 等运行时状态。
      partialize: (state) => ({
        selectedSourceId: state.selectedSourceId,
        viewMode: state.viewMode,
        soqlSidebarWidth: state.soqlSidebarWidth,
        activeTabObjectName: state.activeTabObjectName,
        tabs: state.tabs.map((tab): PersistedTabState => ({
          objectName: tab.objectName,
          label: tab.label,
          whereClause: tab.whereClause,
          limit: tab.limit,
          sortField: tab.sortField,
          sortDirection: tab.sortDirection,
          soqlDraft: tab.soqlDraft,
          currentSoql: tab.currentSoql,
          showQueryBar: tab.showQueryBar,
          showDrawer: tab.showDrawer,
          showLogs: tab.showLogs,
          logs: tab.logs,
          columnVisibility: tab.columnVisibility
        }))
      }),
      // 从持久化快照恢复时，补全每个 Tab 被排除的运行时字段。
      merge: (persisted, current) => {
        const state = persisted as Partial<AppState>;
        return {
          ...current,
          ...state,
          // 恢复 tabs 时补全运行时字段。
          tabs: Array.isArray(state.tabs)
            ? state.tabs.map((tab) => hydrateTab(tab as unknown as PersistedTabState))
            : current.tabs,
          // loading 始终从默认值开始。
          loading: false
        };
      }
    }
  )
);
