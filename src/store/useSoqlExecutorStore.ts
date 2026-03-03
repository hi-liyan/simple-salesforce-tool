import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { Notice, QueryResult, TabLog } from "../types";
import { tauriSqliteStorage } from "./tauriStorage";

// AI 对话单条消息。
export type AiConversationItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "clarify" | "ready";
  questions?: string[];
  soql?: string;
};

// SOQL 执行器标签页完整状态。
export type SoqlExecutorTab = {
  id: string;
  name: string;
  soqlDraft: string;
  selectedSoqlText: string;
  result: QueryResult;
  loading: boolean;
  notice: Notice | null;
  logs: TabLog[];
  selectedRecordIds: string[];
  showBottomPanel: boolean;
  aiConversationId: string;
  aiPromptDraft: string;
  aiMessages: AiConversationItem[];
  aiLoading: boolean;
  aiMode: boolean;
  aiStreamRequestId: string;
};

// 控制台 Tab 持久化快照：按“完整页面状态”保存，切换数据源时可完整恢复。
type PersistedSoqlTab = SoqlExecutorTab;

// 每个数据源独立维护控制台 Tabs 快照。
type PersistedSourceSoqlState = {
  tabs: PersistedSoqlTab[];
  activeTabId: string;
};

// 创建新的 SOQL 执行器标签默认值。
export function createSoqlExecutorTab(index: number): SoqlExecutorTab {
  return {
    id: `soql-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: `SOQL ${index}`,
    soqlDraft: "",
    selectedSoqlText: "",
    result: { totalSize: 0, records: [] },
    loading: false,
    notice: null,
    logs: [],
    selectedRecordIds: [],
    showBottomPanel: false,
    aiConversationId: "",
    aiPromptDraft: "",
    aiMessages: [],
    aiLoading: false,
    aiMode: false,
    aiStreamRequestId: ""
  };
}

// 将持久化快照恢复为完整 SoqlExecutorTab，兼容历史字段缺失并重置瞬态运行标记。
function hydrateSoqlTab(persisted: Partial<PersistedSoqlTab>): SoqlExecutorTab {
  return {
    ...persisted,
    id: persisted.id || `soql-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: persisted.name || "SOQL",
    soqlDraft: persisted.soqlDraft || "",
    selectedSoqlText: persisted.selectedSoqlText || "",
    result: persisted.result || { totalSize: 0, records: [] },
    loading: false,
    notice: persisted.notice || null,
    logs: Array.isArray(persisted.logs) ? persisted.logs : [],
    selectedRecordIds: Array.isArray(persisted.selectedRecordIds) ? persisted.selectedRecordIds : [],
    showBottomPanel: persisted.showBottomPanel === true,
    aiConversationId: persisted.aiConversationId || "",
    aiPromptDraft: persisted.aiPromptDraft || "",
    aiMessages: Array.isArray(persisted.aiMessages) ? persisted.aiMessages : [],
    aiLoading: false,
    aiMode: persisted.aiMode === true,
    aiStreamRequestId: ""
  };
}

// 将当前 source 控制台状态写回 source 维度快照。
function upsertSourceSoqlState(
  sourceTabStateBySourceId: Record<string, PersistedSourceSoqlState>,
  sourceId: string,
  tabs: SoqlExecutorTab[],
  activeTabId: string
): Record<string, PersistedSourceSoqlState> {
  if (!sourceId) return sourceTabStateBySourceId;
  return {
    ...sourceTabStateBySourceId,
    [sourceId]: {
      tabs,
      activeTabId
    }
  };
}

