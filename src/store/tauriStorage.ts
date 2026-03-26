import { type PersistStorage, type StateStorage, type StorageValue } from "zustand/middleware";
import { api } from "../api/index.ts";

// 写入门控：rehydrate 完成前阻止 setItem，防止默认空值覆盖持久化数据。
let writeEnabled = false;
// 持久化写入防抖时间：合并输入、拖拽等高频状态更新，避免每次都直写 SQLite。
const STORAGE_WRITE_DEBOUNCE_MS = 220;
type PendingStoragePayload =
  | {
      kind: "raw";
      value: string;
    }
  | {
      kind: "json";
      value: unknown;
    };

// 各持久化 key 的待提交值：始终只保留最后一次写入结果。
const pendingStoragePayloadByKey: Record<string, PendingStoragePayload | undefined> = {};
// 各持久化 key 的延迟提交定时器：用于把连续写入折叠成一次真正落盘。
const pendingStorageTimerByKey: Record<string, ReturnType<typeof globalThis.setTimeout> | undefined> = {};

// 真正执行 SQLite 写入：供防抖调度器统一复用。
async function persistStorageValue(key: string, value: string): Promise<void> {
  try {
    await api.saveUiState(key, value);
  } catch {
    // 写入失败不中断业务流程。
  }
}

// 调度指定 key 的持久化写入：连续更新时仅提交最后一次值，并把重序列化推迟到真正落盘时执行。
function scheduleStorageWrite(key: string, payload: PendingStoragePayload): void {
  pendingStoragePayloadByKey[key] = payload; // 行内注释：始终覆盖为最新快照，避免把中间态逐条落盘。
  const currentTimer = pendingStorageTimerByKey[key];
  if (currentTimer) {
    globalThis.clearTimeout(currentTimer);
  }

  pendingStorageTimerByKey[key] = globalThis.setTimeout(() => {
    delete pendingStorageTimerByKey[key];
    const pendingPayload = pendingStoragePayloadByKey[key];
    delete pendingStoragePayloadByKey[key];
    if (!pendingPayload) return;

    const serializedValue = pendingPayload.kind === "json"
      ? JSON.stringify(pendingPayload.value)
      : pendingPayload.value;
    void persistStorageValue(key, serializedValue);
  }, STORAGE_WRITE_DEBOUNCE_MS);
}

// 在所有 store rehydrate 完成后调用，开启写入。
export function enableStorageWrite() {
  writeEnabled = true;
}

// 读取并解析 JSON 持久化快照：供自定义 PersistStorage 复用。
async function loadJsonStorageValue<T>(key: string): Promise<StorageValue<T> | null> {
  try {
    const rawValue = await api.getUiState(key);
    if (!rawValue) return null;
    return JSON.parse(rawValue) as StorageValue<T>;
  } catch {
    return null;
  }
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
    scheduleStorageWrite(key, { kind: "raw", value }); // 行内注释：把高频 UI 状态更新合并后再落盘，降低主线程与跨端 I/O 压力。
  },
  removeItem: async (key: string): Promise<void> => {
    if (!writeEnabled) return;
    scheduleStorageWrite(key, { kind: "raw", value: "" }); // 行内注释：删除同样走合并写入，避免 reset 场景连续触发多次 SQLite 更新。
  }
};

// Query/Terminal 等大状态 store 专用 JSON 持久化适配器：把 stringify 与 SQLite 写入都延后到防抖窗口结束后执行。
export function createDebouncedTauriJsonStorage<T>(): PersistStorage<T> {
  return {
    getItem: async (key: string): Promise<StorageValue<T> | null> => loadJsonStorageValue<T>(key),
    setItem: async (key: string, value: StorageValue<T>): Promise<void> => {
      if (!writeEnabled) return;
      scheduleStorageWrite(key, { kind: "json", value }); // 行内注释：先暂存对象快照，避免每次状态变更都立即 stringify。
    },
    removeItem: async (key: string): Promise<void> => {
      if (!writeEnabled) return;
      scheduleStorageWrite(key, { kind: "raw", value: "" }); // 行内注释：删除仍复用同一调度通道，保证顺序与覆盖语义一致。
    }
  };
}
