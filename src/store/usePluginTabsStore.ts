import { create } from "zustand";

// 工作区插件 Tab 条目：与 data/console Tab 平级展示在统一工作区 Tab 栏。
export type WorkspacePluginTab = {
  pluginId: string;
  title: string;
};

type PluginTabsState = {
  // 已打开的插件 Tab 列表。
  pluginTabs: WorkspacePluginTab[];
  // 最近一次请求激活的插件 ID（供 useWorkspaceTabs 同步激活焦点）。
  pendingActivatePluginId: string;
  // 打开或聚焦指定插件 Tab。
  openPluginTab: (pluginId: string, title: string) => void;
  // 关闭指定插件 Tab。
  closePluginTab: (pluginId: string) => void;
  // 批量关闭插件 Tab。
  closePluginTabsByIds: (pluginIds: string[]) => void;
  // 消费待激活标记。
  clearPendingActivatePluginId: () => void;
};

export const usePluginTabsStore = create<PluginTabsState>((set) => ({
  pluginTabs: [],
  pendingActivatePluginId: "",

  openPluginTab: (pluginId, title) =>
    set((state) => {
      const exists = state.pluginTabs.some((t) => t.pluginId === pluginId);
      return {
        pluginTabs: exists
          ? state.pluginTabs.map((t) => (t.pluginId === pluginId ? { ...t, title } : t))
          : [...state.pluginTabs, { pluginId, title }],
        pendingActivatePluginId: pluginId
      };
    }),

  closePluginTab: (pluginId) =>
    set((state) => ({
      pluginTabs: state.pluginTabs.filter((t) => t.pluginId !== pluginId),
      pendingActivatePluginId:
        state.pendingActivatePluginId === pluginId ? "" : state.pendingActivatePluginId
    })),

  closePluginTabsByIds: (pluginIds) =>
    set((state) => {
      const idSet = new Set(pluginIds);
      return {
        pluginTabs: state.pluginTabs.filter((t) => !idSet.has(t.pluginId)),
        pendingActivatePluginId: idSet.has(state.pendingActivatePluginId)
          ? ""
          : state.pendingActivatePluginId
      };
    }),

  clearPendingActivatePluginId: () => set({ pendingActivatePluginId: "" })
}));
