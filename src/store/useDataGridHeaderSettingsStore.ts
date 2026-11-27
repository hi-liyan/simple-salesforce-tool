import { create } from "zustand";
import { api } from "../api";

// app_settings 持久化键名：按 key 独立读写表格表头偏好。
export const KEY_DATAGRID_SHOW_HEADER_TYPE = "datagrid.showHeaderFieldType";
export const KEY_DATAGRID_SHOW_HEADER_COMMENT = "datagrid.showHeaderFieldComment";

type DataGridHeaderSettingsState = {
  // 是否在表头展示字段类型行。
  showHeaderFieldType: boolean;
  // 是否在表头展示字段注释/标签行。
  showHeaderFieldComment: boolean;
  // 是否已完成从 app_settings 的首次水合。
  hydrated: boolean;
  // 异步水合表头偏好（仅首次调用触发 IPC）。
  hydrate: () => Promise<void>;
  // 更新是否展示表头字段类型并持久化。
  setShowHeaderFieldType: (next: boolean) => Promise<void>;
  // 更新是否展示表头字段注释并持久化。
  setShowHeaderFieldComment: (next: boolean) => Promise<void>;
};

// 记录正在进行中的水合 Promise，避免多表格同时挂载时重复请求。
let inflightHydratePromise: Promise<void> | null = null;

// DataGrid 表头显示偏好 Store：默认开启，支持设置中心实时联动与按 key 持久化。
export const useDataGridHeaderSettingsStore = create<DataGridHeaderSettingsState>((set, get) => ({
  showHeaderFieldType: true,
  showHeaderFieldComment: true,
  hydrated: false,

  hydrate: async () => {
    if (get().hydrated) return;
    if (inflightHydratePromise) return inflightHydratePromise;

    inflightHydratePromise = Promise.all([
      api.getAppSetting(KEY_DATAGRID_SHOW_HEADER_TYPE).catch(() => null),
      api.getAppSetting(KEY_DATAGRID_SHOW_HEADER_COMMENT).catch(() => null)
    ])
      .then(([typeRaw, commentRaw]) => {
        set({
          // 仅当显式存储为 "false" 时关闭，其余情况（含未配置）保持默认开启。
          showHeaderFieldType: typeRaw !== "false",
          showHeaderFieldComment: commentRaw !== "false",
          hydrated: true
        });
      })
      .finally(() => {
        inflightHydratePromise = null;
      });

    return inflightHydratePromise;
  },

  setShowHeaderFieldType: async (next) => {
    set({ showHeaderFieldType: next, hydrated: true });
    await api.setAppSetting(KEY_DATAGRID_SHOW_HEADER_TYPE, String(next));
  },

  setShowHeaderFieldComment: async (next) => {
    set({ showHeaderFieldComment: next, hydrated: true });
    await api.setAppSetting(KEY_DATAGRID_SHOW_HEADER_COMMENT, String(next));
  }
}));
