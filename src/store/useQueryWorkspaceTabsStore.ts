import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// 旧版按数据源分桶的工作区顺序结构：用于历史快照迁移。
type LegacyQueryWorkspaceTabsState = {
  tabOrderBySourceId?: Record<string, string[]>;
  tabOrder?: string[];
};

type QueryWorkspaceTabsState = {
  // 全局工作区标签顺序：data/console 混排，不再按 source 分桶。
  tabOrder: string[];
  // 读取工作区标签顺序：保留 sourceId 入参仅用于兼容旧调用。
  getTabOrder: (sourceId?: string) => string[];
  // 写入工作区标签顺序：保留 sourceId 入参仅用于兼容旧调用。
  setTabOrder: (sourceId: string, order: string[] | ((current: string[]) => string[])) => void;
  // 清空工作区标签顺序：保留 sourceId 入参仅用于兼容旧调用。
  clearTabOrder: (sourceId?: string) => void;
};

// 归一化工作区顺序持久化快照：优先使用新版全局顺序，兼容旧版分桶结构。
function normalizeWorkspaceTabOrder(state: Partial<LegacyQueryWorkspaceTabsState>): string[] {
  if (Array.isArray(state.tabOrder)) {
    return state.tabOrder;
  }

  if (!state.tabOrderBySourceId || typeof state.tabOrderBySourceId !== "object") {
    return [];
  }

  const mergedOrder: string[] = [];
  Object.values(state.tabOrderBySourceId).forEach((order) => {
    if (!Array.isArray(order)) return;
    order.forEach((tabId) => {
      if (mergedOrder.includes(tabId)) return;
      mergedOrder.push(tabId);
    });
  });
  return mergedOrder;
}

// Query 工作区标签顺序持久化 store：仅保存展示顺序，不保存业务 tab 内容。
export const useQueryWorkspaceTabsStore = create<QueryWorkspaceTabsState>()(
  persist(
    (set, get) => ({
      tabOrder: [],

      getTabOrder: () => get().tabOrder,

      setTabOrder: (_sourceId, order) => {
        set((state) => ({
          tabOrder: typeof order === "function" ? order(state.tabOrder) : order
        }));
      },

      clearTabOrder: () => {
        set({ tabOrder: [] });
      }
    }),
    {
      name: "ui.query-workspace-tabs-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      skipHydration: true,
      partialize: (state) => ({
        tabOrder: state.tabOrder
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<LegacyQueryWorkspaceTabsState>;
        return {
          ...current,
          ...state,
          tabOrder: normalizeWorkspaceTabOrder(state)
        };
      }
    }
  )
);
