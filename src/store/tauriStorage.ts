import { type PersistStorage, type StateStorage, type StorageValue } from "zustand/middleware";
import { api } from "../api/index.ts";

// 写入门控：rehydrate 完成前阻止 setItem，防止默认空值覆盖持久化数据。
let writeEnabled = false;
// 持久化写入防抖时间：合并输入、拖拽等高频状态更新，避免每次都直写 SQLite。
const STORAGE_WRITE_DEBOUNCE_MS = 220;
// 增量设置前缀：在 app_settings 中隔离前端各 Store 切片。
const SETTING_KEY_PREFIX = "zustand:";

type PendingStoragePayload =
  | {
      kind: "raw";
      value: string;
    }
  | {
      kind: "json";
      value: unknown;
    };

// 待提交的最后一次状态变更：按 store key 独立合并与落盘，互不影响。
const pendingStoragePayloadByKey: Record<string, PendingStoragePayload | undefined> = {};
// 对应 key 的延迟定时器。
const pendingStorageTimerByKey: Record<string, ReturnType<typeof globalThis.setTimeout> | undefined> = {};

// 构建隔离后的 app_settings 键名。
export function buildStoreSettingKey(key: string): string {
  return `${SETTING_KEY_PREFIX}${key}`;
}

// 在所有 store rehydrate 完成后调用，开启写入。
export function enableStorageWrite() {
  writeEnabled = true;
}

// 调度指定 key 的增量持久化写入：仅更新当前 key 对应的 app_settings 行，不再全量覆写快照。
function scheduleStorageWrite(key: string, payload: PendingStoragePayload): void {
  pendingStoragePayloadByKey[key] = payload;
  const currentTimer = pendingStorageTimerByKey[key];
  if (currentTimer) {
    globalThis.clearTimeout(currentTimer);
  }

  pendingStorageTimerByKey[key] = globalThis.setTimeout(() => {
    delete pendingStorageTimerByKey[key];
    const pendingPayload = pendingStoragePayloadByKey[key];
    delete pendingStoragePayloadByKey[key];
    if (!pendingPayload) return;

    void (async () => {
      const settingKey = buildStoreSettingKey(key);
      try {
        if (pendingPayload.kind === "raw" && pendingPayload.value === "") {
          await api.deleteAppSetting(settingKey);
          return;
        }
        const rawValue =
          pendingPayload.kind === "json" ? JSON.stringify(pendingPayload.value) : pendingPayload.value;
        await api.setAppSetting(settingKey, rawValue);
      } catch {
        // 写入失败不中断业务流程。
      }
    })();
  }, STORAGE_WRITE_DEBOUNCE_MS);
}

// 读取并解析 JSON 持久化切片：供自定义 PersistStorage 复用。
async function loadJsonStorageValue<T>(key: string): Promise<StorageValue<T> | null> {
  const rawValue = await tauriSqliteStorage.getItem(key);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as StorageValue<T>;
  } catch {
    return null;
  }
}

// Zustand persist 的自定义存储后端：按 store key 增量读写 app_settings，彻底下线整包快照。
export const tauriSqliteStorage: StateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      return await api.getAppSetting(buildStoreSettingKey(key));
    } catch {
      return null;
    }
  },
  setItem: async (key: string, value: string): Promise<void> => {
    if (!writeEnabled) return;
    scheduleStorageWrite(key, { kind: "raw", value });
  },
  removeItem: async (key: string): Promise<void> => {
    if (!writeEnabled) return;
    scheduleStorageWrite(key, { kind: "raw", value: "" });
  }
};

// Query/App 等 JSON store 专用持久化适配器：把 stringify 与增量写回都延后到防抖窗口结束后执行。
export function createDebouncedTauriJsonStorage<T>(): PersistStorage<T> {
  return {
    getItem: async (key: string): Promise<StorageValue<T> | null> => loadJsonStorageValue<T>(key),
    setItem: async (key: string, value: StorageValue<T>): Promise<void> => {
      if (!writeEnabled) return;
      scheduleStorageWrite(key, { kind: "json", value });
    },
    removeItem: async (key: string): Promise<void> => {
      if (!writeEnabled) return;
      scheduleStorageWrite(key, { kind: "raw", value: "" });
    }
  };
}
