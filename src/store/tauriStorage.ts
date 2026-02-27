import { type StateStorage } from "zustand/middleware";
import { api } from "../api";

// 写入门控：rehydrate 完成前阻止 setItem，防止默认空值覆盖持久化数据。
let writeEnabled = false;

// 在所有 store rehydrate 完成后调用，开启写入。
export function enableStorageWrite() {
  writeEnabled = true;
}

// Zustand persist 的自定义存储后端：通过 Tauri invoke 读写 SQLite app_settings 表。
// 所有 store 共用此 adapter，未来扩展新页面状态时直接复用即可。
export const tauriSqliteStorage: StateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await api.getUiState(key);
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (!writeEnabled) return;
    try {
      await api.saveUiState(key, value);
    } catch {
      // 写入失败不中断业务流程。
    }
  },
  removeItem: async (key: string): Promise<void> => {
    if (!writeEnabled) return;
    try {
      await api.saveUiState(key, "");
    } catch {
      // 删除失败不中断业务流程。
    }
  }
};
