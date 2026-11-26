#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";

/**
 * 解析命令行参数：--version <ver> --tag <tag> --repo <owner/repo> --notes-file <path> --output <path>
 */
function parseArgs(argv) {
  const args = {
    version: "",
    tag: "",
    repo: process.env.GITHUB_REPOSITORY || "",
    notesFile: "release-notes.md",
    output: "latest.json"
  };
  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--version" && argv[i + 1]) {
      args.version = argv[++i].trim();
    } else if (token === "--tag" && argv[i + 1]) {
      args.tag = argv[++i].trim();
    } else if (token === "--repo" && argv[i + 1]) {
      args.repo = argv[++i].trim();
    } else if (token === "--notes-file" && argv[i + 1]) {
      args.notesFile = argv[++i].trim();
    } else if (token === "--output" && argv[i + 1]) {
      args.output = argv[++i].trim();
    }
  }
  return args;
}

/**
 * 在指定目录中查找首个匹配后缀的文件路径。
 */
function findFirstFile(dirPath, suffix) {
  if (!fs.existsSync(dirPath)) return null;
  const entries = fs.readdirSync(dirPath);
  const matched = entries.find((name) => name.endsWith(suffix));
  return matched ? path.join(dirPath, matched) : null;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.version || !args.tag || !args.repo) {
    throw new Error("缺少必要参数：--version / --tag / --repo");
  }

  const rootDir = process.cwd();
  const nsisDir = path.join(rootDir, "src-tauri", "target", "release", "bundle", "nsis");
  const msiDir = path.join(rootDir, "src-tauri", "target", "release", "bundle", "msi");

  // 优先使用 NSIS 安装包签名（与 passive 模式无缝配合），若无则回退 MSI 签名
  const sigPath = findFirstFile(nsisDir, ".exe.sig") || findFirstFile(msiDir, ".msi.sig");
  if (!sigPath) {
    console.log("未检测到 .sig 签名文件（可能尚未配置 TAURI_SIGNING_PRIVATE_KEY），跳过生成 latest.json");
    return;
  }

  const installerPath = sigPath.replace(/\.sig$/, "");
  if (!fs.existsSync(installerPath)) {
    throw new Error(`找到签名文件但缺少对应安装包: ${installerPath}`);
  }

  const signature = fs.readFileSync(sigPath, "utf8").trim();
  const installerFileName = path.basename(installerPath);
  // GitHub Releases 上传资产时会自动将文件名中的空格替换为英文句点 `.`，需同步转换以避免下载链接 404
  const releaseAssetFileName = installerFileName.replace(/\s+/g, ".");
  const notes = fs.existsSync(args.notesFile) ? fs.readFileSync(args.notesFile, "utf8").trim() : "";

  const manifest = {
    version: args.version,
    notes,
    pub_date: new Date().toISOString(),
    platforms: {
      "windows-x86_64": {
        signature,
        url: `https://github.com/${args.repo}/releases/download/${args.tag}/${encodeURIComponent(releaseAssetFileName)}`
      }
    }
  };

  fs.writeFileSync(path.resolve(rootDir, args.output), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`已生成 Tauri 更新清单: ${args.output} -> ${releaseAssetFileName}`);
}

main();
