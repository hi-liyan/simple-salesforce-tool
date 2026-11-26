#!/usr/bin/env node
// 将包含 manifest.json 与 dist/ 的插件目录打包为 `.sstplugin` 专用格式（ZIP 归档）。
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

const pluginDir = path.resolve(process.argv[2] || ".");
const manifestPath = path.join(pluginDir, "manifest.json");

if (!existsSync(manifestPath)) {
  console.error(`错误：在 ${pluginDir} 中未找到 manifest.json`);
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
if (!manifest.id || !manifest.name || !manifest.version) {
  console.error("错误：manifest.json 必须包含 id、name、version 字段");
  process.exit(1);
}

const entryRel = String(manifest.entry || "dist/index.html").replace(/^\/+/, "");
if (!existsSync(path.join(pluginDir, entryRel))) {
  console.error(`错误：未找到插件入口文件 ${entryRel}`);
  process.exit(1);
}

const outFile = path.resolve(
  process.argv[3] || path.join(pluginDir, `${manifest.id}-${manifest.version}.sstplugin`)
);

if (process.platform === "win32") {
  const tempZip = `${outFile}.zip`;
  execFileSync(
    "powershell",
    [
      "-NoProfile",
      "-Command",
      `$ProgressPreference = 'SilentlyContinue'; Compress-Archive -Path '${path.join(pluginDir, "*")}' -DestinationPath '${tempZip}' -Force; Move-Item -Force '${tempZip}' '${outFile}'`
    ],
    { stdio: "inherit" }
  );
} else {
  execFileSync("zip", ["-r", outFile, "."], { cwd: pluginDir, stdio: "inherit" });
}

console.log(`打包成功: ${outFile}`);
