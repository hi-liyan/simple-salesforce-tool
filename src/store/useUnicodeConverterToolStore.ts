import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { tauriSqliteStorage } from "./tauriStorage.ts";
import {
  DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT,
  UNICODE_CONVERTER_HISTORY_LIMIT,
  createUnicodeConverterHistoryEntry,
  dedupeAndCapUnicodeConverterHistory,
  deleteUnicodeConverterHistoryEntry,
  normalizeUnicodeConverterToolPersistedState,
  type UnicodeConverterHistoryEntry,
  type UnicodeConverterMode,
  type UnicodeConverterOutputFormat
} from "../features/main/ToolsPanel/logic/unicodeConverter.ts";

// Unicode 工具状态：维护当前输入、输出、输出格式与历史记录。
type UnicodeConverterToolState = {
  // 当前输入文本。
  inputText: string;
  // 当前输出文本。
  outputText: string;
  // 当前输出格式。
  outputFormat: UnicodeConverterOutputFormat;
  // 历史记录列表。
  history: UnicodeConverterHistoryEntry[];
  // 更新输入文本。
  setInputText: (inputText: string) => void;
  // 更新输出文本。
  setOutputText: (outputText: string) => void;
  // 更新输出格式。
  setOutputFormat: (outputFormat: UnicodeConverterOutputFormat) => void;
  // 应用一条历史记录到当前编辑区。
  applyHistoryEntry: (entryId: string) => void;
  // 记录一次转换动作到历史。
  pushHistoryEntry: (mode: UnicodeConverterMode, inputText: string, outputText: string) => UnicodeConverterHistoryEntry | null;
  // 删除指定历史记录。
  deleteHistoryEntry: (entryId: string) => void;
  // 清空全部历史记录。
  clearHistory: () => void;
  // 重置当前编辑区。
  resetDraft: () => void;
  // 仅清空当前输出结果。
  clearOutput: () => void;
};

// 持久化切片：只保留稳定且需要恢复的字段。
type PersistedUnicodeConverterToolState = Pick<
  UnicodeConverterToolState,
  "inputText" | "outputText" | "outputFormat" | "history"
>;

// 生成随机历史主键：确保每次转换都有独立记录。
function makeUnicodeConverterHistoryId(): string {
  return `unicode-history-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

// Unicode 工具持久化 Store：进入工具页后按需恢复。
export const useUnicodeConverterToolStore = create<UnicodeConverterToolState>()(
  persist(
    (set, get) => ({
      inputText: "",
      outputText: "",
      outputFormat: DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT,
      history: [],

      setInputText: (inputText) => {
        set(() => ({
          inputText
        }));
      },

      setOutputText: (outputText) => {
        set(() => ({
          outputText
        }));
      },

      setOutputFormat: (outputFormat) => {
        set(() => ({
          outputFormat
        }));
      },

      applyHistoryEntry: (entryId) => {
        set((state) => {
          const target = state.history.find((item) => item.id === entryId);
          if (!target) return state;
          return {
            inputText: target.inputText,
            outputText: target.outputText,
            outputFormat: target.outputFormat
          };
        });
      },

      pushHistoryEntry: (mode, inputText, outputText) => {
        const trimmedInputText = inputText.trim();
        if (!trimmedInputText || !outputText) return null;

        const nextEntry = createUnicodeConverterHistoryEntry(
          makeUnicodeConverterHistoryId(),
          mode,
          trimmedInputText,
          outputText,
          new Date().toISOString(),
          get().outputFormat
        );

        set((state) => ({
          inputText: trimmedInputText,
          outputText,
          history: dedupeAndCapUnicodeConverterHistory(state.history, nextEntry, UNICODE_CONVERTER_HISTORY_LIMIT)
        }));

        return nextEntry;
      },

      deleteHistoryEntry: (entryId) => {
        set((state) => ({
          history: deleteUnicodeConverterHistoryEntry(state.history, entryId)
        }));
      },

      clearHistory: () => {
        set((state) => ({
          history: deleteUnicodeConverterHistoryEntry(state.history)
        }));
      },

      resetDraft: () => {
        set(() => ({
          inputText: "",
          outputText: "",
          outputFormat: DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT
        }));
      },

      clearOutput: () => {
        set(() => ({
          outputText: ""
        }));
      }
    }),
    {
      name: "ui.unicode-converter-tool-store",
      storage: createJSONStorage(() => tauriSqliteStorage),
      skipHydration: true,
      partialize: (state): PersistedUnicodeConverterToolState => ({
        inputText: state.inputText,
        outputText: state.outputText,
        outputFormat: state.outputFormat,
        history: state.history
      }),
      merge: (persisted, current) => ({
        ...current,
        ...normalizeUnicodeConverterToolPersistedState(persisted)
      })
    }
  )
);