// 恢复指定 source 的控制台 Tabs。
function restoreSourceSoqlState(
  sourceTabStateBySourceId: Record<string, PersistedSourceSoqlState>,
  sourceId: string
): { tabs: SoqlExecutorTab[]; activeTabId: string } {
  if (!sourceId) return { tabs: [], activeTabId: "" };
  const sourceState = sourceTabStateBySourceId[sourceId];
  if (!sourceState) return { tabs: [], activeTabId: "" };
  const hydratedTabs = Array.isArray(sourceState.tabs) ? sourceState.tabs.map((tab) => hydrateSoqlTab(tab)) : [];
  const activeExists = hydratedTabs.some((tab) => tab.id === sourceState.activeTabId);
  return {
    tabs: hydratedTabs,
    activeTabId: activeExists ? sourceState.activeTabId : hydratedTabs[0]?.id || ""
  };
}

// 兼容旧结构：将历史 tabs + activeTabId 迁移到按 sourceId 分桶结构。
function normalizeSourceSoqlStateMap(state: Partial<SoqlExecutorState>): Record<string, PersistedSourceSoqlState> {
  const rawMap = state.sourceTabStateBySourceId;
  const normalizedMap: Record<string, PersistedSourceSoqlState> = {};
  if (rawMap && typeof rawMap === "object") {
    Object.entries(rawMap).forEach(([sourceId, sourceState]) => {
      if (!sourceId || !sourceState || typeof sourceState !== "object") return;
      const tabs = Array.isArray(sourceState.tabs) ? sourceState.tabs.map((tab) => hydrateSoqlTab(tab as Partial<PersistedSoqlTab>)) : [];
      const activeTabId = typeof sourceState.activeTabId === "string" ? sourceState.activeTabId : "";
      normalizedMap[sourceId] = { tabs, activeTabId };
    });
  }
  const sourceId = typeof state.sourceId === "string" ? state.sourceId : "";
  if (!normalizedMap[sourceId] && Array.isArray(state.tabs) && state.tabs.length > 0 && sourceId) {
    normalizedMap[sourceId] = {
      tabs: state.tabs.map((tab) => hydrateSoqlTab(tab as Partial<PersistedSoqlTab>)),
      activeTabId: typeof state.activeTabId === "string" ? state.activeTabId : ""
    };
  }
  return normalizedMap;
}

type SoqlExecutorState = {
  // 当前控制台状态所属的数据源 ID。
  sourceId: string;
  // 按数据源分桶保存控制台 Tabs。
  sourceTabStateBySourceId: Record<string, PersistedSourceSoqlState>;
  tabs: SoqlExecutorTab[];
  activeTabId: string;
  // 切换当前控制台的数据源上下文，并恢复对应 Tabs。
  switchSource: (sourceId: string) => void;
  // 设置 Tab 列表（直接值或更新函数）。
  setTabs: (tabs: SoqlExecutorTab[] | ((tabs: SoqlExecutorTab[]) => SoqlExecutorTab[])) => void;
  // 设置激活 Tab ID。
  setActiveTabId: (tabId: string | ((current: string) => string)) => void;
  // 新建 Tab。
  createTab: () => string;
  // 关闭指定 Tab（批量）。
  closeTabsByIds: (tabIds: string[]) => void;
  // 关闭单个 Tab。
  closeTab: (tabId: string) => void;
  // 对指定 Tab 打补丁更新。
  patchTab: (tabId: string, updater: (tab: SoqlExecutorTab) => SoqlExecutorTab) => void;
  // 清空所有 Tab。
  resetTabs: () => void;
};

