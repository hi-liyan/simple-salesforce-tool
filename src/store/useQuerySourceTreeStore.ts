import { create } from "zustand";
import { persist } from "zustand/middleware";
import { createDebouncedTauriJsonStorage } from "./tauriStorage.ts";
import { normalizePersistedSourceTreeUiState, type PersistedSourceTreeUiState } from "../features/main/QueryPanel/logic/sourceTreePersistence.ts";

type QuerySourceTreeStoreState = {
  // 左树持久化 UI 状态：仅保存展示态，不保存对象缓存。
  treeUiState: PersistedSourceTreeUiState;
  // 写入左树 UI 状态：支持直接替换或基于当前值更新。
  setTreeUiState: (
    nextState:
      | PersistedSourceTreeUiState
      | ((current: PersistedSourceTreeUiState) => PersistedSourceTreeUiState)
  ) => void;
  // 重置左树 UI 状态。
  resetTreeUiState: () => void;
};

// 左树持久化切片：仅保存可恢复的 UI 展示态。
type PersistedQuerySourceTreeStoreState = {
  treeUiState: PersistedSourceTreeUiState;
};

// QueryPanel 左树持久化 store：用于跨 panel 切换与重启恢复展开/高亮状态。
export const useQuerySourceTreeStore = create<QuerySourceTreeStoreState>()(
  persist(
    (set) => ({
      treeUiState: normalizePersistedSourceTreeUiState(),

      setTreeUiState: (nextState) => {
        set((state) => ({
          treeUiState: normalizePersistedSourceTreeUiState(
            typeof nextState === "function" ? nextState(state.treeUiState) : nextState
          )
        }));
      },

      resetTreeUiState: () => {
        set({ treeUiState: normalizePersistedSourceTreeUiState() });
      }
    }),
    {
      name: "ui.query-source-tree-store",
      storage: createDebouncedTauriJsonStorage<PersistedQuerySourceTreeStoreState>(),
      skipHydration: true,
      partialize: (state) => ({
        treeUiState: state.treeUiState
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<QuerySourceTreeStoreState>;
        return {
          ...current,
          ...state,
          treeUiState: normalizePersistedSourceTreeUiState(state.treeUiState)
        };
      }
    }
  )
);
