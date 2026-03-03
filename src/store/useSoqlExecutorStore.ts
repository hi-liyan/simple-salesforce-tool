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

// 持久化时保留的字段子集。
type PersistedSoqlTab = Pick<
  SoqlExecutorTab,
  "id" | "name" | "soqlDraft" | "showBottomPanel" | "aiMode" | "logs"
>;

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

// 将持久化快照恢复为完整 SoqlExecutorTab，补全被排除的运行时字段。
function hydrateSoqlTab(persisted: PersistedSoqlTab): SoqlExecutorTab {
  return {
    ...persisted,
    selectedSoqlText: "",
    result: { totalSize: 0, records: [] },
    loading: false,
    notice: null,
    selectedRecordIds: [],
    aiConversationId: "",
    aiPromptDraft: "",
    aiMessages: [],
    aiLoading: false,
    aiStreamRequestId: ""
  };
}

type SoqlExecutorState = {
  tabs: SoqlExecutorTab[];
  activeTabId: string;
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

      createTab: () => {
        const { tabs } = get();
        const nextIndex = tabs.length + 1;
        const nextTab = createSoqlExecutorTab(nextIndex);
        set({ tabs: [...tabs, nextTab], activeTabId: nextTab.id });
        return nextTab.id; // 返回新建 Tab ID，便于外层统一工作区直接激活。
      },

      closeTabsByIds: (tabIds) => {
        if (tabIds.length === 0) return;
        const closeSet = new Set(tabIds);
        const { tabs, activeTabId } = get();
        const nextTabs = tabs.filter((item) => !closeSet.has(item.id));
        const nextActive = closeSet.has(activeTabId) ? nextTabs[0]?.id || "" : activeTabId;
        set({ tabs: nextTabs, activeTabId: nextTabs.length > 0 ? nextActive : "" });
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
        set({ tabs: [], activeTabId: "" });
      }
    }),
    {
      name: "ui.soql-executor-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 跳过自动 hydration，由 MainPage 启动流程手动控制恢复时机。
      skipHydration: true,
      partialize: (state) => ({
        activeTabId: state.activeTabId,
        tabs: state.tabs.map((tab): PersistedSoqlTab => ({
          id: tab.id,
          name: tab.name,
          soqlDraft: tab.soqlDraft,
          showBottomPanel: tab.showBottomPanel,
          aiMode: tab.aiMode,
          logs: tab.logs
        }))
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<SoqlExecutorState>;
        const hydratedTabs = Array.isArray(state.tabs)
          ? state.tabs.map((tab) => hydrateSoqlTab(tab as unknown as PersistedSoqlTab))
          : current.tabs;
        return {
          ...current,
          ...state,
          tabs: hydratedTabs.length > 0 ? hydratedTabs : current.tabs,
          activeTabId: state.activeTabId && hydratedTabs.some((t) => t.id === state.activeTabId)
            ? state.activeTabId
            : hydratedTabs[0]?.id || ""
        };
      }
    }
  )
);
