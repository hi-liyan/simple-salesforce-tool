#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

/**
 * 解析命令行参数。
 * 支持：--bump <auto|patch|minor|major>、--repo <owner/repo>、--notes-file <path>、--dry-run
 */
function parseArgs(argv) {
  const args = {
    bump: "auto",
    repo: process.env.GITHUB_REPOSITORY || "",
    notesFile: "release-notes.md",
    dryRun: false
  };

  for (let i = 0; i < argv.length; i += 1) {
    const token = argv[i];
    if (token === "--bump" && argv[i + 1]) {
      args.bump = argv[i + 1].trim();
      i += 1;
    } else if (token === "--repo" && argv[i + 1]) {
      args.repo = argv[i + 1].trim();
      i += 1;
    } else if (token === "--notes-file" && argv[i + 1]) {
      args.notesFile = argv[i + 1].trim();
      i += 1;
    } else if (token === "--dry-run") {
      args.dryRun = true;
    }
  }

  const allowedBumps = new Set(["auto", "patch", "minor", "major"]);
  if (!allowedBumps.has(args.bump)) {
    throw new Error(`不支持的 bump 类型: ${args.bump}，可选值: auto, patch, minor, major`);
  }

  return args;
}

/**
 * 执行 Git 命令并返回去除首尾空白的标准输出。
 */
function runGit(gitArgs) {
  return execFileSync("git", gitArgs, { encoding: "utf8" }).trim();
}

/**
 * 查找仓库中最新的标准语义化版本 Tag（格式：vX.Y.Z）。
 */
function getLatestSemverTag() {
  const rawTags = runGit(["tag", "-l", "v*", "--sort=-v:refname"]);
  if (!rawTags) return null;

  const semverPattern = /^v\d+\.\d+\.\d+$/;
  const tags = rawTags
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((tag) => semverPattern.test(tag));

  return tags[0] ?? null;
}

/**
 * 获取从指定 Tag 到 HEAD 之间的提交列表（不含 Merge 提交与自动发布提交）。
 */
function getCommitsSinceTag(prevTag) {
  const range = prevTag ? `${prevTag}..HEAD` : "HEAD";
  // 使用 ASCII 控制符分隔字段与记录，避免提交正文含特殊符号导致解析错位
  const recordSep = "\x1e";
  const fieldSep = "\x1f";
  const format = `%H${fieldSep}%h${fieldSep}%s${fieldSep}%b${recordSep}`;

  const raw = runGit(["log", range, "--no-merges", `--pretty=format:${format}`]);
  if (!raw) return [];

  return raw
    .split(recordSep)
    .map((chunk) => chunk.trim())
    .filter(Boolean)
    .map((chunk) => {
      const [hash = "", shortHash = "", subject = "", body = ""] = chunk.split(fieldSep);
      return {
        hash: hash.trim(),
        shortHash: shortHash.trim(),
        subject: subject.trim(),
        body: body.trim()
      };
    })
    // 过滤掉 CI 自动生成的版本回写提交，避免干扰变更统计与说明生成
    .filter((commit) => !/^chore\(release\):/i.test(commit.subject));
}

/**
 * 解析单条提交的 Conventional Commits 信息。
 */
function parseConventionalCommit(commit) {
  const match = commit.subject.match(/^([a-zA-Z]+)(?:\(([^)]+)\))?(!)?:\s*(.+)$/);
  const hasBreakingBody = /BREAKING[ -]CHANGE:/i.test(commit.body);

  if (!match) {
    return {
      ...commit,
      type: "other",
      scope: "",
      description: commit.subject,
      breaking: hasBreakingBody
    };
  }

  const [, rawType, rawScope = "", bang = "", description] = match;
  return {
    ...commit,
    type: rawType.toLowerCase(),
    scope: rawScope.trim(),
    description: description.trim(),
    breaking: Boolean(bang) || hasBreakingBody
  };
}

/**
 * 根据历史 Tag、指定策略与提交记录计算下一语义化版本号。
 */
