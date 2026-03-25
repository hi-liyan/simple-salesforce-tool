// JSON 字面量类型：用于描述可序列化的基础值。
type JsonPrimitive = string | number | boolean | null;

// JSON 数据类型：覆盖对象、数组与字面量。
export type JsonData = JsonPrimitive | JsonData[] | { [key: string]: JsonData };

// JSON 归一化结果：统一承载解析值、格式化文本与错误信息。
export type JsonNormalizeResult = {
  // 当前文本是否为空输入。
  empty: boolean;
  // 解析后的 JSON 值；失败或空输入时为 null。
  parsedValue: JsonData | null;
  // 归一化后的稳定格式文本；失败或空输入时为空字符串。
  normalizedText: string;
  // 解析失败时的错误描述。
  errorMessage: string;
};

// JSON 对比状态：组合左右两侧解析结果并给出语义比较结论。
export type JsonDiffSemanticState = {
  // 左侧归一化结果。
  left: JsonNormalizeResult;
  // 右侧归一化结果。
  right: JsonNormalizeResult;
  // 左右是否都为空。
  empty: boolean;
  // 左右是否都可参与语义比较（非空且解析成功）。
  comparable: boolean;
  // 左右语义是否一致（仅 comparable 时有意义）。
  semanticallyEqual: boolean;
};

// 判断值是否为普通对象：排除 null 与数组。
function isJsonObject(value: JsonData): value is { [key: string]: JsonData } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// 递归排序对象键：用于得到稳定、可比较的 JSON 语义快照。
function sortJsonValue(value: JsonData): JsonData {
  if (Array.isArray(value)) {
    return value.map((item) => sortJsonValue(item)); // 数组顺序有语义，保留原顺序，仅递归处理内部元素。
  }
  if (!isJsonObject(value)) {
    return value;
  }

  const sortedEntries = Object.keys(value)
    .sort((a, b) => a.localeCompare(b))
    .map((key) => [key, sortJsonValue(value[key])] as const); // 对象键排序后重建，消除键顺序带来的文本噪音。

  return Object.fromEntries(sortedEntries);
}

// 判断 JSON Diff 输入是否为空：左右都为空白时返回 true。
export function isJsonDiffInputEmpty(leftText: string, rightText: string): boolean {
  return leftText.trim().length === 0 && rightText.trim().length === 0;
}

// 解析并归一化 JSON 文本：成功时输出稳定格式，失败时带错误信息。
export function normalizeJsonText(text: string): JsonNormalizeResult {
  const trimmedText = text.trim();
  if (!trimmedText) {
    return {
      empty: true,
      parsedValue: null,
      normalizedText: "",
      errorMessage: ""
    };
  }

  try {
    const parsedValue = JSON.parse(trimmedText) as JsonData;
    const sortedValue = sortJsonValue(parsedValue); // 先做键排序，保证语义比较稳定。
    return {
      empty: false,
      parsedValue,
      normalizedText: JSON.stringify(sortedValue, null, 2),
      errorMessage: ""
    };
  } catch (error) {
    return {
      empty: false,
      parsedValue: null,
      normalizedText: "",
      errorMessage: `JSON 解析失败：${error instanceof Error ? error.message : String(error)}`
    };
  }
}

// 构建 JSON 语义对比状态：统一提供空态、错误态与语义一致性信息。
export function buildJsonDiffSemanticState(leftText: string, rightText: string): JsonDiffSemanticState {
  const left = normalizeJsonText(leftText);
  const right = normalizeJsonText(rightText);
  const empty = left.empty && right.empty;
  const comparable = !left.empty && !right.empty && !left.errorMessage && !right.errorMessage;
  const semanticallyEqual = comparable && left.normalizedText === right.normalizedText; // 用归一化文本比较语义等价。

  return {
    left,
    right,
    empty,
    comparable,
    semanticallyEqual
  };
}
