import { create } from "zustand";

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

// 每个数据源下的终端工作区快照（仅保存终端 Tab，不保存命令库）。
type PersistedSourceTerminalState = {
  // 当前数据源的终端 Tabs。
  tabs: TerminalTab[];
  // 当前激活终端 Tab。
  activeTabId: string;
};

// 终端状态 Store。
type TerminalState = {
  // 当前终端状态所属数据源 ID。
  sourceId: string;
  // 按数据源分桶存储终端 Tab 状态。
  sourceStateBySourceId: Record<string, PersistedSourceTerminalState>;
  // 当前可见终端 Tabs。
  tabs: TerminalTab[];
  // 当前激活终端 Tab ID。
  activeTabId: string;
  // 切换数据源并恢复终端 Tab 状态。
  switchSource: (sourceId: string) => void;
  // 新建终端 Tab。
  createTerminalTab: (seedCommand?: string, seedTitle?: string) => string;
  // 激活终端 Tab。
  setActiveTabId: (tabId: string) => void;
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

// 将当前 source 运行态写回快照。
function upsertSourceState(
  sourceStateBySourceId: Record<string, PersistedSourceTerminalState>,
  sourceId: string,
  tabs: TerminalTab[],
  activeTabId: string
): Record<string, PersistedSourceTerminalState> {
  if (!sourceId) return sourceStateBySourceId;
  return {
    ...sourceStateBySourceId,
    [sourceId]: {
      tabs,
      activeTabId
    }
  };
}

// 恢复指定 source 的终端 Tab 状态。
function restoreSourceState(
  sourceStateBySourceId: Record<string, PersistedSourceTerminalState>,
  sourceId: string
): { tabs: TerminalTab[]; activeTabId: string } {
  if (!sourceId) return { tabs: [], activeTabId: "" };

  const sourceState = sourceStateBySourceId[sourceId];
  if (!sourceState || !Array.isArray(sourceState.tabs) || sourceState.tabs.length === 0) return { tabs: [], activeTabId: "" };

  const activeExists = sourceState.tabs.some((tab) => tab.id === sourceState.activeTabId);
  return {
    tabs: sourceState.tabs,
    activeTabId: activeExists ? sourceState.activeTabId : sourceState.tabs[0]?.id || ""
  };
}

// 终端 Store：仅维护进程运行期内的终端 Tab 状态（不持久化到 SQLite）。
export const useTerminalStore = create<TerminalState>()((set, get) => ({
  sourceId: "",
  sourceStateBySourceId: {},
  tabs: [],
  activeTabId: "",

  switchSource: (nextSourceId) =>
    set((state) => {
      if (state.sourceId === nextSourceId) return state;
      const nextMap = upsertSourceState(state.sourceStateBySourceId, state.sourceId, state.tabs, state.activeTabId);
      const restored = restoreSourceState(nextMap, nextSourceId);
      return {
        sourceId: nextSourceId,
        sourceStateBySourceId: nextMap,
        tabs: restored.tabs,
        activeTabId: restored.activeTabId
      };
    }),

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
        activeTabId: finalTab.id,
        sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, nextTabs, finalTab.id)
      };
    });

    return finalTab.id;
  },

  setActiveTabId: (tabId) => {
    set((state) => ({
      activeTabId: tabId,
      sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, state.tabs, tabId)
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
      const activeExists = nextTabs.some((tab) => tab.id === state.activeTabId);
      const nextActiveId = activeExists ? state.activeTabId : nextTabs[0]?.id || "";

      return {
        tabs: nextTabs,
        activeTabId: nextActiveId,
        sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, nextTabs, nextActiveId)
      };
    });
  },

  setTerminalInputDraft: (tabId, draft) => {
    set((state) => {
      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== tabId) return tab;
        return {
          ...tab,
          inputDraft: draft
        };
      });
      return {
        tabs: nextTabs,
        sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, nextTabs, state.activeTabId)
      };
    });
  },

  appendTerminalOutput: (tabId, line) => {
    set((state) => {
      const nextTabs = state.tabs.map((tab) => {
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
      });
      return {
        tabs: nextTabs,
        sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, nextTabs, state.activeTabId)
      };
    });
  },

  copyCommandToActiveTerminal: (command) => {
    const normalized = command.trim();
    if (!normalized) return;

    set((state) => {
      const activeId = state.activeTabId || state.tabs[0]?.id;
      if (!activeId) return state;

      const nextTabs = state.tabs.map((tab) => {
        if (tab.id !== activeId) return tab;
        return {
          ...tab,
          inputDraft: normalized
        };
      });

      return {
        tabs: nextTabs,
        sourceStateBySourceId: upsertSourceState(state.sourceStateBySourceId, state.sourceId, nextTabs, activeId)
      };
    });
  },

  copyCommandToNewTerminal: (command, commandName) => {
    const normalized = command.trim();
    if (!normalized) return "";
    return get().createTerminalTab(normalized, commandName ? `Terminal · ${commandName}` : undefined);
  }
}));
