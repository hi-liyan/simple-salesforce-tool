import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { moveTabOrder, normalizeTabOrder } from "../components/tabs/tabOrder.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// 文本对比 Tab 状态：保存左右两侧的原始文本内容。
export type TextDiffTab = {
  // 页签主键。
  id: string;
  // 页签标题。
  name: string;
  // 左侧文本内容。
  leftText: string;
  // 右侧文本内容。
  rightText: string;
};

// 文本对比 Store：负责多 Tab 与持久化恢复。
type TextDiffState = {
  // 当前全部文本对比页签。
  tabs: TextDiffTab[];
  // 标签展示顺序。
  tabOrder: string[];
  // 当前激活页签 ID。
  activeTabId: string;
  // 设置激活页签。
  setActiveTabId: (tabId: string) => void;
  // 新建页签。
  createTab: () => string;
  // 更新单个页签。
  patchTab: (tabId: string, updater: (tab: TextDiffTab) => TextDiffTab) => void;
  // 交换左右文本。
  swapTabTexts: (tabId: string) => void;
  // 拖拽排序页签。
  reorderTabs: (activeTabId: string, overTabId: string) => void;
  // 关闭单个页签。
  closeTab: (tabId: string) => void;
  // 批量关闭页签。
  closeTabsByIds: (tabIds: string[]) => void;
};

// 生成随机 ID：用于区分不同文本对比页签。
function makeTextDiffId(): string {
  return `text-diff-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 生成默认页签名称。
function createTextDiffTabName(index: number): string {
  return `Text Diff ${index}`;
}

// 创建新的文本对比页签默认值。
export function createTextDiffTab(index: number): TextDiffTab {
  return {
    id: makeTextDiffId(),
    name: createTextDiffTabName(index),
    leftText: "",
    rightText: ""
  };
}

// 持久化快照恢复：兜底历史字段与非法值。
function hydrateTextDiffTab(tab: Partial<TextDiffTab>, index: number): TextDiffTab {
  return {
    id: tab.id || makeTextDiffId(),
    name: tab.name?.trim() || createTextDiffTabName(index),
    leftText: typeof tab.leftText === "string" ? tab.leftText : "",
    rightText: typeof tab.rightText === "string" ? tab.rightText : ""
  };
}

// 文本对比工具持久化 Store：进入工具页时按需恢复。
export const useTextDiffStore = create<TextDiffState>()(
  persist(
    (set, get) => ({
      tabs: [],
      tabOrder: [],
      activeTabId: "",

      setActiveTabId: (tabId) => {
        set(() => ({
          activeTabId: tabId
        }));
      },

      createTab: () => {
        const { tabs } = get();
        const nextTab = createTextDiffTab(tabs.length + 1);
        set((state) => ({
          tabs: [...state.tabs, nextTab],
          tabOrder: [...normalizeTabOrder(state.tabOrder, state.tabs), nextTab.id],
          activeTabId: nextTab.id
        }));
        return nextTab.id;
      },

      patchTab: (tabId, updater) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? updater(tab) : tab))
        }));
      },

      swapTabTexts: (tabId) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            return {
              ...tab,
              leftText: tab.rightText,
              rightText: tab.leftText
            };
          })
        }));
      },

      reorderTabs: (activeTabId, overTabId) => {
        set((state) => ({
          tabOrder: moveTabOrder(normalizeTabOrder(state.tabOrder, state.tabs), activeTabId, overTabId)
        }));
      },

      closeTab: (tabId) => {
        get().closeTabsByIds([tabId]);
      },

      closeTabsByIds: (tabIds) => {
        if (tabIds.length === 0) return;
        const closeSet = new Set(tabIds);
        set((state) => {
          const nextTabs = state.tabs.filter((tab) => !closeSet.has(tab.id));
          const nextTabOrder = normalizeTabOrder(state.tabOrder, nextTabs);
          const activeExists = nextTabs.some((tab) => tab.id === state.activeTabId);
          return {
            tabs: nextTabs,
            tabOrder: nextTabOrder,
            activeTabId: activeExists ? state.activeTabId : nextTabOrder[0] || ""
          };
        });
      }
    }),
    {
      name: "ui.text-diff-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 启动阶段不恢复，由进入 TextDiff 工具页时手动 rehydrate。
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        activeTabId: state.activeTabId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<TextDiffState>;
        const tabs = Array.isArray(state.tabs) ? state.tabs.map((tab, index) => hydrateTextDiffTab(tab, index + 1)) : current.tabs;
        const tabOrder = Array.isArray(state.tabOrder) ? normalizeTabOrder(state.tabOrder, tabs) : normalizeTabOrder([], tabs);
        const activeTabId =
          typeof state.activeTabId === "string" && tabs.some((tab) => tab.id === state.activeTabId)
            ? state.activeTabId
            : tabOrder[0] || "";

        return {
          ...current,
          ...state,
          tabs,
          tabOrder,
          activeTabId
        };
      }
    }
  )
);
