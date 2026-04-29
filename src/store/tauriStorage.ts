import { type PersistStorage, type StateStorage, type StorageValue } from "zustand/middleware";
import { api } from "../api/index.ts";
import type { WorkspaceSnapshotDto } from "../types/index.ts";
import {
  applyPersistedStateToWorkspaceSnapshot,
  createEmptyWorkspaceSnapshot,
  getPersistedStateFromWorkspaceSnapshot
} from "./workspaceSnapshot.ts";

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

// 待提交的最后一次状态变更：按 store key 合并。
const pendingStoragePayloadByKey: Record<string, PendingStoragePayload | undefined> = {};
// 对应 key 的延迟定时器。
const pendingStorageTimerByKey: Record<string, ReturnType<typeof globalThis.setTimeout> | undefined> = {};
// 前端工作区快照缓存：避免多 store 并发 hydration 时重复调用后端。
let workspaceSnapshotCache: WorkspaceSnapshotDto | undefined;

// 在所有 store rehydrate 完成后调用，开启写入。
export function enableStorageWrite() {
  writeEnabled = true;
}

// 从后端读取结构化工作区快照。
export async function loadWorkspaceSnapshotFromBackend(): Promise<WorkspaceSnapshotDto> {
  if (workspaceSnapshotCache) return workspaceSnapshotCache;
  try {
    workspaceSnapshotCache = await api.loadWorkspaceSnapshot();
  } catch {
    workspaceSnapshotCache = createEmptyWorkspaceSnapshot();
  }
  return workspaceSnapshotCache;
}

// 把最新工作区快照写回后端并刷新本地缓存。
async function persistWorkspaceSnapshot(snapshot: WorkspaceSnapshotDto): Promise<void> {
  try {
    await api.saveWorkspaceSnapshot(snapshot);
    workspaceSnapshotCache = snapshot;
  } catch {
    // 写入失败不中断业务流程。
  }
}

// 调度指定 key 的持久化写入：连续更新时仅提交最后一次值。
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
      const snapshot = await loadWorkspaceSnapshotFromBackend();
      const rawValue =
        pendingPayload.kind === "json" ? JSON.stringify(pendingPayload.value) : pendingPayload.value;
      const parsed = rawValue ? (JSON.parse(rawValue) as StorageValue<unknown>) : null;
      const nextSnapshot = applyPersistedStateToWorkspaceSnapshot(snapshot, key, parsed);
      await persistWorkspaceSnapshot(nextSnapshot);
    })();
  }, STORAGE_WRITE_DEBOUNCE_MS);
}

// 读取并解析 JSON 持久化快照：供自定义 PersistStorage 复用。
async function loadJsonStorageValue<T>(key: string): Promise<StorageValue<T> | null> {
  const rawValue = await tauriSqliteStorage.getItem(key);
  if (!rawValue) return null;
  try {
    return JSON.parse(rawValue) as StorageValue<T>;
  } catch {
    return null;
  }
}

// Zustand persist 的自定义存储后端：底层改为结构化 workspace snapshot，而不是黑盒 key/value。
export const tauriSqliteStorage: StateStorage = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const snapshot = await loadWorkspaceSnapshotFromBackend();
      const storageValue = getPersistedStateFromWorkspaceSnapshot(snapshot, key);
      if (!storageValue) return null;
      return JSON.stringify(storageValue);
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

// Query/Terminal 等大状态 store 专用 JSON 持久化适配器：把 stringify 与 snapshot 写回都延后到防抖窗口结束后执行。
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
