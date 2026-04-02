import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { moveTabOrder, normalizeTabOrder } from "../components/tabs/tabOrder.ts";
import { tauriSqliteStorage } from "./tauriStorage.ts";

// 终端输出行：用于模拟终端历史输出。
export type TerminalOutputLine = {
  // 输出行主键。
  id: string;
  // 输出类型：输入命令、普通输出、错误输出。
  kind: "command" | "stdout" | "stderr";
  // 输出文本。
  text: string;
  // 输出时间。
  createdAt: string;
};

// 单个终端 Tab 状态。
export type TerminalTab = {
  // 终端 Tab 主键。
  id: string;
  // 终端 Tab 标题。
  name: string;
  // 输入框草稿。
  inputDraft: string;
  // 输出历史。
  outputs: TerminalOutputLine[];
};

// 终端状态 Store。
type TerminalState = {
  // 当前终端 Tabs：与 QueryPanel 数据源彻底解耦，全局只维护一份运行态。
  tabs: TerminalTab[];
  // 终端标签顺序。
  tabOrder: string[];
  // 当前激活终端 Tab ID。
  activeTabId: string;
  // 重置终端工作区：用于启动阶段丢弃上次会话残留。
  resetTerminalWorkspace: () => void;
  // 新建终端 Tab。
  createTerminalTab: (seedCommand?: string, seedTitle?: string) => string;
  // 激活终端 Tab。
  setActiveTabId: (tabId: string) => void;
  // 重命名终端 Tab。
  renameTerminalTab: (tabId: string, name: string) => void;
  // 终端标签排序。
  reorderTerminalTabs: (activeTabId: string, overTabId: string) => void;
  // 关闭终端 Tab。
  closeTerminalTab: (tabId: string) => void;
  // 批量关闭终端 Tab。
  closeTerminalTabsByIds: (tabIds: string[]) => void;
  // 设置终端输入草稿。
  setTerminalInputDraft: (tabId: string, draft: string) => void;
  // 向终端追加输出。
  appendTerminalOutput: (tabId: string, line: Omit<TerminalOutputLine, "id" | "createdAt">) => void;
  // 向当前激活终端复制命令。
  copyCommandToActiveTerminal: (command: string) => void;
  // 复制命令到新终端。
  copyCommandToNewTerminal: (command: string, commandName?: string) => string;
};

// 生成唯一 ID。
function makeId(prefix: string): string {
  return `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 生成时间戳。
function nowIso(): string {
  return new Date().toISOString();
}

// 生成默认终端 Tab。
function createDefaultTerminalTab(index = 1): TerminalTab {
  return {
    id: makeId("terminal-tab"),
    name: `Terminal ${index}`,
    inputDraft: "",
    outputs: [
      {
        id: makeId("terminal-line"),
        kind: "stdout",
        text: "终端已就绪（当前为 UI 模拟终端，可先粘贴/保存命令）。",
        createdAt: nowIso()
      }
    ]
  };
}

// 终端 Store：持久化 UI tabs 与草稿状态，不持久化后端会话运行态。
export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      tabs: [],
      tabOrder: [],
      activeTabId: "",

      resetTerminalWorkspace: () => {
        set(() => ({
          tabs: [],
          tabOrder: [],
          activeTabId: ""
        }));
      },

      createTerminalTab: (seedCommand, seedTitle) => {
        const { tabs } = get();
        const nextTab = createDefaultTerminalTab(tabs.length + 1);
        const finalTab: TerminalTab = {
          ...nextTab,
          name: seedTitle?.trim() || nextTab.name,
          inputDraft: seedCommand?.trim() || ""
        };

        set((state) => {
          const nextTabs = [...state.tabs, finalTab];
          return {
            tabs: nextTabs,
            tabOrder: [...normalizeTabOrder(state.tabOrder, state.tabs), finalTab.id],
            activeTabId: finalTab.id
          };
        });

        return finalTab.id;
      },

      setActiveTabId: (tabId) => {
        set(() => ({
          activeTabId: tabId
        }));
      },

      renameTerminalTab: (tabId, name) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, name: name.trim() || tab.name } : tab))
        }));
      },

      reorderTerminalTabs: (activeTabId, overTabId) => {
        set((state) => ({
          tabOrder: moveTabOrder(normalizeTabOrder(state.tabOrder, state.tabs), activeTabId, overTabId)
        }));
      },

      closeTerminalTab: (tabId) => {
        get().closeTerminalTabsByIds([tabId]);
      },

      closeTerminalTabsByIds: (tabIds) => {
        if (tabIds.length === 0) return;
        const closeSet = new Set(tabIds);

        set((state) => {
          const nextTabs = state.tabs.filter((tab) => !closeSet.has(tab.id));
          const nextTabOrder = normalizeTabOrder(state.tabOrder, nextTabs);
          const activeExists = nextTabs.some((tab) => tab.id === state.activeTabId);
          const nextActiveId = activeExists ? state.activeTabId : nextTabOrder[0] || "";

          return {
            tabs: nextTabs,
            tabOrder: nextTabOrder,
            activeTabId: nextActiveId
          };
        });
      },

      setTerminalInputDraft: (tabId, draft) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => (tab.id === tabId ? { ...tab, inputDraft: draft } : tab))
        }));
      },

      appendTerminalOutput: (tabId, line) => {
        set((state) => ({
          tabs: state.tabs.map((tab) => {
            if (tab.id !== tabId) return tab;
            return {
              ...tab,
              outputs: [
                ...tab.outputs,
                {
                  id: makeId("terminal-line"),
                  createdAt: nowIso(),
                  ...line
                }
              ]
            };
          })
        }));
      },

      copyCommandToActiveTerminal: (command) => {
        const normalized = command.trim();
        if (!normalized) return;

        set((state) => {
          const activeId = state.activeTabId || normalizeTabOrder(state.tabOrder, state.tabs)[0];
          if (!activeId) return state;

          return {
            tabs: state.tabs.map((tab) => (tab.id === activeId ? { ...tab, inputDraft: normalized } : tab))
          };
        });
      },

      copyCommandToNewTerminal: (command, commandName) => {
        const normalized = command.trim();
        if (!normalized) return "";
        return get().createTerminalTab(normalized, commandName ? `Terminal · ${commandName}` : undefined);
      }
    }),
    {
      name: "ui.terminal-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      skipHydration: true,
      partialize: (state) => ({
        tabs: state.tabs,
        tabOrder: state.tabOrder,
        activeTabId: state.activeTabId
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<TerminalState>;
        const tabs = Array.isArray(state.tabs) ? state.tabs : current.tabs;
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