function computeNextVersion(prevTag, bumpMode, parsedCommits) {
  let major = 0;
  let minor = 1;
  let patch = 0;

  if (prevTag) {
    const [maj, min, pat] = prevTag.replace(/^v/, "").split(".").map((n) => Number.parseInt(n, 10));
    major = maj;
    minor = min;
    patch = pat;
  } else {
    // 若仓库尚无任何 v* Tag，则从当前 tauri.conf.json 或 0.1.0 起步
    return "0.1.0";
  }

  let effectiveBump = bumpMode;
  if (effectiveBump === "auto") {
    if (parsedCommits.some((c) => c.breaking)) {
      effectiveBump = "major";
    } else if (parsedCommits.some((c) => c.type === "feat")) {
      effectiveBump = "minor";
    } else {
      effectiveBump = "patch";
    }
  }

  if (effectiveBump === "major") {
    return `${major + 1}.0.0`;
  }
  if (effectiveBump === "minor") {
    return `${major}.${minor + 1}.0`;
  }
  return `${major}.${minor}.${patch + 1}`;
}

/**
 * 将提交记录按类型分类整理为中文 Release Notes Markdown。
 */
function buildReleaseNotes({ prevTag, nextTag, repo, parsedCommits }) {
  const categories = [
    { key: "breaking", title: "⚠️ 破坏性变更", items: [] },
    { key: "feat", title: "✨ 新增功能", items: [] },
    { key: "fix", title: "🐛 问题修复", items: [] },
    { key: "perf", title: "⚡ 性能优化", items: [] },
    { key: "refactor", title: "♻️ 代码重构", items: [] },
    { key: "test", title: "🧪 测试与质量", items: [] },
    { key: "docs_chore", title: "📝 文档与工程配置", items: [] },
    { key: "other", title: "📦 其他变更", items: [] }
  ];

  const categoryMap = new Map(categories.map((cat) => [cat.key, cat]));

  for (const commit of parsedCommits) {
    if (commit.breaking) {
      categoryMap.get("breaking").items.push(commit);
      continue;
    }

    if (commit.type === "feat") {
      categoryMap.get("feat").items.push(commit);
    } else if (commit.type === "fix") {
      categoryMap.get("fix").items.push(commit);
    } else if (commit.type === "perf") {
      categoryMap.get("perf").items.push(commit);
    } else if (commit.type === "refactor") {
      categoryMap.get("refactor").items.push(commit);
    } else if (commit.type === "test") {
      categoryMap.get("test").items.push(commit);
    } else if (["docs", "chore", "build", "ci", "style", "revert"].includes(commit.type)) {
      categoryMap.get("docs_chore").items.push(commit);
    } else {
      categoryMap.get("other").items.push(commit);
    }
  }

  const lines = [];
  lines.push(`## ${nextTag} 更新说明`);
  lines.push("");

  if (prevTag) {
    lines.push(`本版本基于 \`${prevTag}\` 自动构建发布（共整理 ${parsedCommits.length} 条提交记录）。`);
  } else {
    lines.push(`本版本为首次自动构建发布（共整理 ${parsedCommits.length} 条提交记录）。`);
  }
  lines.push("");

  const nonEmptyCategories = categories.filter((cat) => cat.items.length > 0);
  if (nonEmptyCategories.length === 0) {
    lines.push("本次发布无新增代码提交，仅触发重新构建与打包。");
    lines.push("");
  } else {
    for (const category of nonEmptyCategories) {
      lines.push(`### ${category.title}`);
      lines.push("");
      for (const item of category.items) {
        const scopePrefix = item.scope ? `**${item.scope}**: ` : "";
        const commitRef = repo
          ? `([\`${item.shortHash}\`](https://github.com/${repo}/commit/${item.hash}))`
          : `(\`${item.shortHash}\`)`;
        lines.push(`- ${scopePrefix}${item.description} ${commitRef}`);
      }
      lines.push("");
    }
  }

  if (prevTag && repo) {
    lines.push(`**完整变更对比**: https://github.com/${repo}/compare/${prevTag}...${nextTag}`);
    lines.push("");
  }

  return lines.join("\n");
}

