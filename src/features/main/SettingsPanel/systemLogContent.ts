// 系统日志长内容判定阈值：超过后默认以折叠态展示。
export const SYSTEM_LOG_COLLAPSE_CHAR_LIMIT = 180;

// 系统日志长内容判定阈值：超过后默认以折叠态展示。
export const SYSTEM_LOG_COLLAPSE_LINE_LIMIT = 4;

// 组合日志主信息与详情：供折叠判定与展示复用。
export function buildSystemLogContent(message: string, detail?: string): string {
  const normalizedMessage = message.trim();
  const normalizedDetail = detail?.trim() || "";

  // 仅有 message 时直接返回，避免多余换行。
  if (!normalizedDetail) return normalizedMessage;
  // 同时存在 message 与 detail 时使用双换行分隔，提升可读性。
  return `${normalizedMessage}\n\n详情:\n${normalizedDetail}`;
}

// 判断日志内容是否需要默认折叠。
export function shouldCollapseSystemLogContent(message: string, detail?: string): boolean {
  const content = buildSystemLogContent(message, detail);
  // 使用换行数和字符数双重约束，兼顾长文本与多行堆栈日志。
  const lineCount = content.split(/\r?\n/).length;
  return content.length > SYSTEM_LOG_COLLAPSE_CHAR_LIMIT || lineCount > SYSTEM_LOG_COLLAPSE_LINE_LIMIT;
}
