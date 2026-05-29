// Unicode 输出格式：支持 JS Unicode 转义与 HTML 实体两种稳定格式。
export type UnicodeConverterOutputFormat = "js-unicode" | "html-entity";

// Unicode 转换模式：用于记录历史项来源，便于用户回看本次做了什么转换。
export type UnicodeConverterMode =
  | "unicode-to-chinese"
  | "chinese-to-unicode"
  | "ascii-to-unicode"
  | "unicode-to-ascii";

// 单条 Unicode 工具历史记录：用于回显输入、输出与转换模式。
export type UnicodeConverterHistoryEntry = {
  // 历史主键。
  id: string;
  // 本次转换模式。
  mode: UnicodeConverterMode;
  // 原始输入文本。
  inputText: string;
  // 转换结果文本。
  outputText: string;
  // 创建时间。
  createdAt: string;
  // 本次输出格式：仅对“转 Unicode”模式有直接意义，但统一存储便于回放。
  outputFormat: UnicodeConverterOutputFormat;
};

// Unicode 工具持久化状态：包含当前输入输出、输出格式与历史记录。
export type UnicodeConverterToolPersistedState = {
  // 当前输入文本。
  inputText: string;
  // 当前输出文本。
  outputText: string;
  // 当前输出格式。
  outputFormat: UnicodeConverterOutputFormat;
  // 历史记录列表。
  history: UnicodeConverterHistoryEntry[];
};

// 历史上限：避免结构化快照无限膨胀。
export const UNICODE_CONVERTER_HISTORY_LIMIT = 30;

// 默认输出格式：与常见开发场景保持一致，优先使用 JS Unicode 转义。
export const DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT: UnicodeConverterOutputFormat = "js-unicode";

// 创建单条历史记录：统一在入库前做字段归一化。
export function createUnicodeConverterHistoryEntry(
  id: string,
  mode: UnicodeConverterMode,
  inputText: string,
  outputText: string,
  createdAt: string,
  outputFormat: UnicodeConverterOutputFormat
): UnicodeConverterHistoryEntry {
  return {
    id: id.trim(),
    mode: normalizeUnicodeConverterMode(mode),
    inputText: inputText.trim(),
    outputText,
    createdAt,
    outputFormat: normalizeUnicodeConverterOutputFormat(outputFormat)
  };
}

// 归一化持久化状态：兜底缺失字段并过滤非法历史记录。
export function normalizeUnicodeConverterToolPersistedState(raw: unknown): UnicodeConverterToolPersistedState {
  const state = isRecord(raw) ? raw : {};
  const history = Array.isArray(state.history)
    ? state.history
        .map((item) => normalizeUnicodeConverterHistoryEntry(item))
        .filter((item): item is UnicodeConverterHistoryEntry => item !== null)
    : [];

  return {
    inputText: typeof state.inputText === "string" ? state.inputText : "",
    outputText: typeof state.outputText === "string" ? state.outputText : "",
    outputFormat: normalizeUnicodeConverterOutputFormat(state.outputFormat),
    history
  };
}

// 合并新历史到顶部：按“模式 + 输入文本 + 输出格式”去重，并裁剪最大长度。
export function dedupeAndCapUnicodeConverterHistory(
  current: UnicodeConverterHistoryEntry[],
  nextEntry: UnicodeConverterHistoryEntry,
  limit = UNICODE_CONVERTER_HISTORY_LIMIT
): UnicodeConverterHistoryEntry[] {
  return [
    nextEntry,
    ...current.filter(
      (item) =>
        !(
          item.mode === nextEntry.mode &&
          item.inputText === nextEntry.inputText &&
          item.outputFormat === nextEntry.outputFormat
        )
    )
  ]
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
    .slice(0, Math.max(0, limit));
}

// 删除历史记录：传入 ID 时删除单条，否则清空全部。
export function deleteUnicodeConverterHistoryEntry(
  current: UnicodeConverterHistoryEntry[],
  entryId?: string
): UnicodeConverterHistoryEntry[] {
  if (!entryId) return [];
  return current.filter((item) => item.id !== entryId);
}

// Unicode 转中文：同时兼容 JS Unicode 与 HTML 十进制/十六进制实体。
export function convertUnicodeToChinese(inputText: string): string {
  return decodeUnicodeLikeText(inputText);
}

// 中文转 Unicode：默认输出 JS Unicode，也支持输出 HTML 实体。
export function convertChineseToUnicode(
  inputText: string,
  outputFormat: UnicodeConverterOutputFormat = DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT
): string {
  return Array.from(inputText)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return character;
      if (codePoint <= 0x7f) return character; // 行内注释：ASCII 字符原样保留，符合常见开发工具预期。
      return formatCodePoint(codePoint, outputFormat);
    })
    .join("");
}

