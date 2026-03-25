import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { moveTabOrder, normalizeTabOrder } from "../components/tabs/tabOrder.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// JSON Diff Tab 状态：保存左右两侧 JSON 原始输入内容。
export type JsonDiffTab = {
  // 页签主键。
  id: string;
  // 页签标题。
  name: string;
  // 左侧 JSON 文本。
  leftText: string;
  // 右侧 JSON 文本。
  rightText: string;
};

// JSON Diff Store：负责多 Tab 与持久化恢复。
type JsonDiffState = {
  // 当前全部 JSON Diff 页签。
  tabs: JsonDiffTab[];
  // 标签展示顺序。
  tabOrder: string[];
  // 当前激活页签 ID。
  activeTabId: string;
  // 设置激活页签。
  setActiveTabId: (tabId: string) => void;
  // 新建页签。
  createTab: () => string;
  // 更新单个页签。
  patchTab: (tabId: string, updater: (tab: JsonDiffTab) => JsonDiffTab) => void;
  // 交换左右文本。
  swapTabTexts: (tabId: string) => void;
  // 拖拽排序页签。
  reorderTabs: (activeTabId: string, overTabId: string) => void;
  // 关闭单个页签。
  closeTab: (tabId: string) => void;
  // 批量关闭页签。
  closeTabsByIds: (tabIds: string[]) => void;
};

// 生成随机 ID：用于区分不同 JSON Diff 页签。
function makeJsonDiffId(): string {
  return `json-diff-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 生成默认页签名称。
function createJsonDiffTabName(index: number): string {
  return `JSON Diff ${index}`;
}

// 创建新的 JSON Diff 页签默认值。
export function createJsonDiffTab(index: number): JsonDiffTab {
  return {
    id: makeJsonDiffId(),
    name: createJsonDiffTabName(index),
    leftText: "",
    rightText: ""
  };
}

// 持久化快照恢复：兜底历史字段与非法值。
function hydrateJsonDiffTab(tab: Partial<JsonDiffTab>, index: number): JsonDiffTab {
  return {
    id: tab.id || makeJsonDiffId(),
    name: tab.name?.trim() || createJsonDiffTabName(index),
    leftText: typeof tab.leftText === "string" ? tab.leftText : "",
    rightText: typeof tab.rightText === "string" ? tab.rightText : ""
  };
}

// JSON Diff 工具持久化 Store：进入工具页时按需恢复。
export const useJsonDiffStore = create<JsonDiffState>()(
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
        const nextTab = createJsonDiffTab(tabs.length + 1);
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
      name: "ui.json-diff-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 启动阶段不恢复，由进入 JSON Diff 工具页时手动 rehydrate。
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        activeTabId: state.activeTabId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<JsonDiffState>;
        const tabs = Array.isArray(state.tabs) ? state.tabs.map((tab, index) => hydrateJsonDiffTab(tab, index + 1)) : current.tabs;
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
