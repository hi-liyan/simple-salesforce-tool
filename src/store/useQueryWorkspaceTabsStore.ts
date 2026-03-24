import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriSqliteStorage } from "./tauriStorage.ts";

type QueryWorkspaceTabsState = {
  // 按数据源分桶保存工作区标签顺序。
  tabOrderBySourceId: Record<string, string[]>;
  // 读取指定数据源的标签顺序。
  getTabOrder: (sourceId: string) => string[];
  // 写入指定数据源的标签顺序。
  setTabOrder: (sourceId: string, order: string[] | ((current: string[]) => string[])) => void;
  // 清空指定数据源的标签顺序。
  clearTabOrder: (sourceId: string) => void;
};

// Query 工作区标签顺序持久化 store：仅保存展示顺序，不保存业务 tab 内容。
export const useQueryWorkspaceTabsStore = create<QueryWorkspaceTabsState>()(
  persist(
    (set, get) => ({
      tabOrderBySourceId: {},

      getTabOrder: (sourceId) => {
        if (!sourceId) return [];
        return get().tabOrderBySourceId[sourceId] || [];
      },

      setTabOrder: (sourceId, order) => {
        if (!sourceId) return;
        set((state) => {
          const current = state.tabOrderBySourceId[sourceId] || [];
          const nextOrder = typeof order === "function" ? order(current) : order;
          return {
            tabOrderBySourceId: {
              ...state.tabOrderBySourceId,
              [sourceId]: nextOrder
            }
          };
        });
      },

      clearTabOrder: (sourceId) => {
        if (!sourceId) return;
        set((state) => {
          const nextMap = { ...state.tabOrderBySourceId };
          delete nextMap[sourceId];
          return {
            tabOrderBySourceId: nextMap
          };
        });
      }
    }),
    {
      name: "ui.query-workspace-tabs-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      skipHydration: true,
      partialize: (state) => ({
        tabOrderBySourceId: state.tabOrderBySourceId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<QueryWorkspaceTabsState>;
        return {
          ...current,
          ...state,
          tabOrderBySourceId: state.tabOrderBySourceId && typeof state.tabOrderBySourceId === "object" ? state.tabOrderBySourceId : {}
        };
      }
    }
  )
);