// ASCII 转 Unicode：仅允许 ASCII 输入，超出范围直接抛错提醒。
export function convertAsciiToUnicode(
  inputText: string,
  outputFormat: UnicodeConverterOutputFormat = DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT
): string {
  return Array.from(inputText)
    .map((character) => {
      const codePoint = character.codePointAt(0);
      if (codePoint === undefined) return character;
      if (codePoint > 0x7f) {
        throw new Error("仅支持 ASCII 范围字符转换为 Unicode。");
      }
      return formatCodePoint(codePoint, outputFormat);
    })
    .join("");
}

// Unicode 转 ASCII：先统一解码，再校验结果必须全部位于 ASCII 范围。
export function convertUnicodeToAscii(inputText: string): string {
  const decodedText = decodeUnicodeLikeText(inputText);
  for (const character of decodedText) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && codePoint > 0x7f) {
      throw new Error("解码结果包含非 ASCII 字符，无法执行 ASCII 转换。");
    }
  }
  return decodedText;
}

// 统一解码 Unicode 风格文本：先处理 JS 转义，再处理 HTML 实体。
function decodeUnicodeLikeText(inputText: string): string {
  return decodeHtmlEntities(decodeJsUnicodeEscapes(inputText));
}

// 解码 JS Unicode 转义：支持 `\\uXXXX` 与 `\\u{XXXXX}` 两种常见写法。
function decodeJsUnicodeEscapes(inputText: string): string {
  return inputText
    .replace(/\\u\{([0-9a-fA-F]{1,6})\}/gu, (_, codePointText: string) =>
      String.fromCodePoint(Number.parseInt(codePointText, 16))
    )
    .replace(/\\u([0-9a-fA-F]{4})/gu, (_, codeUnitText: string) =>
      String.fromCharCode(Number.parseInt(codeUnitText, 16))
    );
}

// 解码 HTML 实体：支持十进制 `&#20320;` 与十六进制 `&#x4F60;`。
function decodeHtmlEntities(inputText: string): string {
  return inputText
    .replace(/&#(\d+);/gu, (_, decimalText: string) => String.fromCodePoint(Number.parseInt(decimalText, 10)))
    .replace(/&#x([0-9a-fA-F]+);/gu, (_, hexText: string) => String.fromCodePoint(Number.parseInt(hexText, 16)));
}

// 格式化码点：按输出格式生成稳定文本。
function formatCodePoint(codePoint: number, outputFormat: UnicodeConverterOutputFormat): string {
  if (outputFormat === "html-entity") {
    return `&#${codePoint};`;
  }

  if (codePoint <= 0xffff) {
    return `\\u${codePoint.toString(16).toUpperCase().padStart(4, "0")}`;
  }

  // 超过 BMP 的码点按代理对展开，保证输出兼容普通 JS/JSON `\\uXXXX` 语法。
  return Array.from(String.fromCodePoint(codePoint))
    .map((character) => `\\u${character.charCodeAt(0).toString(16).toUpperCase().padStart(4, "0")}`)
    .join("");
}

// 归一化单条历史记录：缺失主键信息或核心内容时直接丢弃。
function normalizeUnicodeConverterHistoryEntry(raw: unknown): UnicodeConverterHistoryEntry | null {
  const item = isRecord(raw) ? raw : {};
  const id = typeof item.id === "string" ? item.id.trim() : "";
  const inputText = typeof item.inputText === "string" ? item.inputText.trim() : "";
  const outputText = typeof item.outputText === "string" ? item.outputText : "";
  const createdAt = typeof item.createdAt === "string" ? item.createdAt : "";
  if (!id || !inputText || !outputText || !createdAt) return null;

  return {
    id,
    mode: normalizeUnicodeConverterMode(item.mode),
    inputText,
    outputText,
    createdAt,
    outputFormat: normalizeUnicodeConverterOutputFormat(item.outputFormat)
  };
}

// 归一化转换模式：非法值时回退到最常用的 Unicode 转中文模式。
function normalizeUnicodeConverterMode(value: unknown): UnicodeConverterMode {
  return value === "unicode-to-chinese" ||
    value === "chinese-to-unicode" ||
    value === "ascii-to-unicode" ||
    value === "unicode-to-ascii"
    ? value
    : "unicode-to-chinese";
}

// 归一化输出格式：非法值时回退默认格式。
function normalizeUnicodeConverterOutputFormat(value: unknown): UnicodeConverterOutputFormat {
  return value === "html-entity" || value === "js-unicode"
    ? value
    : DEFAULT_UNICODE_CONVERTER_OUTPUT_FORMAT;
}

// 判断对象字面量：避免直接读取未知值属性时报错。
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}
