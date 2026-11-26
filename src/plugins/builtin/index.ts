import { registerPlugins, type PluginManifest } from "../core/index.ts";

// 内置插件清单列表：已全部迁移至独立 `.sstplugin` 插件包，不再随主程序内置注册。
export const BUILTIN_PLUGINS: PluginManifest[] = [];

// 注册全部内置插件（已清空，保留空实现以兼容历史调用）。
export function registerBuiltinPlugins(): void {
  if (BUILTIN_PLUGINS.length === 0) return;
  registerPlugins(BUILTIN_PLUGINS);
}
