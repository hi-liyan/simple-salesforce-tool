// SmartInput 候选上限：统一约束输入框候选数量，避免浮层过长影响录入。
export const SMART_INPUT_SUGGESTION_LIMIT = 12;

// SmartInput 输入字体：选择字面更开阔、点击识别更轻松的字体，但保持非粗体观感。
export const SMART_INPUT_TYPOGRAPHY_STYLE = Object.freeze({
  fontFamily: 'Verdana, "Segoe UI", "Noto Sans SC", "Microsoft YaHei", sans-serif',
  fontSize: "14px",
  fontWeight: 500,
  letterSpacing: 0
});

// SmartInput 当前 token 范围：用于在输入框中替换当前位置对应的片段。
export type SmartInputTokenRange = {
  // 当前 token 起始位置。
  start: number;
  // 当前 token 结束位置。
  end: number;
  // 当前 token 文本。
  token: string;
};

type FilterSmartInputSuggestionsOptions = {
  // 原始候选词列表。
  suggestions: string[];
  // 当前光标所在 token。
  token: string;
  // 最多返回多少条候选。
  limit?: number;
};

type ShouldOpenSmartInputSuggestionsOptions = {
  // 当前输入值。
  value: string;
  // 当前光标所在 token。
  token: string;
  // 是否为手动触发候选。
  manualTrigger: boolean;
  // 当前可展示候选数量。
  suggestionCount: number;
};

type ResolveSmartInputEnterActionOptions = {
  // 候选面板是否打开。
  open: boolean;
  // 当前可展示候选数量。
  suggestionCount: number;
  // 用户是否已显式通过方向键选择候选。
  hasExplicitSelection: boolean;
};

type ResolveSmartInputWidthOptions = {
  // 当前输入值。
  value: string;
  // 占位文案。
  placeholder?: string;
  // 默认宽度。
  defaultWidth: number;
  // 最小宽度。
  minWidth: number;
  // 最大宽度。
  maxWidth: number;
  // 是否显示清空按钮。
  allowClear: boolean;
  // 文本宽度测量函数。
  measureText: (text: string) => number;
};

type ResolveQueryBarSplitRatioOptions = {
  // 当前用户拖拽得到的分栏比例。
  splitRatio: number;
  // 查询栏可用于左右输入区分配的总宽度。
  contentWidth: number;
  // WHERE 输入框当前内容解析出的期望宽度。
  wherePreferredWidth: number;
  // 排序输入框当前内容解析出的期望宽度。
  sortPreferredWidth: number;
  // 单侧最小占比。
  minRatio: number;
  // 单侧最大占比。
  maxRatio: number;
};

// SmartInput 回车动作：补全或提交查询。
export type SmartInputEnterAction = "submit" | "apply-suggestion";

// SmartInput 高亮类型：用于把字段、关键字和值映射到不同前景色。
export type SmartInputHighlightKind = "field" | "keyword" | "value" | "plain";

// SmartInput 高亮片段：保留原始文本与对应语义类型。
export type SmartInputHighlightSegment = {
  // 当前片段原始文本。
  text: string;
  // 当前片段语义类型。
  kind: SmartInputHighlightKind;
};

type ResolveSmartInputHighlightSegmentsOptions = {
  // 当前输入内容。
  value: string;
  // 需要高亮为关键字的词集合。
  keywords: string[];
  // 需要高亮为值的字面量集合。
  valueLiterals?: string[];
};

const INPUT_HORIZONTAL_PADDING = 24;
const CLEAR_BUTTON_RESERVED_WIDTH = 28;
const INPUT_SAFE_GAP = 16;
const HIGHLIGHT_IDENTIFIER_PATTERN = /[A-Za-z0-9_$.:]/;
const HIGHLIGHT_NUMBER_PATTERN = /[0-9T:./+-]/;

// 候选去重：忽略大小写并保留首次出现顺序。
export function normalizeSmartInputSuggestions(suggestions: string[]): string[] {
  const next: string[] = [];
  const seen = new Set<string>();
  suggestions.forEach((item) => {
    const text = item.trim();
    if (!text) return;
    const key = text.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    next.push(text);
  });
  return next;
}

