import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { buildObjectTabBindingKey, type TabState } from "../types/index.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";
import { hydrateTab } from "./queryTabHydration.ts";

// 主页面视图模式：支持 Query 工作区、Terminal 工作区、工具页与设置页入口。
export type MainViewMode = "query" | "terminal" | "tools" | "settings";

// 旧版按 source 分桶的对象 Tab 持久化结构：用于历史快照兼容迁移。
type LegacyPersistedSourceTabState = {
  tabs: Partial<TabState>[];
  activeTabObjectName: string;
};

// 旧版对象 Tab 持久化结构：兼容 source 分桶恢复。
type LegacyAppState = {
  selectedSourceId?: string;
  viewMode?: string;
  soqlSidebarWidth?: number;
  sourceTabStateBySourceId?: Record<string, LegacyPersistedSourceTabState>;
  tabs?: Partial<TabState>[];
  activeTabObjectName?: string;
};

// 归一化视图模式：清理历史分裂视图值，统一进入 QueryPanel 工作区。
function normalizeMainViewMode(viewMode: string | undefined): MainViewMode {
  if (viewMode === "settings") return "settings";
  if (viewMode === "terminal") return "terminal";
  if (viewMode === "tools") return "tools";
  if (viewMode === "query") return "query";
  // 兼容旧值：systemLogs 已迁移到 settings，soqlExecutor 已并入 query。
  if (viewMode === "systemLogs") return "settings";
  return "query";
}

// 为 Tab 补齐稳定唯一键：兼容历史快照缺少 bindingKey 的场景。
function ensureTabBindingKey(tab: TabState): TabState {
  if (tab.bindingKey) return tab;
  return {
    ...tab,
    bindingKey: buildObjectTabBindingKey(tab.sourceId || "", tab.objectName || "")
  };
}

// 获取 Tab 唯一键：优先使用持久化字段，缺失时按 sourceId + objectName 推导。
function getTabBindingKey(tab: TabState): string {
  return tab.bindingKey || buildObjectTabBindingKey(tab.sourceId || "", tab.objectName || "");
}

// 判断给定标识是否命中 Tab：优先按 bindingKey，其次兼容 objectName 调用方。
function isTabMatchedByIdentity(tab: TabState, tabIdentity: string): boolean {
  return getTabBindingKey(tab) === tabIdentity || tab.objectName === tabIdentity;
}

// 归一化对象 Tab 持久化快照：兼容旧版按 source 分桶结构，并保留所有来源的 data tabs。
function normalizePersistedTabs(state: Partial<LegacyAppState>): { tabs: TabState[]; activeTabObjectName: string } {
  const tabMap = new Map<string, TabState>();

  if (Array.isArray(state.tabs)) {
    state.tabs.forEach((tab) => {
      const hydratedTab = ensureTabBindingKey(hydrateTab(tab));
      tabMap.set(hydratedTab.bindingKey, hydratedTab);
    });
  }

  if (state.sourceTabStateBySourceId && typeof state.sourceTabStateBySourceId === "object") {
    Object.values(state.sourceTabStateBySourceId).forEach((sourceState) => {
      if (!sourceState || typeof sourceState !== "object" || !Array.isArray(sourceState.tabs)) return;
      sourceState.tabs.forEach((tab) => {
        const hydratedTab = ensureTabBindingKey(hydrateTab(tab));
        tabMap.set(hydratedTab.bindingKey, hydratedTab);
      });
    });
  }

  const tabs = Array.from(tabMap.values());
  const currentActiveTabObjectName = typeof state.activeTabObjectName === "string" ? state.activeTabObjectName : "";
  if (currentActiveTabObjectName && tabs.some((tab) => isTabMatchedByIdentity(tab, currentActiveTabObjectName))) {
    return { tabs, activeTabObjectName: currentActiveTabObjectName };
  }

  const selectedSourceId = typeof state.selectedSourceId === "string" ? state.selectedSourceId : "";
  if (selectedSourceId && state.sourceTabStateBySourceId?.[selectedSourceId]?.activeTabObjectName) {
    const legacyActiveTabObjectName = state.sourceTabStateBySourceId[selectedSourceId]?.activeTabObjectName || "";
    if (tabs.some((tab) => isTabMatchedByIdentity(tab, legacyActiveTabObjectName))) {
      return { tabs, activeTabObjectName: legacyActiveTabObjectName };
    }
  }

  return {
    tabs,
    activeTabObjectName: tabs[0]?.bindingKey || ""
  };
}