/**
 * 同步更新 JSON 文件中的 version 字段（保持 UTF-8 无 BOM 与 LF 换行）。
 */
function updateJsonVersion(filePath, nextVersion, updateLockRoot = false) {
  if (!fs.existsSync(filePath)) return false;
  const raw = fs.readFileSync(filePath, "utf8");
  const json = JSON.parse(raw);
  json.version = nextVersion;
  if (updateLockRoot && json.packages && json.packages[""]) {
    json.packages[""].version = nextVersion;
  }
  fs.writeFileSync(filePath, `${JSON.stringify(json, null, 2)}\n`, "utf8");
  return true;
}

/**
 * 更新 Cargo.toml 中 [package] 段落下的 version 字段。
 */
function updateCargoTomlVersion(filePath, nextVersion) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  // 仅替换 [package] 段落中首个 version = "..."，避免误改依赖版本号
  const updated = content.replace(
    /(\[package\][\s\S]*?\r?\nversion\s*=\s*")([^"]+)(")/,
    `$1${nextVersion}$3`
  );
  if (updated === content) {
    throw new Error(`未能在 ${filePath} 的 [package] 段落中找到 version 字段`);
  }
  fs.writeFileSync(filePath, updated.replace(/\r\n/g, "\n"), "utf8");
  return true;
}

/**
 * 更新 Cargo.lock 中当前主包（simple-salesforce-tool）的 version 字段。
 */
function updateCargoLockVersion(filePath, nextVersion) {
  if (!fs.existsSync(filePath)) return false;
  const content = fs.readFileSync(filePath, "utf8");
  const updated = content.replace(
    /(\[\[package\]\]\r?\nname\s*=\s*"simple-salesforce-tool"\r?\nversion\s*=\s*")([^"]+)(")/,
    `$1${nextVersion}$3`
  );
  fs.writeFileSync(filePath, updated.replace(/\r\n/g, "\n"), "utf8");
  return true;
}

/**
 * 将输出变量写入 GitHub Actions GITHUB_OUTPUT 文件。
 */
function writeGithubOutput(outputs) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (!outputPath) return;

  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${value}`);
  fs.appendFileSync(outputPath, `${lines.join("\n")}\n`, "utf8");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const rootDir = process.cwd();

  const prevTag = getLatestSemverTag();
  const rawCommits = getCommitsSinceTag(prevTag);
  const parsedCommits = rawCommits.map(parseConventionalCommit);
  const nextVersion = computeNextVersion(prevTag, args.bump, parsedCommits);
  const nextTag = `v${nextVersion}`;

  const notes = buildReleaseNotes({
    prevTag,
    nextTag,
    repo: args.repo,
    parsedCommits
  });

  if (args.dryRun) {
    console.log(`[Dry Run] 上一个版本 Tag: ${prevTag ?? "(无)"}`);
    console.log(`[Dry Run] 计算新版本号: ${nextVersion} (Tag: ${nextTag})`);
    console.log(`[Dry Run] 纳入整理提交数: ${parsedCommits.length}`);
    console.log("--- Release Notes 预览 ---");
    console.log(notes);
    return;
  }

  // 构建前将新版本号写入应用所有版本声明文件，确保打包产物与仓库状态完全一致
  updateJsonVersion(path.join(rootDir, "package.json"), nextVersion);
  updateJsonVersion(path.join(rootDir, "src-tauri", "tauri.conf.json"), nextVersion);
  updateCargoTomlVersion(path.join(rootDir, "src-tauri", "Cargo.toml"), nextVersion);
  updateCargoLockVersion(path.join(rootDir, "src-tauri", "Cargo.lock"), nextVersion);

  const notesPath = path.resolve(rootDir, args.notesFile);
  fs.writeFileSync(notesPath, notes, "utf8");

  writeGithubOutput({
    prev_tag: prevTag ?? "",
    version: nextVersion,
    tag: nextTag,
    notes_file: args.notesFile
  });

  console.log(`已生成版本 ${nextTag} 及分类发布说明 (${args.notesFile})`);
}

main();
