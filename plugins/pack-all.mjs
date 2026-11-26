#!/usr/bin/env node
// 批量将 plugins/* 下的所有独立插件打包为 `.sstplugin` 专用格式，输出到 plugins/out/。
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const pluginsRoot = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1")));
const packScript = path.resolve(pluginsRoot, "..", "plugins-sdk", "pack-plugin.mjs");
const outDir = path.join(pluginsRoot, "out");
mkdirSync(outDir, { recursive: true });

const entries = readdirSync(pluginsRoot, { withFileTypes: true });
let count = 0;

for (const entry of entries) {
  if (!entry.isDirectory() || entry.name === "out") continue;
  const pluginDir = path.join(pluginsRoot, entry.name);
  const manifestPath = path.join(pluginDir, "manifest.json");
  if (!existsSync(manifestPath)) continue;

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const outFile = path.join(outDir, `${manifest.id}-${manifest.version}.sstplugin`);
  execFileSync(process.execPath, [packScript, pluginDir, outFile], { stdio: "inherit" });
  count += 1;
}

console.log(`全部完成，共打包 ${count} 个插件到 ${outDir}`);
