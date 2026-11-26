import { invoke } from "@tauri-apps/api/core";
import type { PluginContext, PluginNoticeTone } from "./types.ts";

// 全局插件事件总线：支持插件间松耦合通信。
const eventListeners = new Map<string, Set<(payload: unknown) => void>>();

// 订阅全局插件事件。
export function subscribePluginEvent(eventName: string, handler: (payload: unknown) => void): () => void {
  const listeners = eventListeners.get(eventName) || new Set();
  listeners.add(handler);
  eventListeners.set(eventName, listeners);
  return () => {
    listeners.delete(handler);
  };
}

// 广播全局插件事件。
export function emitPluginEvent(eventName: string, payload: unknown): void {
  const listeners = eventListeners.get(eventName);
  if (!listeners) return;
  listeners.forEach((handler) => {
    try {
      handler(payload);
    } catch {
      // 单个监听器异常不应阻断其他订阅方。
    }
  });
}

type CreatePluginContextDeps = {
  // 插件 ID。
  pluginId: string;
  // 宿主通知回调。
  onNotify: (message: string, tone?: PluginNoticeTone) => void;
  // 宿主打开其他插件回调。
  onOpenPlugin: (pluginId: string, params?: Record<string, unknown>) => void;
  // 宿主关闭当前插件实例回调。
  onCloseSelf: () => void;
  // 获取当前激活数据源摘要。
  getActiveSourceSummary: () => { id: string; name: string; sourceType: string } | null;
  // 获取当前编辑器选中文本。
  getActiveEditorSelection: () => string;
  // 向当前编辑器插入文本。
  insertTextToActiveEditor: (text: string) => void;
};

// 构建插件运行时上下文：严格隔离存储命名空间，禁止插件直接读写主应用内部 Store。
export function createPluginContext({
  pluginId,
  onNotify,
  onOpenPlugin,
  onCloseSelf,
  getActiveSourceSummary,
  getActiveEditorSelection,
  insertTextToActiveEditor
}: CreatePluginContextDeps): PluginContext {
  return {
    pluginId,
    storage: {
      get: async <T = unknown>(key: string): Promise<T | null> => {
        try {
          const raw = await invoke<string | null>("get_plugin_kv", { pluginId, key });
          if (!raw) return null;
          return JSON.parse(raw) as T;
        } catch {
          return null;
        }
      },
      set: async <T = unknown>(key: string, value: T): Promise<void> => {
        await invoke("set_plugin_kv", {
          pluginId,
          key,
          valueJson: JSON.stringify(value)
        });
      },
      remove: async (key: string): Promise<void> => {
        await invoke("delete_plugin_kv", { pluginId, key });
      }
    },
    ui: {
      notify: onNotify,
      openPlugin: onOpenPlugin,
      closeSelf: onCloseSelf
    },
    workspace: {
      getActiveSourceSummary,
      getActiveEditorSelection,
      insertTextToActiveEditor
    },
    ipc: {
      invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => invoke<T>(command, args)
    },
    events: {
      on: <T = unknown>(eventName: string, handler: (payload: T) => void) =>
        subscribePluginEvent(eventName, handler as (payload: unknown) => void),
      emit: <T = unknown>(eventName: string, payload: T) => emitPluginEvent(eventName, payload)
    }
  };
}