// 按 token 过滤候选：前缀优先，包含次之。
export function filterSmartInputSuggestions({
  suggestions,
  token,
  limit = SMART_INPUT_SUGGESTION_LIMIT
}: FilterSmartInputSuggestionsOptions): string[] {
  const normalizedSuggestions = normalizeSmartInputSuggestions(suggestions);
  const normalizedToken = token.trim().toLowerCase();
  if (!normalizedToken) {
    return normalizedSuggestions.slice(0, limit);
  }
  const startsWith = normalizedSuggestions.filter((item) => item.toLowerCase().startsWith(normalizedToken));
  const includes = normalizedSuggestions.filter(
    (item) => !item.toLowerCase().startsWith(normalizedToken) && item.toLowerCase().includes(normalizedToken)
  );
  return [...startsWith, ...includes].slice(0, limit);
}

// 判断是否应打开候选面板：仅输入或手动触发时展示，且必须存在候选。
export function shouldOpenSmartInputSuggestions({
  value,
  token,
  manualTrigger,
  suggestionCount
}: ShouldOpenSmartInputSuggestionsOptions): boolean {
  if (suggestionCount <= 0) return false;
  if (manualTrigger) return true;
  if (value.trim().length <= 0) return false;
  return token.trim().length > 0;
}

// 解析回车动作：默认提交查询，只有显式选中过候选时才确认补全。
export function resolveSmartInputEnterAction({
  open,
  suggestionCount,
  hasExplicitSelection
}: ResolveSmartInputEnterActionOptions): SmartInputEnterAction {
  if (open && suggestionCount > 0 && hasExplicitSelection) {
    return "apply-suggestion";
  }
  return "submit";
}

// 解析输入框宽度：空值时参考 placeholder，非空时以实际内容为主。
export function resolveSmartInputWidth({
  value,
  placeholder = "",
  defaultWidth,
  minWidth,
  maxWidth,
  allowClear,
  measureText
}: ResolveSmartInputWidthOptions): number {
  const measureTarget = value || placeholder;
  const measuredWidth = measureTarget
    ? measureText(measureTarget) +
      INPUT_HORIZONTAL_PADDING +
      (allowClear ? CLEAR_BUTTON_RESERVED_WIDTH : 0) +
      INPUT_SAFE_GAP
    : defaultWidth;
  const preferredWidth = Math.max(defaultWidth, measuredWidth);
  return Math.max(minWidth, Math.min(maxWidth, preferredWidth));
}

// 解析查询栏分栏比例：优先满足内容宽度诉求，冲突时按诉求比例压缩，再受最小/最大占比约束。
export function resolveQueryBarSplitRatio({
  splitRatio,
  contentWidth,
  wherePreferredWidth,
  sortPreferredWidth,
  minRatio,
  maxRatio
}: ResolveQueryBarSplitRatioOptions): number {
  const safeSplitRatio = Math.max(minRatio, Math.min(maxRatio, splitRatio));
  if (contentWidth <= 0) return safeSplitRatio;

  const safeWhereWidth = Math.max(0, wherePreferredWidth);
  const safeSortWidth = Math.max(0, sortPreferredWidth);
  const totalPreferredWidth = safeWhereWidth + safeSortWidth;
  if (totalPreferredWidth <= 0) return safeSplitRatio;

  const rawRatio =
    totalPreferredWidth <= contentWidth
      ? Math.max(safeSplitRatio, safeWhereWidth / contentWidth)
      : safeWhereWidth / totalPreferredWidth;

  return Math.max(minRatio, Math.min(maxRatio, rawRatio));
}

// 计算光标所在 token：供候选过滤与文本替换共用。
export function getSmartInputTokenRange(text: string, caret: number, tokenPattern: RegExp): SmartInputTokenRange {
  const safeCaret = Math.max(0, Math.min(caret, text.length));
  let start = safeCaret;
  let end = safeCaret;

  while (start > 0 && tokenPattern.test(text[start - 1])) {
    start -= 1;
  }

  while (end < text.length && tokenPattern.test(text[end])) {
    end += 1;
  }

  return {
    start,
    end,
    token: text.slice(start, end)
  };
}

