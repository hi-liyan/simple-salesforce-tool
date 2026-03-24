import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { buildObjectTabBindingKey, type TabState } from "../types/index.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";
import { hydrateTab } from "./queryTabHydration.ts";

// 主页面视图模式：支持 Query 工作区、Terminal 工作区、工具页与设置页入口。
export type MainViewMode = "query" | "terminal" | "tools" | "settings";

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

// Tab 持久化快照：按“完整页面状态”保存，切换数据源时可完整恢复。
type PersistedTabState = TabState;

// 每个数据源独立维护 Query Tab 快照（Tabs + 当前激活项）。
type PersistedSourceTabState = {
  tabs: PersistedTabState[];
  activeTabObjectName: string;
};

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

// 将当前 source 运行态写回 source 维度快照，确保切换时可恢复。
function upsertSourceTabState(
  sourceTabStateBySourceId: Record<string, PersistedSourceTabState>,
  sourceId: string,
  tabs: TabState[],
  activeTabObjectName: string
): Record<string, PersistedSourceTabState> {
  if (!sourceId) return sourceTabStateBySourceId;
  return {
    ...sourceTabStateBySourceId,
    [sourceId]: {
      tabs: tabs.map((tab) => ensureTabBindingKey(tab)),
      activeTabObjectName
    }
  };
}

// 恢复指定数据源的 Tab 快照；无数据时返回空状态。
function restoreSourceTabState(
  sourceTabStateBySourceId: Record<string, PersistedSourceTabState>,
  sourceId: string
): { tabs: TabState[]; activeTabObjectName: string } {
  if (!sourceId) return { tabs: [], activeTabObjectName: "" };
  const sourceState = sourceTabStateBySourceId[sourceId];
  if (!sourceState) return { tabs: [], activeTabObjectName: "" };
  const hydratedTabs = Array.isArray(sourceState.tabs) ? sourceState.tabs.map((tab) => hydrateTab(tab)) : [];
  const activeExists = hydratedTabs.some((tab) => tab.objectName === sourceState.activeTabObjectName);
  return {
    tabs: hydratedTabs,
    activeTabObjectName: activeExists ? sourceState.activeTabObjectName : hydratedTabs[0]?.objectName || ""
  };
}

// 兼容旧结构：将历史 tabs + activeTabObjectName 迁移到按数据源分桶结构。
function normalizeSourceTabStateMap(state: Partial<AppState>): Record<string, PersistedSourceTabState> {
  const rawMap = state.sourceTabStateBySourceId;
  const normalizedMap: Record<string, PersistedSourceTabState> = {};
  if (rawMap && typeof rawMap === "object") {
    Object.entries(rawMap).forEach(([sourceId, sourceState]) => {
      if (!sourceId || !sourceState || typeof sourceState !== "object") return;
      const tabs = Array.isArray(sourceState.tabs) ? sourceState.tabs.map((tab) => hydrateTab(tab as Partial<PersistedTabState>)) : [];
      const activeTabObjectName = typeof sourceState.activeTabObjectName === "string" ? sourceState.activeTabObjectName : "";
      normalizedMap[sourceId] = { tabs, activeTabObjectName };
    });
  }
  const selectedSourceId = typeof state.selectedSourceId === "string" ? state.selectedSourceId : "";
  if (!normalizedMap[selectedSourceId] && Array.isArray(state.tabs) && state.tabs.length > 0 && selectedSourceId) {
    normalizedMap[selectedSourceId] = {
      tabs: state.tabs.map((tab) => hydrateTab(tab as Partial<PersistedTabState>)),
      activeTabObjectName: typeof state.activeTabObjectName === "string" ? state.activeTabObjectName : ""
    };
  }
  return normalizedMap;
}

