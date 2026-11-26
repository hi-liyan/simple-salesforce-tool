import type { ComponentType } from "react";
import type { LucideIcon } from "lucide-react";

// 插件 UI 挂载位置：支持中央工作区标签、右侧停靠面板与独立弹窗。
export type PluginMountTarget = "workspace-tab" | "dock-right" | "modal";

// 插件分类标识：用于在插件中心分组展示。
export type PluginCategory = "dev-tool" | "terminal" | "network" | "database";

// 插件权限声明：用于限制插件可调用的宿主能力。
export type PluginPermission =
  | "storage"
  | "ipc:terminal"
  | "ipc:lan-receiver"
  | "workspace:read"
  | "workspace:write"
  | "clipboard";

// 插件通知样式。
export type PluginNoticeTone = "info" | "success" | "warning" | "error";

// 插件隔离持久化存储 API（底层按 pluginId 写入 plugin_kv_store）。
export interface PluginStorageApi {
  // 读取键值。
  get: <T = unknown>(key: string) => Promise<T | null>;
  // 写入键值。
  set: <T = unknown>(key: string, value: T) => Promise<void>;
  // 删除键值。
  remove: (key: string) => Promise<void>;
}

// 插件 UI 交互 API：统一调用宿主全局通知、确认框与标签操作。
export interface PluginUiApi {
  // 展示全局 Toast 通知。
  notify: (message: string, tone?: PluginNoticeTone) => void;
  // 在工作区打开指定插件或新建实例。
  openPlugin: (pluginId: string, params?: Record<string, unknown>) => void;
  // 关闭当前插件实例（如当前 Tab 或停靠面板）。
  closeSelf: () => void;
}

// 插件读取与受控写入工作区上下文 API。
export interface PluginWorkspaceApi {
  // 获取当前激活数据源摘要信息（只读）。
  getActiveSourceSummary: () => { id: string; name: string; sourceType: string } | null;
  // 获取当前编辑器选中的文本。
  getActiveEditorSelection: () => string;
  // 向当前激活控制台编辑器插入文本。
  insertTextToActiveEditor: (text: string) => void;
}

// 插件受控 IPC 调用 API。
export interface PluginIpcApi {
  // 调用后端 Tauri 命令（受插件权限校验保护）。
  invoke: <T = unknown>(command: string, args?: Record<string, unknown>) => Promise<T>;
}

// 插件事件总线 API：用于插件间轻量联动（如命令库 -> 终端执行）。
export interface PluginEventsApi {
  // 订阅事件并返回一个取消订阅函数。
  on: <T = unknown>(eventName: string, handler: (payload: T) => void) => () => void;
  // 广播事件。
  emit: <T = unknown>(eventName: string, payload: T) => void;
}

// 注入给插件的唯一运行时上下文。
export interface PluginContext {
  // 当前插件 ID。
  pluginId: string;
  // 隔离持久化存储。
  storage: PluginStorageApi;
  // 宿主 UI 交互能力。
  ui: PluginUiApi;
  // 工作区上下文能力。
  workspace: PluginWorkspaceApi;
  // 受控 IPC 通道。
  ipc: PluginIpcApi;
  // 插件事件总线。
  events: PluginEventsApi;
}

// 插件组件接收的标准 Props。
export interface PluginComponentProps {
  // 插件运行时上下文。
  ctx: PluginContext;
  // 可选启动参数（如从编辑器选中文本带入格式化插件）。
  launchParams?: Record<string, unknown>;
}

// 插件清单：每个内置或第三方插件必须导出的标准元数据契约。
export interface PluginManifest {
  // 全局唯一插件 ID（如 "builtin.json-formatter"）。
  id: string;
  // 插件显示名称。
  name: string;
  // 版本号。
  version: string;
  // 简短功能描述。
  description: string;
  // 插件图标。
  icon: LucideIcon;
  // 插件分类。
  category: PluginCategory;
  // 允许的挂载位置列表。
  mountTargets: PluginMountTarget[];
  // 是否允许在中央工作区同时打开多个实例 Tab。
  allowMultipleTabs?: boolean;
  // 所需宿主权限声明。
  permissions?: PluginPermission[];
  // 是否为外部 `.sstplugin` 安装包插件。
  isExternal?: boolean;
  // 外部插件启用状态（默认 true）。
  enabled?: boolean;
  // 懒加载入口组件。
  component: () => Promise<{ default: ComponentType<PluginComponentProps> }>;
  // 插件激活生命周期钩子（可选）。
  onActivate?: (ctx: PluginContext) => void | Promise<void>;
  // 插件停用生命周期钩子（可选）。
  onDeactivate?: (ctx: PluginContext) => void | Promise<void>;
}