// 解析单行输入高亮片段：不追求完整 SQL 语法树，只覆盖查询栏最常见的字段/关键字/值语义。
export function resolveSmartInputHighlightSegments({
  value,
  keywords,
  valueLiterals = []
}: ResolveSmartInputHighlightSegmentsOptions): SmartInputHighlightSegment[] {
  if (!value) return [];

  const keywordSet = new Set(keywords.map((item) => item.trim().toUpperCase()).filter(Boolean));
  const valueLiteralSet = new Set(valueLiterals.map((item) => item.trim().toUpperCase()).filter(Boolean));
  const segments: SmartInputHighlightSegment[] = [];
  let index = 0;

  while (index < value.length) {
    const currentChar = value[index];

    if (/\s/.test(currentChar)) {
      const nextIndex = readWhile(value, index, (char) => /\s/.test(char));
      segments.push({ text: value.slice(index, nextIndex), kind: "plain" });
      index = nextIndex;
      continue;
    }

    if (currentChar === "'" || currentChar === '"') {
      const nextIndex = readQuotedText(value, index, currentChar);
      segments.push({ text: value.slice(index, nextIndex), kind: "value" });
      index = nextIndex;
      continue;
    }

    if (currentChar === "`") {
      const nextIndex = readWrappedText(value, index, "`");
      segments.push({ text: value.slice(index, nextIndex), kind: "field" });
      index = nextIndex;
      continue;
    }

    if (/[0-9]/.test(currentChar) || (currentChar === "." && /[0-9]/.test(value[index + 1] || ""))) {
      const nextIndex = readWhile(value, index, (char) => HIGHLIGHT_NUMBER_PATTERN.test(char));
      segments.push({ text: value.slice(index, nextIndex), kind: "value" });
      index = nextIndex;
      continue;
    }

    if (/[A-Za-z_$]/.test(currentChar)) {
      const nextIndex = readWhile(value, index, (char) => HIGHLIGHT_IDENTIFIER_PATTERN.test(char));
      const tokenText = value.slice(index, nextIndex);
      segments.push({
        text: tokenText,
        kind: resolveWordHighlightKind(tokenText, keywordSet, valueLiteralSet)
      });
      index = nextIndex;
      continue;
    }

    const nextIndex = readWhile(
      value,
      index,
      (char) => !/\s/.test(char) && !/[A-Za-z0-9_$'"`]/.test(char) && !(char === "." && /[0-9]/.test(value[index + 1] || ""))
    );
    segments.push({ text: value.slice(index, nextIndex), kind: "plain" });
    index = nextIndex;
  }

  return segments;
}

// 按条件持续读取文本：供空白、标识符、数字等多类片段共用。
function readWhile(value: string, startIndex: number, predicate: (char: string) => boolean): number {
  let index = startIndex;
  while (index < value.length && predicate(value[index])) {
    index += 1;
  }
  return index;
}

// 读取成对包裹文本：支持 SQL 字符串与反引号字段名。
function readWrappedText(value: string, startIndex: number, wrapper: string): number {
  let index = startIndex + 1;
  while (index < value.length) {
    if (value[index] === wrapper) return index + 1;
    index += 1;
  }
  return value.length;
}

// 读取字符串字面量：兼容反斜杠转义与成对引号转义。
function readQuotedText(value: string, startIndex: number, quote: string): number {
  let index = startIndex + 1;
  while (index < value.length) {
    if (value[index] === "\\" && index + 1 < value.length) {
      index += 2; // 行内注释：跳过转义后的字符，避免把中途引号误判为结束。
      continue;
    }
    if (value[index] === quote && value[index + 1] === quote) {
      index += 2; // 行内注释：兼容 SQL 中两个连续引号表示字面引号。
      continue;
    }
    if (value[index] === quote) return index + 1;
    index += 1;
  }
  return value.length;
}

// 识别单词高亮类型：关键字优先蓝色，值字面量绿色，其余裸标识符按字段处理。
function resolveWordHighlightKind(
  tokenText: string,
  keywordSet: Set<string>,
  valueLiteralSet: Set<string>
): SmartInputHighlightKind {
  const normalizedToken = tokenText.trim().toUpperCase();
  if (!normalizedToken) return "plain";
  if (valueLiteralSet.has(normalizedToken) || /^[A-Z_]+:\d+$/.test(normalizedToken)) {
    return "value";
  }
  if (keywordSet.has(normalizedToken)) {
    return "keyword";
  }
  return "field";
}
