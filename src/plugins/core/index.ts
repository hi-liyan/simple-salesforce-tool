import type { PluginManifest } from "./types.ts";

export * from "./types.ts";
export * from "./registry.ts";
export * from "./createPluginContext.ts";
export * from "./host.tsx";

// 插件定义辅助函数：提供完整 TypeScript 类型推断与校验。
export function definePlugin(manifest: PluginManifest): PluginManifest {
  return manifest;
}
