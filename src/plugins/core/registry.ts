import type { PluginCategory, PluginManifest, PluginMountTarget } from "./types.ts";

// 全局插件注册表：按 pluginId 存储已注册的插件清单。
const pluginRegistry = new Map<string, PluginManifest>();

// 注册插件（幂等覆盖，便于开发环境 HMR）。
export function registerPlugin(manifest: PluginManifest): void {
  pluginRegistry.set(manifest.id, manifest);
}

// 批量注册插件。
export function registerPlugins(manifests: PluginManifest[]): void {
  manifests.forEach((manifest) => {
    registerPlugin(manifest);
  });
}

// 根据 ID 获取插件清单。
export function getPlugin(pluginId: string): PluginManifest | undefined {
  return pluginRegistry.get(pluginId);
}

// 列出全部已注册插件。
export function listPlugins(): PluginManifest[] {
  return Array.from(pluginRegistry.values());
}

// 按挂载位置过滤插件列表。
export function listPluginsByMountTarget(target: PluginMountTarget): PluginManifest[] {
  return listPlugins().filter((plugin) => plugin.mountTargets.includes(target));
}

// 按分类过滤插件列表。
export function listPluginsByCategory(category: PluginCategory): PluginManifest[] {
  return listPlugins().filter((plugin) => plugin.category === category);
}
