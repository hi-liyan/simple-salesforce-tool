import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import type { Notice, QueryResult, SourceBindingMeta, TabLog } from "../types/index.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// AI 对话单条消息。
export type AiConversationItem = {
  id: string;
  role: "user" | "assistant";
  content: string;
  status?: "clarify" | "ready";
  questions?: string[];
  soql?: string;
};

// SOQL 执行器标签页完整状态：每个 console tab 永久绑定自己的数据源上下文。
export type SoqlExecutorTab = SourceBindingMeta & {
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

// 控制台 Tab 持久化快照：按“完整页面状态”保存，恢复时重建瞬态标记。
type PersistedSoqlTab = SoqlExecutorTab;

// 旧版按 source 分桶的控制台持久化结构：用于历史快照兼容迁移。
type LegacyPersistedSourceSoqlState = {
  tabs: Partial<PersistedSoqlTab>[];
  activeTabId: string;
};

// 旧版控制台持久化结构：迁移期兼容字段。
type LegacySoqlExecutorState = {
  sourceId?: string;
  sourceTabStateBySourceId?: Record<string, LegacyPersistedSourceSoqlState>;
  tabs?: Partial<PersistedSoqlTab>[];
  activeTabId?: string;
};

// 归一化数据源绑定快照：缺失字段时回退为空字符串，避免恢复时报错。
function normalizeSourceBindingMeta(sourceMeta: Partial<SourceBindingMeta> = {}): SourceBindingMeta {
  return {
    sourceId: sourceMeta.sourceId || "",
    sourceType: sourceMeta.sourceType || "",
    sourceName: sourceMeta.sourceName || "",
    sourceColor: sourceMeta.sourceColor || ""
  };
}

// 创建新的 SOQL 执行器标签默认值：写入创建时数据源上下文，确保后续执行不串源。
export function createSoqlExecutorTab(index: number, sourceMeta: Partial<SourceBindingMeta> = {}): SoqlExecutorTab {
  const normalizedSourceMeta = normalizeSourceBindingMeta(sourceMeta);
  return {
    ...normalizedSourceMeta,
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
function hydrateSoqlTab(persisted: Partial<PersistedSoqlTab>, fallbackSourceMeta: Partial<SourceBindingMeta> = {}): SoqlExecutorTab {
  const normalizedSourceMeta = normalizeSourceBindingMeta({
    sourceId: persisted.sourceId || fallbackSourceMeta.sourceId,
    sourceType: persisted.sourceType || fallbackSourceMeta.sourceType,
    sourceName: persisted.sourceName || fallbackSourceMeta.sourceName,
    sourceColor: persisted.sourceColor || fallbackSourceMeta.sourceColor
  });

  return {
    ...persisted,
    ...normalizedSourceMeta,
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

// 归一化控制台持久化快照：兼容旧版按 source 分桶结构，并保留所有来源的 console tabs。
function normalizePersistedSoqlState(state: Partial<LegacySoqlExecutorState>): { tabs: SoqlExecutorTab[]; activeTabId: string } {
  const tabMap = new Map<string, SoqlExecutorTab>();

  if (Array.isArray(state.tabs)) {
    state.tabs.forEach((tab) => {
      const hydratedTab = hydrateSoqlTab(tab as Partial<PersistedSoqlTab>);
      tabMap.set(hydratedTab.id, hydratedTab);
    });
  }

  if (state.sourceTabStateBySourceId && typeof state.sourceTabStateBySourceId === "object") {
    Object.entries(state.sourceTabStateBySourceId).forEach(([sourceId, sourceState]) => {
      if (!sourceState || typeof sourceState !== "object" || !Array.isArray(sourceState.tabs)) return;
      sourceState.tabs.forEach((tab) => {
        const hydratedTab = hydrateSoqlTab(tab, { sourceId });
        tabMap.set(hydratedTab.id, hydratedTab);
      });
    });
  }

  const tabs = Array.from(tabMap.values());
  const currentActiveTabId = typeof state.activeTabId === "string" ? state.activeTabId : "";
  if (currentActiveTabId && tabs.some((tab) => tab.id === currentActiveTabId)) {
    return { tabs, activeTabId: currentActiveTabId };
  }

  const currentSourceId = typeof state.sourceId === "string" ? state.sourceId : "";
  if (currentSourceId && state.sourceTabStateBySourceId?.[currentSourceId]?.activeTabId) {
    const legacyActiveTabId = state.sourceTabStateBySourceId[currentSourceId]?.activeTabId || "";
    if (tabs.some((tab) => tab.id === legacyActiveTabId)) {
      return { tabs, activeTabId: legacyActiveTabId };
    }
  }

  return {
    tabs,
    activeTabId: tabs[0]?.id || ""
  };
}

type SoqlExecutorState = {
  tabs: SoqlExecutorTab[];
  activeTabId: string;
  // 设置 Tab 列表（直接值或更新函数）。
  setTabs: (tabs: SoqlExecutorTab[] | ((tabs: SoqlExecutorTab[]) => SoqlExecutorTab[])) => void;
  // 设置激活 Tab ID。
  setActiveTabId: (tabId: string | ((current: string) => string)) => void;
  // 新建 Tab：创建时写入来源数据源上下文。
  createTab: (sourceMeta?: Partial<SourceBindingMeta>) => string;
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
      tabs: [],
      activeTabId: "",

      setTabs: (tabs) =>
        set((state) => ({
          tabs: typeof tabs === "function" ? tabs(state.tabs) : tabs
        })),

      setActiveTabId: (tabId) =>
        set((state) => ({
          activeTabId: typeof tabId === "function" ? tabId(state.activeTabId) : tabId
        })),

      createTab: (sourceMeta = {}) => {
        const { tabs } = get();
        const nextTab = createSoqlExecutorTab(tabs.length + 1, sourceMeta);
        set((state) => ({
          tabs: [...state.tabs, nextTab],
          activeTabId: nextTab.id
        }));
        return nextTab.id;
      },

      closeTabsByIds: (tabIds) => {
        if (tabIds.length === 0) return;
        const closeSet = new Set(tabIds);
        const { tabs, activeTabId } = get();
        const nextTabs = tabs.filter((item) => !closeSet.has(item.id));
        const nextActiveTabId = closeSet.has(activeTabId) ? nextTabs[0]?.id || "" : activeTabId;
        set({
          tabs: nextTabs,
          activeTabId: nextTabs.length > 0 ? nextActiveTabId : ""
        });
      },

      closeTab: (tabId) => {
        get().closeTabsByIds([tabId]);
      },

      patchTab: (tabId, updater) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
        }));
      },

      resetTabs: () => {
        set({
          tabs: [],
          activeTabId: ""
        });
      }
    }),
    {
      name: "ui.soql-executor-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 跳过自动 hydration，由 MainPage 启动流程手动控制恢复时机。
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<LegacySoqlExecutorState>;
        const normalized = normalizePersistedSoqlState(state);
        return {
          ...current,
          ...state,
          tabs: normalized.tabs,
          activeTabId: normalized.activeTabId
        };
      }
    }
  )
);
