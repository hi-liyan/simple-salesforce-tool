import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriSqliteStorage } from "./tauriStorage.ts";
import {
  DEFAULT_QR_CODE_OPTIONS,
  QR_CODE_HISTORY_LIMIT,
  createQrCodeHistoryEntry,
  dedupeAndCapQrCodeHistory,
  deleteQrCodeHistoryEntry,
  normalizeQrCodeOptions,
  normalizeQrCodeToolPersistedState,
  type QrCodeHistoryEntry,
  type QrCodeOptions
} from "../features/main/ToolsPanel/logic/qrCode.ts";

// 二维码工具状态：维护当前输入、参数与历史记录。
type QrCodeToolState = {
  // 当前输入文本。
  inputText: string;
  // 当前参数配置。
  options: QrCodeOptions;
  // 历史记录列表。
  history: QrCodeHistoryEntry[];
  // 更新当前输入文本。
  setInputText: (inputText: string) => void;
  // 更新当前参数。
  patchOptions: (patch: Partial<QrCodeOptions>) => void;
  // 应用一条历史记录到当前编辑区。
  applyHistoryEntry: (entryId: string) => void;
  // 记录一次生成动作到历史。
  pushHistoryEntry: (inputText: string) => QrCodeHistoryEntry | null;
  // 删除指定历史记录。
  deleteHistoryEntry: (entryId: string) => void;
  // 清空全部历史记录。
  clearHistory: () => void;
  // 重置当前编辑区。
  resetDraft: () => void;
};

// 持久化切片：仅包含真正需要落盘的稳定状态。
type PersistedQrCodeToolState = Pick<QrCodeToolState, "inputText" | "options" | "history">;

// 生成随机历史主键：确保每次生成都有独立记录。
function makeQrCodeHistoryId(): string {
  return `qr-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// 二维码工具持久化 Store：进入工具页时按需恢复。
export const useQrCodeToolStore = create<QrCodeToolState>()(
  persist(
    (set, get) => ({
      inputText: "",
      options: DEFAULT_QR_CODE_OPTIONS,
      history: [],

      setInputText: (inputText) => {
        set(() => ({
          inputText
        }));
      },

      patchOptions: (patch) => {
        set((state) => ({
          options: normalizeQrCodeOptions({
            ...state.options,
            ...patch
          })
        }));
      },

      applyHistoryEntry: (entryId) => {
        set((state) => {
          const target = state.history.find((item) => item.id === entryId);
          if (!target) return state;
          return {
            inputText: target.inputText,
            options: target.options
          };
        });
      },

      pushHistoryEntry: (inputText) => {
        const trimmedInputText = inputText.trim();
        if (!trimmedInputText) return null;

        const nextEntry = createQrCodeHistoryEntry(
          makeQrCodeHistoryId(),
          trimmedInputText,
          new Date().toISOString(),
          get().options
        );

        set((state) => ({
          inputText: trimmedInputText,
          history: dedupeAndCapQrCodeHistory(state.history, nextEntry, QR_CODE_HISTORY_LIMIT)
        }));

        return nextEntry;
      },

      deleteHistoryEntry: (entryId) => {
        set((state) => ({
          history: deleteQrCodeHistoryEntry(state.history, entryId)
        }));
      },

      clearHistory: () => {
        set((state) => ({
          history: deleteQrCodeHistoryEntry(state.history)
        }));
      },

      resetDraft: () => {
        set(() => ({
          inputText: "",
          options: DEFAULT_QR_CODE_OPTIONS
        }));
      }
    }),
    {
      name: "ui.qr-code-tool-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      skipHydration: true,
      partialize: (state): PersistedQrCodeToolState => ({
        inputText: state.inputText,
        options: state.options,
        history: state.history
      }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeQrCodeToolPersistedState(persisted)
      })
    }
  )
);