// 全局应用状态：集中管理 Tab、视图模式与基础 UI 状态。
type AppState = {
  // 当前选中的数据源 ID：仍用于左侧对象缓存与“新建控制台默认来源”等兼容场景。
  selectedSourceId: string;
  // 主页面视图模式。
  viewMode: MainViewMode;
  // SOQL 执行器左侧栏宽度（像素）。
  soqlSidebarWidth: number;
  // 已打开的对象 Tab 列表：改为全局列表，不再按 source 分桶恢复。
  tabs: TabState[];
  // 当前激活的对象唯一标识（优先 bindingKey）。
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
  // 对指定 Tab 打补丁更新：支持 bindingKey 或 objectName（兼容旧调用）。
  patchTab: (tabIdentity: string, updater: (tab: TabState) => TabState) => void;
  // 关闭指定 Tab。
  closeTab: (tabIdentity: string) => void;
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
      setViewMode: (viewMode) => set({ viewMode: normalizeMainViewMode(viewMode) }),
      setSoqlSidebarWidth: (width) => set({ soqlSidebarWidth: Math.max(240, Math.min(1200, Math.round(width))) }),
      setActiveTabObjectName: (objectName) => set({ activeTabObjectName: objectName }),
      setTabs: (tabs) =>
        set((state) => ({
          tabs: (typeof tabs === "function" ? tabs(state.tabs) : tabs).map((tab) => ensureTabBindingKey(tab))
        })),
      setLoading: (loading) => set({ loading }),

      patchTab: (tabIdentity, updater) => {
        set((state) => {
          let changed = false;
          const nextTabs = state.tabs.map((tab) => {
            if (!isTabMatchedByIdentity(tab, tabIdentity)) return tab;
            changed = true;
            const nextTab = updater(ensureTabBindingKey(tab));
            return ensureTabBindingKey(nextTab);
          });
          if (!changed) return state;
          return {
            tabs: nextTabs
          };
        });
      },

      closeTab: (tabIdentity) => {
        const { tabs, activeTabObjectName } = get();
        const nextTabs = tabs.filter((tab) => !isTabMatchedByIdentity(tab, tabIdentity));
        const activeTabMatched = tabs.some((tab) => isTabMatchedByIdentity(tab, activeTabObjectName) && isTabMatchedByIdentity(tab, tabIdentity));
        const nextActiveTabObjectName = activeTabMatched ? nextTabs[0]?.bindingKey || "" : activeTabObjectName;
        set({
          tabs: nextTabs,
          activeTabObjectName: nextActiveTabObjectName
        });
      },

      resetTabs: () =>
        set({
          tabs: [],
          activeTabObjectName: ""
        })
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
        tabs: state.tabs,
        activeTabObjectName: state.activeTabObjectName
      }),
      // 从持久化快照恢复时，兼容历史 source 分桶结构并扁平化为全局 tabs。
      merge: (persisted, current) => {
        const state = persisted as Partial<LegacyAppState>;
        const normalized = normalizePersistedTabs(state);
        return {
          ...current,
          ...state,
          viewMode: normalizeMainViewMode(state.viewMode),
          selectedSourceId: typeof state.selectedSourceId === "string" ? state.selectedSourceId : current.selectedSourceId,
          soqlSidebarWidth: typeof state.soqlSidebarWidth === "number" ? state.soqlSidebarWidth : current.soqlSidebarWidth,
          tabs: normalized.tabs,
          activeTabObjectName: normalized.activeTabObjectName,
          // loading 始终从默认值开始。
          loading: false
        };
      }
    }
  )
);
