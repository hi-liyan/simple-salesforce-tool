import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { moveTabOrder, normalizeTabOrder } from "../components/tabs/tabOrder.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// JSON 格式化 Tab 状态：保存单个工具页签的输入与视图控制信息。
export type JsonFormatterTab = {
  // 页签主键。
  id: string;
  // 页签标题。
  name: string;
  // 左侧原始 JSON 输入内容。
  inputText: string;
  // 右侧树形视图默认折叠状态。
  viewerCollapsed: boolean;
  // 右侧树形视图重建版本：用于触发“全部展开 / 全部收起”后的组件重挂载。
  viewerRevision: number;
};

// JSON 格式化 Store：负责多 Tab 与持久化恢复。
type JsonFormatterState = {
  // 当前全部 JSON 工具页签。
  tabs: JsonFormatterTab[];
  // 标签展示顺序。
  tabOrder: string[];
  // 当前激活页签 ID。
  activeTabId: string;
  // 设置激活页签。
  setActiveTabId: (tabId: string) => void;
  // 新建页签。
  createTab: () => string;
  // 更新单个页签。
  patchTab: (tabId: string, updater: (tab: JsonFormatterTab) => JsonFormatterTab) => void;
  // 拖拽排序页签。
  reorderTabs: (activeTabId: string, overTabId: string) => void;
  // 关闭单个页签。
  closeTab: (tabId: string) => void;
  // 批量关闭页签。
  closeTabsByIds: (tabIds: string[]) => void;
  // 清空全部页签。
  resetTabs: () => void;
};

// 生成随机 ID：用于区分不同 JSON 工具页签。
function makeJsonFormatterId(): string {
  return `json-formatter-tab-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 生成默认页签名称。
function createJsonFormatterTabName(index: number): string {
  return `JSON ${index}`;
}

// 创建新的 JSON 格式化页签默认值。
export function createJsonFormatterTab(index: number): JsonFormatterTab {
  return {
    id: makeJsonFormatterId(),
    name: createJsonFormatterTabName(index),
    inputText: "",
    viewerCollapsed: false,
    viewerRevision: 0
  };
}

// 持久化快照恢复：兜底历史字段与非法值。
function hydrateJsonFormatterTab(tab: Partial<JsonFormatterTab>, index: number): JsonFormatterTab {
  return {
    id: tab.id || makeJsonFormatterId(),
    name: tab.name?.trim() || createJsonFormatterTabName(index),
    inputText: typeof tab.inputText === "string" ? tab.inputText : "",
    viewerCollapsed: tab.viewerCollapsed === true,
    viewerRevision: typeof tab.viewerRevision === "number" ? tab.viewerRevision : 0
  };
}

// JSON 工具持久化 Store：使用 SQLite 保存多页签输入状态，并延迟到工具页内手动恢复。
export const useJsonFormatterStore = create<JsonFormatterState>()(
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
        const nextTab = createJsonFormatterTab(tabs.length + 1);
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
      },

      resetTabs: () => {
        set(() => ({
          tabs: [],
          tabOrder: [],
          activeTabId: ""
        }));
      }
    }),
    {
      name: "ui.json-formatter-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      // 启动阶段不恢复，由进入 JSON 工具页时手动 rehydrate。
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        activeTabId: state.activeTabId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<JsonFormatterState>;
        const tabs = Array.isArray(state.tabs) ? state.tabs.map((tab, index) => hydrateJsonFormatterTab(tab, index + 1)) : current.tabs;
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
