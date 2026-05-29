// SmartInput 候选上限：统一约束输入框候选数量，避免浮层过长影响录入。
export const SMART_INPUT_SUGGESTION_LIMIT = 12;

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

const INPUT_HORIZONTAL_PADDING = 24;
const CLEAR_BUTTON_RESERVED_WIDTH = 28;
const INPUT_SAFE_GAP = 16;

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
