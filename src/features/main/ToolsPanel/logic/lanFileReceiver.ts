import type {
  LanFileReceiverItem,
  LanFileReceiverPreviewKind,
  LanFileReceiverStatus
} from "../../../../types/index.ts";

// 工具页筛选类型：用于在全部、图片和文本之间切换。
export type LanFileReceiverFilterKind = "all" | "image" | "text";

// 重新导出文件项类型：便于测试和组件统一引用。
export type { LanFileReceiverItem, LanFileReceiverPreviewKind } from "../../../../types/index.ts";

// 根据 MIME 与扩展名推断预览类型：前端兜底时与后端保持同一语义。
export function resolveLanFilePreviewKind(mimeType: string, fileName: string): LanFileReceiverPreviewKind {
  const normalizedMimeType = mimeType.trim().toLowerCase();
  const extension = fileName.split(".").pop()?.trim().toLowerCase() || "";

  if (
    normalizedMimeType.startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "bmp", "webp", "svg"].includes(extension)
  ) {
    return "image";
  }

  if (
    normalizedMimeType.startsWith("text/") ||
    [
      "application/json",
      "application/xml",
      "application/javascript",
      "application/x-javascript",
      "application/x-sh",
      "application/x-yaml",
      "application/yaml"
    ].includes(normalizedMimeType) ||
    [
      "txt",
      "md",
      "log",
      "json",
      "csv",
      "tsv",
      "xml",
      "html",
      "css",
      "js",
      "jsx",
      "ts",
      "tsx",
      "sql",
      "yaml",
      "yml",
      "ini",
      "conf",
      "env"
    ].includes(extension)
  ) {
    return "text";
  }

  return "unsupported";
}

// 格式化文件体积：用于列表和详情面板展示更易读的大小文案。
export function formatLanFileSize(sizeBytes: number): string {
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) return "0 B";
  if (sizeBytes < 1024) return `${Math.round(sizeBytes)} B`;
  if (sizeBytes < 1024 * 1024) return `${(sizeBytes / 1024).toFixed(1)} KB`;
  return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`;
}

// 按筛选类型与关键字过滤文件：统一驱动列表、统计和空态。
export function filterLanFileReceiverItems(
  items: LanFileReceiverItem[],
  filterKind: LanFileReceiverFilterKind,
  keyword: string
): LanFileReceiverItem[] {
  const normalizedKeyword = keyword.trim().toLowerCase();
  return items.filter((item) => {
    const matchedFilter =
      filterKind === "all" ||
      (filterKind === "image" && item.previewKind === "image") ||
      (filterKind === "text" && item.previewKind === "text");
    if (!matchedFilter) return false;
    if (!normalizedKeyword) return true;
    return item.originalName.toLowerCase().includes(normalizedKeyword) || item.mimeType.toLowerCase().includes(normalizedKeyword);
  });
}

// 选择二维码对应的访问地址：优先推荐局域网地址，缺失时回退本机地址。
export function resolveLanFileReceiverQrUrl(status: LanFileReceiverStatus | null): string {
  if (!status?.enabled) return "";
  const preferredAddress = status.accessUrls.find((item) => item.isPreferred);
  if (preferredAddress?.url) return preferredAddress.url;
  return status.localBaseUrl || "";
}

// 判断是否应展示二维码卡片：只有服务开启且存在可扫码地址时才显示。
export function shouldShowLanFileReceiverQrCard(status: LanFileReceiverStatus | null): boolean {
  return resolveLanFileReceiverQrUrl(status) !== "";
}
