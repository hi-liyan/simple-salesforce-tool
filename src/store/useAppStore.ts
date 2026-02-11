import { create } from "zustand";
import { TabState } from "../types";

// 全局应用状态：集中管理 Tab 与基础 UI 状态。
type AppState = {
  // 当前选中的数据源 ID。
  selectedSourceId: string;
  // 已打开的对象 Tab 列表。
  tabs: TabState[];
  // 当前激活的对象名称。
  activeTabObjectName: string;
  // 页面级全局加载标记。
  loading: boolean;
  // 更新选中数据源。
  setSelectedSourceId: (sourceId: string) => void;
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

// Zustand Store：提供简洁的状态更新 API。
export const useAppStore = create<AppState>((set, get) => ({
  selectedSourceId: "",
  tabs: [],
  activeTabObjectName: "",
  loading: false,
  setSelectedSourceId: (sourceId) => set({ selectedSourceId: sourceId }),
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
}));
