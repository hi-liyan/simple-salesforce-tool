import { createElement } from "react";
import { Puzzle } from "lucide-react";
import { PluginIframeHost } from "./PluginIframeHost.tsx";
import type { PluginCategory, PluginManifest, PluginMountTarget, PluginPermission } from "./types.ts";

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

// 注销指定插件（用于外部插件卸载）。
export function unregisterPlugin(pluginId: string): void {
  pluginRegistry.delete(pluginId);
}

// 将后端已安装的 `.sstplugin` 记录注册为前端沙箱插件。
export function registerExternalPluginRecord(record: {
  pluginId: string;
  name: string;
  version: string;
  description: string;
  category: string;
  manifestJson: string;
  enabled: boolean;
  grantedPermissions: string;
}): void {
  let parsedManifest: {
    mountTargets?: PluginMountTarget[];
    permissions?: PluginPermission[];
    entry?: string;
  } = {};
  try {
    parsedManifest = JSON.parse(record.manifestJson || "{}") as typeof parsedManifest;
  } catch {
    parsedManifest = {};
  }
  let permissions: PluginPermission[] = [];
  try {
    permissions = JSON.parse(record.grantedPermissions || "[]") as PluginPermission[];
  } catch {
    permissions = parsedManifest.permissions || [];
  }
  const entryPath = parsedManifest.entry || "dist/index.html";
  const mountTargets: PluginMountTarget[] =
    Array.isArray(parsedManifest.mountTargets) && parsedManifest.mountTargets.length > 0
      ? parsedManifest.mountTargets
      : ["workspace-tab"];

  registerPlugin({
    id: record.pluginId,
    name: record.name,
    version: record.version,
    description: record.description,
    icon: Puzzle,
    category: (record.category as PluginCategory) || "dev-tool",
    mountTargets,
    permissions,
    isExternal: true,
    enabled: record.enabled,
    component: async () => ({
      default: ({ ctx, launchParams }) =>
        createElement(PluginIframeHost, {
          pluginId: record.pluginId,
          entryPath,
          grantedPermissions: permissions,
          ctx,
          launchParams
        })
    })
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