export const useSoqlExecutorStore = create<SoqlExecutorState>()(
  persist(
    (set, get) => ({
      sourceId: "",
      sourceTabStateBySourceId: {},
      tabs: [],
      activeTabId: "",

      switchSource: (nextSourceId) =>
        set((state) => {
          if (state.sourceId === nextSourceId) return state;
          // 切换前先保存当前 source 快照，再恢复目标 source 快照。
          const nextSourceMap = upsertSourceSoqlState(
            state.sourceTabStateBySourceId,
            state.sourceId,
            state.tabs,
            state.activeTabId
          );
          const restored = restoreSourceSoqlState(nextSourceMap, nextSourceId);
          return {
            sourceId: nextSourceId,
            sourceTabStateBySourceId: nextSourceMap,
            tabs: restored.tabs,
            activeTabId: restored.activeTabId
          };
        }),

      setTabs: (tabs) =>
        set((state) => {
          const nextTabs = typeof tabs === "function" ? tabs(state.tabs) : tabs;
          return {
            tabs: nextTabs,
            sourceTabStateBySourceId: upsertSourceSoqlState(
              state.sourceTabStateBySourceId,
              state.sourceId,
              nextTabs,
              state.activeTabId
            )
          };
        }),

      setActiveTabId: (tabId) =>
        set((state) => {
          const nextActiveTabId = typeof tabId === "function" ? tabId(state.activeTabId) : tabId;
          return {
            activeTabId: nextActiveTabId,
            sourceTabStateBySourceId: upsertSourceSoqlState(
              state.sourceTabStateBySourceId,
              state.sourceId,
              state.tabs,
              nextActiveTabId
            )
          };
        }),

      createTab: () => {
        const { tabs } = get();
        const nextIndex = tabs.length + 1;
        const nextTab = createSoqlExecutorTab(nextIndex);
        set((state) => {
          const nextTabs = [...tabs, nextTab];
          return {
            tabs: nextTabs,
            activeTabId: nextTab.id,
            sourceTabStateBySourceId: upsertSourceSoqlState(
              state.sourceTabStateBySourceId,
              state.sourceId,
              nextTabs,
              nextTab.id
            )
          };
        });
        return nextTab.id; // 返回新建 Tab ID，便于外层统一工作区直接激活。
      },

      closeTabsByIds: (tabIds) => {
        if (tabIds.length === 0) return;
        const closeSet = new Set(tabIds);
        const { tabs, activeTabId } = get();
        const nextTabs = tabs.filter((item) => !closeSet.has(item.id));
        const nextActive = closeSet.has(activeTabId) ? nextTabs[0]?.id || "" : activeTabId;
        set((state) => ({
          tabs: nextTabs,
          activeTabId: nextTabs.length > 0 ? nextActive : "",
          sourceTabStateBySourceId: upsertSourceSoqlState(
            state.sourceTabStateBySourceId,
            state.sourceId,
            nextTabs,
            nextTabs.length > 0 ? nextActive : ""
          )
        }));
      },

      closeTab: (tabId) => {
        get().closeTabsByIds([tabId]);
      },

      patchTab: (tabId, updater) => {
        set((state) => {
          const nextTabs = state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab));
          return {
            tabs: nextTabs,
            sourceTabStateBySourceId: upsertSourceSoqlState(
              state.sourceTabStateBySourceId,
              state.sourceId,
              nextTabs,
              state.activeTabId
            )
          };
        });
      },

      resetTabs: () => {
        set((state) => ({
          tabs: [],
          activeTabId: "",
          sourceTabStateBySourceId: upsertSourceSoqlState(state.sourceTabStateBySourceId, state.sourceId, [], "")
        }));
      }
    }),
    {
      name: "ui.soql-executor-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 跳过自动 hydration，由 MainPage 启动流程手动控制恢复时机。
      skipHydration: true,
      partialize: (state) => ({
        sourceId: state.sourceId,
        sourceTabStateBySourceId: upsertSourceSoqlState(
          state.sourceTabStateBySourceId,
          state.sourceId,
          state.tabs,
          state.activeTabId
        )
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<SoqlExecutorState>;
        const sourceId = typeof state.sourceId === "string" ? state.sourceId : current.sourceId;
        const sourceTabStateBySourceId = normalizeSourceSoqlStateMap(state);
        const restored = restoreSourceSoqlState(sourceTabStateBySourceId, sourceId);
        return {
          ...current,
          ...state,
          sourceId,
          sourceTabStateBySourceId,
          tabs: restored.tabs,
          activeTabId: restored.activeTabId
        };
      }
    }
  )
);
