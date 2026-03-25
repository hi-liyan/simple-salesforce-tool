import type * as Monaco from "monaco-editor";

// 占位提示渲染位置。
export type PlaceholderPosition = {
  // X 坐标。
  left: number;
  // Y 坐标。
  top: number;
};

// 不区分大小写去重，保留首个原始值。
export function dedupeByLowerCase(items: string[]): string[] {
  const map = new Map<string, string>();
  items.forEach((item) => {
    const trimmed = item.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (!map.has(key)) {
      map.set(key, trimmed);
    }
  });
  return Array.from(map.values());
}

// 归一化对象字段映射：对象 key 统一转小写，字段去重。
export function normalizeObjectFieldsMap(objectFieldsMap: Record<string, string[]>): Record<string, string[]> {
  return Object.entries(objectFieldsMap).reduce(
    (acc, [objectName, fields]) => {
      const trimmedObjectName = objectName.trim();
      if (!trimmedObjectName) return acc;
      acc[trimmedObjectName.toLowerCase()] = dedupeByLowerCase(fields);
      return acc;
    },
    {} as Record<string, string[]>
  );
}

// 构建 Monaco 补全项集合。
export function buildSuggestions(
  monaco: typeof Monaco,
  items: string[],
  kind: Monaco.languages.CompletionItemKind,
  range: Monaco.IRange
): Monaco.languages.CompletionItem[] {
  return items.map((item) => ({
    label: item,
    kind,
    insertText: item,
    range
  }));
}

// 按 label 去重补全项，避免同词多次出现。
export function dedupeSuggestionsByLabel(items: Monaco.languages.CompletionItem[]): Monaco.languages.CompletionItem[] {
  const labelSet = new Set<string>();
  return items.filter((item) => {
    const label = String(item.label).toLowerCase();
    if (labelSet.has(label)) return false;
    labelSet.add(label);
    return true;
  });
}

// 基于编辑器首行首列坐标计算占位符位置，确保与文本对齐。
export function getPlaceholderPosition(editor: Monaco.editor.IStandaloneCodeEditor): PlaceholderPosition {
  // 占位提示需要在光标后方留一点间隙，避免视觉重叠。
  const cursorGapPx = 3;
  const cursorAnchor = editor.getScrolledVisiblePosition({ lineNumber: 1, column: 1 });
  if (cursorAnchor) {
    return {
      left: cursorAnchor.left + cursorGapPx,
      top: cursorAnchor.top
    };
  }

  // 首帧布局尚未稳定时，使用布局信息兜底。
  const layoutInfo = editor.getLayoutInfo();
  return {
    left: layoutInfo.contentLeft + cursorGapPx,
    top: editor.getTopForLineNumber(1) + 2
  };
}

// 归一化空白字符，减少换行和多空格对上下文判定的影响。
export function normalizeQuerySpaces(text: string): string {
  return text.replace(/\s+/g, " ").trimEnd();
}
