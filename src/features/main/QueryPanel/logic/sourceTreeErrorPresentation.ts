// 左树数据源错误摘要：将原始异常文本转换为更适合树节点展示的标题与说明。
export type QuerySourceErrorPresentation = {
  // 错误标题：用于节点下方轻量卡片的第一行。
  title: string;
  // 错误说明：用于补充更具体的失败原因。
  detail: string;
};

// 收敛错误文本中的空白与常见 Error 前缀，避免 UI 直接展示冗长异常串。
function normalizeSourceErrorMessage(errorMessage: string): string {
  return errorMessage
    .replace(/^error:\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

// 截断过长错误摘要，避免左树节点被异常长文本撑得过于难看。
function truncateSourceErrorDetail(detail: string, maxLength = 56): string {
  if (detail.length <= maxLength) return detail;
  return `${detail.slice(0, maxLength).trimEnd()}...`;
}

// 解析左树数据源错误展示文案：优先给用户稳定、简短、可扫读的提示。
export function buildQuerySourceErrorPresentation(errorMessage: string): QuerySourceErrorPresentation {
  const normalizedMessage = normalizeSourceErrorMessage(String(errorMessage || ""));
  if (!normalizedMessage) {
    return {
      title: "加载失败",
      detail: "数据源返回了空错误信息，请稍后重试。"
    };
  }

  const lowerCasedMessage = normalizedMessage.toLowerCase();
  const title = lowerCasedMessage.includes("auth")
    || lowerCasedMessage.includes("token")
    || normalizedMessage.includes("认证")
    || normalizedMessage.includes("登录")
    ? "认证失败"
    : lowerCasedMessage.includes("timeout")
      || normalizedMessage.includes("超时")
      ? "连接超时"
      : "加载失败";

  const firstReadableSegment = normalizedMessage
    .split(/\s*[;；\n]+\s*/g)
    .map((segment) => segment.trim())
    .filter(Boolean)[0] || normalizedMessage;

  return {
    title,
    detail: truncateSourceErrorDetail(firstReadableSegment)
  };
}
