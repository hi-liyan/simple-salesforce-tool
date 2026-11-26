import { create } from "zustand";

// 自增实例序号：确保同一插件多次打开时拥有唯一 Tab 实例 ID。
let pluginTabInstanceSeq = 0;

// 工作区插件 Tab 条目：与 data/console Tab 平级展示在统一工作区 Tab 栏。
export type WorkspacePluginTab = {
  // 插件实例 Tab 唯一 ID（支持同一插件打开多个实例）。
  tabId: string;
  // 插件清单 ID。
  pluginId: string;
  // Tab 展示标题。
  title: string;
};

type PluginTabsState = {
  // 已打开的插件 Tab 列表。
  pluginTabs: WorkspacePluginTab[];
  // 最近一次请求激活的插件实例 Tab ID（供 useWorkspaceTabs 同步激活焦点）。
  pendingActivatePluginTabId: string;
  // 新建并激活一个插件实例 Tab（同一插件支持多开）。
  openPluginTab: (pluginId: string, title: string) => void;
  // 关闭指定插件实例 Tab（兼容传入 tabId 或 pluginId）。
  closePluginTab: (tabIdOrPluginId: string) => void;
  // 批量关闭插件实例 Tab。
  closePluginTabsByIds: (tabIds: string[]) => void;
  // 消费待激活标记。
  clearPendingActivatePluginTabId: () => void;
};

export const usePluginTabsStore = create<PluginTabsState>((set) => ({
  pluginTabs: [],
  pendingActivatePluginTabId: "",

  openPluginTab: (pluginId, title) =>
    set((state) => {
      pluginTabInstanceSeq += 1;
      const tabId = `${pluginId}::${pluginTabInstanceSeq}`; // 生成唯一实例 ID，支持同插件多开。
      return {
        pluginTabs: [...state.pluginTabs, { tabId, pluginId, title }],
        pendingActivatePluginTabId: tabId
      };
    }),

  closePluginTab: (tabIdOrPluginId) =>
    set((state) => {
      const matchedByTabId = state.pluginTabs.some((t) => t.tabId === tabIdOrPluginId);
      const nextTabs = matchedByTabId
        ? state.pluginTabs.filter((t) => t.tabId !== tabIdOrPluginId)
        : state.pluginTabs.filter((t) => t.pluginId !== tabIdOrPluginId);
      return {
        pluginTabs: nextTabs,
        pendingActivatePluginTabId:
          state.pendingActivatePluginTabId === tabIdOrPluginId ? "" : state.pendingActivatePluginTabId
      };
    }),

  closePluginTabsByIds: (tabIds) =>
    set((state) => {
      const idSet = new Set(tabIds);
      return {
        pluginTabs: state.pluginTabs.filter((t) => !idSet.has(t.tabId) && !idSet.has(t.pluginId)),
        pendingActivatePluginTabId: idSet.has(state.pendingActivatePluginTabId)
          ? ""
          : state.pendingActivatePluginTabId
      };
    }),

  clearPendingActivatePluginTabId: () => set({ pendingActivatePluginTabId: "" })
}));