// 全局应用状态：集中管理 Tab、视图模式与基础 UI 状态。
type AppState = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 主页面视图模式。
  viewMode: MainViewMode;
  // SOQL 执行器左侧栏宽度（像素）。
  soqlSidebarWidth: number;
  // 按数据源分桶保存 Query Tabs，支持切换数据源后恢复原工作区。
  sourceTabStateBySourceId: Record<string, PersistedSourceTabState>;
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
      sourceTabStateBySourceId: {},
      tabs: [],
      activeTabObjectName: "",
      loading: false,
      setSelectedSourceId: (sourceId) =>
        set((state) => {
          if (state.selectedSourceId === sourceId) return state;
          // 切换前先保存当前 source 快照，再恢复目标 source 快照。
          const nextSourceStateMap = upsertSourceTabState(
            state.sourceTabStateBySourceId,
            state.selectedSourceId,
            state.tabs,
            state.activeTabObjectName
          );
          const restored = restoreSourceTabState(nextSourceStateMap, sourceId);
          return {
            selectedSourceId: sourceId,
            sourceTabStateBySourceId: nextSourceStateMap,
            tabs: restored.tabs,
            activeTabObjectName: restored.activeTabObjectName
          };
        }),
      setViewMode: (viewMode) => set({ viewMode: normalizeMainViewMode(viewMode) }),
      setSoqlSidebarWidth: (width) => set({ soqlSidebarWidth: Math.max(240, Math.min(1200, Math.round(width))) }),
      setActiveTabObjectName: (objectName) =>
        set((state) => {
          const nextSourceStateMap = upsertSourceTabState(state.sourceTabStateBySourceId, state.selectedSourceId, state.tabs, objectName);
          return { activeTabObjectName: objectName, sourceTabStateBySourceId: nextSourceStateMap };
        }),
      setTabs: (tabs) =>
        set((state) => {
          const nextTabs = (typeof tabs === "function" ? tabs(state.tabs) : tabs).map((tab) => ensureTabBindingKey(tab));
          return {
            tabs: nextTabs,
            sourceTabStateBySourceId: upsertSourceTabState(
              state.sourceTabStateBySourceId,
              state.selectedSourceId,
              nextTabs,
              state.activeTabObjectName
            )
          };
        }),
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
            tabs: nextTabs,
            sourceTabStateBySourceId: upsertSourceTabState(
              state.sourceTabStateBySourceId,
              state.selectedSourceId,
              nextTabs,
              state.activeTabObjectName
            )
          };
        });
      },
      closeTab: (tabIdentity) => {
        const { tabs, activeTabObjectName } = get();
        const nextTabs = tabs.filter((tab) => !isTabMatchedByIdentity(tab, tabIdentity));
        const activeTabMatched = tabs.some((tab) => tab.objectName === activeTabObjectName && isTabMatchedByIdentity(tab, tabIdentity));
        const nextActive = activeTabMatched ? nextTabs[0]?.objectName || "" : activeTabObjectName;
        set((state) => ({
          tabs: nextTabs,
          activeTabObjectName: nextActive,
          sourceTabStateBySourceId: upsertSourceTabState(
            state.sourceTabStateBySourceId,
            state.selectedSourceId,
            nextTabs,
            nextActive
          )
        }));
      },
      resetTabs: () =>
        set((state) => ({
          tabs: [],
          activeTabObjectName: "",
          sourceTabStateBySourceId: upsertSourceTabState(state.sourceTabStateBySourceId, state.selectedSourceId, [], "")
        }))
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
        sourceTabStateBySourceId: upsertSourceTabState(
          state.sourceTabStateBySourceId,
          state.selectedSourceId,
          state.tabs,
          state.activeTabObjectName
        )
      }),
      // 从持久化快照恢复时，按 sourceId 恢复对应 Tabs，兼容历史结构。
      merge: (persisted, current) => {
        const state = persisted as Partial<AppState>;
        // 兼容旧版持久化数据：systemLogs 回退 settings；soqlExecutor 回退 query。
        const viewMode = normalizeMainViewMode(state.viewMode as string | undefined);
        const selectedSourceId = typeof state.selectedSourceId === "string" ? state.selectedSourceId : current.selectedSourceId;
        const sourceTabStateBySourceId = normalizeSourceTabStateMap(state);
        const restored = restoreSourceTabState(sourceTabStateBySourceId, selectedSourceId);
        return {
          ...current,
          ...state,
          viewMode: viewMode ?? current.viewMode,
          selectedSourceId,
          sourceTabStateBySourceId,
          tabs: restored.tabs,
          activeTabObjectName: restored.activeTabObjectName,
          // loading 始终从默认值开始。
          loading: false
        };
      }
    }
  )
);
