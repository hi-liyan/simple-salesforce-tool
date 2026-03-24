import { getVersion } from "@tauri-apps/api/app";

// GitHub Releases 固定地址：用于更新提示中的展示与跳转。
export const GITHUB_RELEASE_PAGE_URL = "https://github.com/hi-liyan/simple-salesforce-tool/releases";
// GitHub Latest Release API：用于读取最新版本号并做对比。
export const GITHUB_LATEST_RELEASE_API_URL = "https://api.github.com/repos/hi-liyan/simple-salesforce-tool/releases/latest";

// GitHub Latest Release API 返回结构：仅取版本号字段即可完成比较。
type GithubLatestReleasePayload = {
  tag_name?: string;
};

// 新版本提示结果：包含当前版本、最新版本与发布页地址。
export type VersionUpdateCheckResult = {
  currentVersion: string;
  latestVersion: string;
  releasePageUrl: string;
  hasUpdate: boolean;
};

// 语义版本结构：拆分主版本段与预发布标签，便于稳定比较。
type ParsedSemanticVersion = {
  coreParts: number[];
  preRelease: string | null;
};

// 将升级弹窗延后到下一轮事件循环和浏览器下一帧，尽量避开启动尾部的主线程忙碌期。
export async function waitForUiIdleFrame(): Promise<void> {
  // 先让出当前宏任务，让启动恢复期间的同步状态提交先落完。
  await new Promise<void>((resolve) => {
    window.setTimeout(() => resolve(), 0);
  });
  // 再等待浏览器下一帧，确保弹窗挂载后能更快进入可点击状态。
  await new Promise<void>((resolve) => {
    window.requestAnimationFrame(() => resolve());
  });
}

// 检查 GitHub 最新发布版本，并返回是否存在可用更新。
export async function checkGithubLatestVersion(): Promise<VersionUpdateCheckResult | null> {
  const currentVersion = (await getVersion()).trim();
  if (!currentVersion) return null;

  const latestVersion = await fetchLatestGithubReleaseVersion();
  if (!latestVersion) return null;

  return {
    currentVersion,
    latestVersion,
    releasePageUrl: GITHUB_RELEASE_PAGE_URL,
    hasUpdate: isGithubVersionNewer(currentVersion, latestVersion)
  };
}

// 拉取 GitHub 最新发布版本号（tag_name），失败时返回 null。
export async function fetchLatestGithubReleaseVersion(): Promise<string | null> {
  const response = await fetch(GITHUB_LATEST_RELEASE_API_URL, {
    method: "GET",
    headers: {
      Accept: "application/vnd.github+json"
    }
  });
  if (!response.ok) return null;

  const payload = (await response.json()) as GithubLatestReleasePayload;
  const version = (payload.tag_name ?? "").trim();
  return version || null;
}

// 判断 GitHub 版本是否高于当前版本。
export function isGithubVersionNewer(currentVersion: string, latestVersion: string): boolean {
  return compareSemanticVersion(latestVersion, currentVersion) > 0;
}

// 比较两个语义版本：返回 1 表示 left 更新，-1 表示 right 更新，0 表示相等。
export function compareSemanticVersion(leftVersion: string, rightVersion: string): number {
  // 比较前统一忽略版本号前缀 `v/V`，避免 `v1.2.3` 与 `1.2.3` 被误判为不相等。
  const normalizedLeftVersion = leftVersion.trim().replace(/^[vV]/, "");
  const normalizedRightVersion = rightVersion.trim().replace(/^[vV]/, "");
  const left = parseSemanticVersion(normalizedLeftVersion);
  const right = parseSemanticVersion(normalizedRightVersion);
  if (!left || !right) {
    // 兜底比较：非标准版本格式时使用带数字感知的字符串比较。
    return normalizedLeftVersion.localeCompare(normalizedRightVersion, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }

  const compareLength = Math.max(left.coreParts.length, right.coreParts.length);
  for (let index = 0; index < compareLength; index += 1) {
    const leftPart = left.coreParts[index] ?? 0;
    const rightPart = right.coreParts[index] ?? 0;
    if (leftPart > rightPart) return 1;
    if (leftPart < rightPart) return -1;
  }

  const leftIsStable = !left.preRelease;
  const rightIsStable = !right.preRelease;
  // 主版本一致时：正式版 > 预发布版。
  if (leftIsStable && !rightIsStable) return 1;
  if (!leftIsStable && rightIsStable) return -1;
  if (left.preRelease && right.preRelease) {
    return left.preRelease.localeCompare(right.preRelease, undefined, {
      numeric: true,
      sensitivity: "base"
    });
  }
  return 0;
}

// 解析语义版本字符串，兼容 `v1.2.3` 与 `1.2.3-beta.1`。
function parseSemanticVersion(rawVersion: string): ParsedSemanticVersion | null {
  const normalizedVersion = rawVersion.trim().replace(/^[vV]/, "");
  if (!normalizedVersion) return null;

  const [coreSegment, preReleaseSegment = ""] = normalizedVersion.split("-", 2);
  if (!/^\d+(\.\d+)*$/.test(coreSegment)) return null;

  return {
    coreParts: coreSegment.split(".").map((part) => Number.parseInt(part, 10)),
    preRelease: preReleaseSegment.trim() || null
  };
}
