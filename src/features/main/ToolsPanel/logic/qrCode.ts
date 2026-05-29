// 二维码容错级别：与 QR 生成库支持的标准等级保持一致。
export type QrCodeErrorCorrectionLevel = "L" | "M" | "Q" | "H";

// 二维码生成参数：控制纠错、边距、缩放和颜色。
export type QrCodeOptions = {
  // 容错级别。
  errorCorrectionLevel: QrCodeErrorCorrectionLevel;
  // 边距留白。
  margin: number;
  // 像素缩放倍率。
  scale: number;
  // 深色模块颜色。
  darkColor: string;
  // 浅色背景颜色。
  lightColor: string;
};

// 单条二维码历史记录：用于回显用户历史生成结果。
export type QrCodeHistoryEntry = {
  // 历史主键。
  id: string;
  // 原始输入文本。
  inputText: string;
  // 生成时间。
  createdAt: string;
  // 生成时参数快照。
  options: QrCodeOptions;
};

// 二维码工具持久化状态：包含当前输入、参数和历史记录。
export type QrCodeToolPersistedState = {
  // 当前输入文本。
  inputText: string;
  // 当前参数配置。
  options: QrCodeOptions;
  // 历史记录列表。
  history: QrCodeHistoryEntry[];
};

// 历史上限：避免持久化状态无限膨胀。
export const QR_CODE_HISTORY_LIMIT = 20;

// 默认二维码参数：对齐当前工具面板的轻量风格和清晰预览体验。
export const DEFAULT_QR_CODE_OPTIONS: QrCodeOptions = {
  errorCorrectionLevel: "M",
  margin: 0,
  scale: 12,
  darkColor: "#111827",
  lightColor: "#FFFFFF"
};

// 创建单条历史记录：用于生成后落盘。
export function createQrCodeHistoryEntry(
  id: string,
  inputText: string,
  createdAt: string,
  options: QrCodeOptions
): QrCodeHistoryEntry {
  return {
    id,
    inputText,
    createdAt,
    options: normalizeQrCodeOptions(options)
  };
}

// 归一化二维码工具持久化状态：兜底缺失字段并过滤非法历史项。
export function normalizeQrCodeToolPersistedState(raw: unknown): QrCodeToolPersistedState {
  const state = isRecord(raw) ? raw : {};
  const history = Array.isArray(state.history)
    ? state.history
        .map((item) => normalizeQrCodeHistoryEntry(item))
        .filter((item): item is QrCodeHistoryEntry => item !== null)
    : [];

  return {
    inputText: typeof state.inputText === "string" ? state.inputText : "",
    options: normalizeQrCodeOptions(state.options),
    history
  };
}

// 合并新历史到顶部：按输入文本去重并裁剪最大长度。
export function dedupeAndCapQrCodeHistory(
  current: QrCodeHistoryEntry[],
  nextEntry: QrCodeHistoryEntry,
  limit = QR_CODE_HISTORY_LIMIT
): QrCodeHistoryEntry[] {
  return [nextEntry, ...current.filter((item) => item.inputText !== nextEntry.inputText)]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit));
}

// 删除历史记录：传入 ID 时删除单条，否则清空全部。
export function deleteQrCodeHistoryEntry(current: QrCodeHistoryEntry[], entryId?: string): QrCodeHistoryEntry[] {
  if (!entryId) return [];
  return current.filter((item) => item.id !== entryId);
}

// 归一化二维码参数：限制范围并清理非法颜色输入。
export function normalizeQrCodeOptions(raw: unknown): QrCodeOptions {
  const source = isRecord(raw) ? raw : {};
  return {
    errorCorrectionLevel: normalizeErrorCorrectionLevel(source.errorCorrectionLevel),
    margin: clampInteger(source.margin, DEFAULT_QR_CODE_OPTIONS.margin, 0, 8),
    scale: clampInteger(source.scale, DEFAULT_QR_CODE_OPTIONS.scale, 4, 12),
    darkColor: normalizeHexColor(source.darkColor, DEFAULT_QR_CODE_OPTIONS.darkColor),
    lightColor: normalizeHexColor(source.lightColor, DEFAULT_QR_CODE_OPTIONS.lightColor)
  };
}

// 归一化单条历史记录：缺失主键信息时直接丢弃。
function normalizeQrCodeHistoryEntry(raw: unknown): QrCodeHistoryEntry | null {
  const item = isRecord(raw) ? raw : {};
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const inputText = typeof item.inputText === "string" ? item.inputText.trim() : "";
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
  if (!id || !inputText || !createdAt) return null;

  return {
    id,
    inputText,
    createdAt,
    options: normalizeQrCodeOptions(item.options)
  };
}

// 校验对象字面量：避免直接读取未知值属性时报错。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

// 归一化容错等级：非法值时回退默认配置。
function normalizeErrorCorrectionLevel(value: unknown): QrCodeErrorCorrectionLevel {
  return value === "L" || value === "M" || value === "Q" || value === "H"
    ? value
    : DEFAULT_QR_CODE_OPTIONS.errorCorrectionLevel;
}

// 归一化整数范围：用于 margin/scale 的输入兜底。
function clampInteger(value: unknown, fallback: number, min: number, max: number): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}

// 归一化十六进制颜色：统一转为大写，非法值时回退默认色。
function normalizeHexColor(value: unknown, fallback: string): string {
  if (typeof value !== "string") return fallback;
  const normalized = value.trim().toUpperCase();
  return /^#[0-9A-F]{6}$/u.test(normalized) ? normalized : fallback;
}
