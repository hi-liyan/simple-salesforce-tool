import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriSqliteStorage } from "./tauriStorage";

// 终端命令项：包含显示名称与实际命令文本。
export type TerminalCommandItem = {
  // 命令主键。
  id: string;
  // 命令名称。
  name: string;
  // 命令正文。
  command: string;
  // 创建时间。
  createdAt: string;
  // 更新时间。
  updatedAt: string;
};

// 命令组：用于组织常用命令。
export type TerminalCommandGroup = {
  // 分组主键。
  id: string;
  // 分组名称。
  name: string;
  // 分组内命令列表。
  commands: TerminalCommandItem[];
  // 创建时间。
  createdAt: string;
  // 更新时间。
  updatedAt: string;
};

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

// 每个数据源下的终端工作区快照。
type PersistedSourceTerminalState = {
  // 当前数据源的命令组。
  commandGroups: TerminalCommandGroup[];
  // 当前数据源的终端 Tabs。
  tabs: TerminalTab[];
  // 当前激活终端 Tab。
  activeTabId: string;
};

// 终端状态 Store。
type TerminalState = {
  // 当前终端状态所属数据源 ID。
  sourceId: string;
  // 按数据源分桶存储终端状态。
  sourceStateBySourceId: Record<string, PersistedSourceTerminalState>;
  // 当前可见命令组。
  commandGroups: TerminalCommandGroup[];
  // 当前可见终端 Tabs。
  tabs: TerminalTab[];
  // 当前激活终端 Tab ID。
  activeTabId: string;
  // 切换数据源并恢复终端状态。
  switchSource: (sourceId: string) => void;
  // 新增命令组。
  createCommandGroup: (name: string) => string;
  // 新增命令。
  createCommand: (groupId: string, name: string, command: string) => string;
  // 更新命令。
  updateCommand: (groupId: string, commandId: string, payload: { name: string; command: string }) => void;
  // 删除命令。
  deleteCommand: (groupId: string, commandId: string) => void;
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

// 生成默认命令组。
function createDefaultCommandGroups(): TerminalCommandGroup[] {
  const createdAt = nowIso();
  return [
    {
      id: makeId("terminal-group"),
      name: "常用",
      commands: [
        {
          id: makeId("terminal-cmd"),
          name: "安装依赖",
          command: "npm install",
          createdAt,
          updatedAt: createdAt
        },
        {
          id: makeId("terminal-cmd"),
          name: "启动开发",
          command: "npm run dev",
          createdAt,
          updatedAt: createdAt
        }
      ],
      createdAt,
      updatedAt: createdAt
    }
  ];
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
  commandGroups: TerminalCommandGroup[],
  tabs: TerminalTab[],
  activeTabId: string
): Record<string, PersistedSourceTerminalState> {
  if (!sourceId) return sourceStateBySourceId;
  return {
    ...sourceStateBySourceId,
    [sourceId]: {
      commandGroups,
      tabs,
      activeTabId
    }
  };
}

// 恢复指定 source 的终端状态。
function restoreSourceState(
  sourceStateBySourceId: Record<string, PersistedSourceTerminalState>,
  sourceId: string
): { commandGroups: TerminalCommandGroup[]; tabs: TerminalTab[]; activeTabId: string } {
  if (!sourceId) {
    const defaultTab = createDefaultTerminalTab(1);
    return {
      commandGroups: createDefaultCommandGroups(),
      tabs: [defaultTab],
      activeTabId: defaultTab.id
    };
  }

  const sourceState = sourceStateBySourceId[sourceId];
  if (!sourceState) {
    const defaultTab = createDefaultTerminalTab(1);
    return {
      commandGroups: createDefaultCommandGroups(),
      tabs: [defaultTab],
      activeTabId: defaultTab.id
    };
  }

  const commandGroups = Array.isArray(sourceState.commandGroups) ? sourceState.commandGroups : createDefaultCommandGroups();
  const tabs = Array.isArray(sourceState.tabs) && sourceState.tabs.length > 0 ? sourceState.tabs : [createDefaultTerminalTab(1)];
  const activeExists = tabs.some((tab) => tab.id === sourceState.activeTabId);

  return {
    commandGroups,
    tabs,
    activeTabId: activeExists ? sourceState.activeTabId : tabs[0].id
  };
}

// 兼容旧结构：确保恢复后结构稳定。
function normalizeSourceStateMap(state: Partial<TerminalState>): Record<string, PersistedSourceTerminalState> {
  const rawMap = state.sourceStateBySourceId;
  if (!rawMap || typeof rawMap !== "object") return {};

  const normalizedMap: Record<string, PersistedSourceTerminalState> = {};
  Object.entries(rawMap).forEach(([sourceId, sourceState]) => {
    if (!sourceId || !sourceState || typeof sourceState !== "object") return;
    const groups = Array.isArray(sourceState.commandGroups) ? sourceState.commandGroups : createDefaultCommandGroups();
    const tabs = Array.isArray(sourceState.tabs) && sourceState.tabs.length > 0 ? sourceState.tabs : [createDefaultTerminalTab(1)];
    const activeTabId = typeof sourceState.activeTabId === "string" ? sourceState.activeTabId : tabs[0].id;
    normalizedMap[sourceId] = {
      commandGroups: groups,
      tabs,
      activeTabId
    };
  });
  return normalizedMap;
}

// 终端 Store：按数据源维度维护命令与终端状态。
export const useTerminalStore = create<TerminalState>()(
  persist(
    (set, get) => ({
      sourceId: "",
      sourceStateBySourceId: {},
      commandGroups: createDefaultCommandGroups(),
      tabs: [createDefaultTerminalTab(1)],
      activeTabId: "",

      switchSource: (nextSourceId) =>
        set((state) => {
          if (state.sourceId === nextSourceId) return state;
          const nextMap = upsertSourceState(state.sourceStateBySourceId, state.sourceId, state.commandGroups, state.tabs, state.activeTabId);
          const restored = restoreSourceState(nextMap, nextSourceId);
          return {
            sourceId: nextSourceId,
            sourceStateBySourceId: nextMap,
            commandGroups: restored.commandGroups,
            tabs: restored.tabs,
            activeTabId: restored.activeTabId
          };
        }),

      createCommandGroup: (name) => {
        const normalizedName = name.trim();
        if (!normalizedName) return "";
        const createdAt = nowIso();
        const group: TerminalCommandGroup = {
          id: makeId("terminal-group"),
          name: normalizedName,
          commands: [],
          createdAt,
          updatedAt: createdAt
        };
        set((state) => {
          const nextGroups = [...state.commandGroups, group];
          return {
            commandGroups: nextGroups,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              nextGroups,
              state.tabs,
              state.activeTabId
            )
          };
        });
        return group.id;
      },

      createCommand: (groupId, name, command) => {
        const normalizedName = name.trim();
        const normalizedCommand = command.trim();
        if (!groupId || !normalizedName || !normalizedCommand) return "";

        const createdAt = nowIso();
        const newCommand: TerminalCommandItem = {
          id: makeId("terminal-cmd"),
          name: normalizedName,
          command: normalizedCommand,
          createdAt,
          updatedAt: createdAt
        };

        set((state) => {
          const nextGroups = state.commandGroups.map((group) => {
            if (group.id !== groupId) return group;
            return {
              ...group,
              commands: [...group.commands, newCommand],
              updatedAt: nowIso()
            };
          });
          return {
            commandGroups: nextGroups,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              nextGroups,
              state.tabs,
              state.activeTabId
            )
          };
        });

        return newCommand.id;
      },

      updateCommand: (groupId, commandId, payload) => {
        const normalizedName = payload.name.trim();
        const normalizedCommand = payload.command.trim();
        if (!groupId || !commandId || !normalizedName || !normalizedCommand) return;

        set((state) => {
          const nextGroups = state.commandGroups.map((group) => {
            if (group.id !== groupId) return group;
            const nextCommands = group.commands.map((item) => {
              if (item.id !== commandId) return item;
              return {
                ...item,
                name: normalizedName,
                command: normalizedCommand,
                updatedAt: nowIso()
              };
            });
            return {
              ...group,
              commands: nextCommands,
              updatedAt: nowIso()
            };
          });

          return {
            commandGroups: nextGroups,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              nextGroups,
              state.tabs,
              state.activeTabId
            )
          };
        });
      },

      deleteCommand: (groupId, commandId) => {
        if (!groupId || !commandId) return;
        set((state) => {
          const nextGroups = state.commandGroups.map((group) => {
            if (group.id !== groupId) return group;
            return {
              ...group,
              commands: group.commands.filter((item) => item.id !== commandId),
              updatedAt: nowIso()
            };
          });
          return {
            commandGroups: nextGroups,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              nextGroups,
              state.tabs,
              state.activeTabId
            )
          };
        });
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
            activeTabId: finalTab.id,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              state.commandGroups,
              nextTabs,
              finalTab.id
            )
          };
        });

        return finalTab.id;
      },

      setActiveTabId: (tabId) => {
        set((state) => ({
          activeTabId: tabId,
          sourceStateBySourceId: upsertSourceState(
            state.sourceStateBySourceId,
            state.sourceId,
            state.commandGroups,
            state.tabs,
            tabId
          )
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
          const safeTabs = nextTabs.length > 0 ? nextTabs : [createDefaultTerminalTab(1)];
          const nextActiveId = closeSet.has(state.activeTabId) ? safeTabs[0].id : state.activeTabId || safeTabs[0].id;

          return {
            tabs: safeTabs,
            activeTabId: nextActiveId,
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              state.commandGroups,
              safeTabs,
              nextActiveId
            )
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
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              state.commandGroups,
              nextTabs,
              state.activeTabId
            )
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
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              state.commandGroups,
              nextTabs,
              state.activeTabId
            )
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
            sourceStateBySourceId: upsertSourceState(
              state.sourceStateBySourceId,
              state.sourceId,
              state.commandGroups,
              nextTabs,
              activeId
            )
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
      // 与其他 Store 一致：由 MainPage 手动控制 hydration 时机。
      skipHydration: true,
      partialize: (state) => ({
        sourceId: state.sourceId,
        sourceStateBySourceId: upsertSourceState(
          state.sourceStateBySourceId,
          state.sourceId,
          state.commandGroups,
          state.tabs,
          state.activeTabId
        )
      }),
      merge: (persisted, current) => {
        const state = persisted as Partial<TerminalState>;
        const sourceId = typeof state.sourceId === "string" ? state.sourceId : current.sourceId;
        const sourceStateBySourceId = normalizeSourceStateMap(state);
        const restored = restoreSourceState(sourceStateBySourceId, sourceId);
        return {
          ...current,
          ...state,
          sourceId,
          sourceStateBySourceId,
          commandGroups: restored.commandGroups,
          tabs: restored.tabs,
          activeTabId: restored.activeTabId
        };
      }
    }
  )
);
