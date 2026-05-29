type BuildQueryPaginationStateInput = {
  // 查询总数：来自后端 totalSize。
  totalSize: number;
  // 当前已加载行数：来自当前结果集 records.length。
  loadedRowCount: number;
  // 当前每页条数：沿用 QueryPanel 现有 limit 语义。
  pageSize: number;
  // 当前偏移量：表示结果集从第几条开始。
  currentOffset: number;
};

type ResolveQueryPageNavigationOffsetInput = BuildQueryPaginationStateInput & {
  // 分页动作：与分页器按钮一一对应。
  action: "first" | "previous" | "next" | "last";
};

type ResolveExecutedQueryStatementStateInput = {
  // 已执行成功的 SQL/SOQL 文本。
  queryText: string;
  // 未显式声明 LIMIT 时的回退值。
  fallbackLimit: number;
  // 未显式声明排序字段时的回退值。
  fallbackSortField: string;
  // 未显式声明排序方向时的回退值。
  fallbackSortDirection: "ASC" | "DESC";
  // 未显式声明排序片段时的回退值。
  fallbackSortClause: string;
};

export type QueryPaginationState = {
  // 当前每页条数。
  pageSize: number;
  // 当前偏移量。
  currentOffset: number;
  // 当前页首行号（1-based）。
  startRow: number;
  // 当前页末行号（1-based）。
  endRow: number;
  // 查询总数。
  totalSize: number;
  // 范围文案，如 1-500。
  rangeLabel: string;
  // 总数文案，如 of 765。
  totalLabel: string;
  // 当前版本未接入真实翻页，因此导航按钮统一禁用。
  canGoFirst: boolean;
  canGoPrevious: boolean;
  canGoNext: boolean;
  canGoLast: boolean;
};

export type ExecutedQueryStatementState = {
  // 当前查询应回写到 store 的每页条数。
  limit: number;
  // 兼容旧版字段排序 UI 的首个排序字段。
  sortField: string;
  // 兼容旧版字段排序 UI 的首个排序方向。
  sortDirection: "ASC" | "DESC";
  // 当前查询完整排序片段（不含 ORDER BY 前缀）。
  sortClause: string;
};

// 构建 Query 结果分页器状态：当前只提供样式化分页信息，不驱动真实翻页。
export function buildQueryPaginationState({
  totalSize,
  loadedRowCount,
  pageSize,
  currentOffset
}: BuildQueryPaginationStateInput): QueryPaginationState {
  const normalizedTotalSize = Math.max(0, Math.floor(totalSize || 0));
  const normalizedLoadedRowCount = Math.max(0, Math.floor(loadedRowCount || 0));
  const normalizedPageSize = Math.max(1, Math.floor(pageSize || 1));
  const normalizedCurrentOffset = Math.max(0, Math.floor(currentOffset || 0));
  // 乐观分页：部分后端会在每一页都返回“单页条数”，此时需要把当前页尾当作“已知至少总数”。
  const hasOptimisticNextPage = normalizedLoadedRowCount === normalizedPageSize && normalizedTotalSize === normalizedLoadedRowCount;
  const effectiveTotalSize = hasOptimisticNextPage
    ? normalizedCurrentOffset + normalizedLoadedRowCount
    : normalizedTotalSize;
  const hasRows = effectiveTotalSize > 0 && normalizedLoadedRowCount > 0;
  const startRow = hasRows ? normalizedCurrentOffset + 1 : 0;
  const endRow = hasRows ? Math.min(normalizedCurrentOffset + normalizedLoadedRowCount, effectiveTotalSize) : 0;
  const canGoPrevious = normalizedCurrentOffset > 0;
  const canGoNext = (endRow > 0 && endRow < effectiveTotalSize) || hasOptimisticNextPage;
  const totalLabel = hasOptimisticNextPage ? `of ${effectiveTotalSize}+` : `of ${effectiveTotalSize}`;

  return {
    pageSize: normalizedPageSize,
    currentOffset: normalizedCurrentOffset,
    startRow,
    endRow,
    totalSize: effectiveTotalSize,
    rangeLabel: `${startRow}-${endRow}`,
    totalLabel,
    canGoFirst: canGoPrevious,
    canGoPrevious,
    canGoNext,
    // 总数不确定时不开放“末页”，避免跳转到错误 offset。
    canGoLast: canGoNext && !hasOptimisticNextPage
  };
}

// 解析分页按钮对应的下一次 offset：统一复用乐观下一页语义，避免 UI 可点但 offset 不变。
export function resolveQueryPageNavigationOffset({
  action,
  totalSize,
  loadedRowCount,
  pageSize,
  currentOffset
}: ResolveQueryPageNavigationOffsetInput): number {
  const normalizedPageSize = Math.max(1, Math.floor(pageSize || 1));
  const normalizedCurrentOffset = Math.max(0, Math.floor(currentOffset || 0));
  const normalizedTotalSize = Math.max(0, Math.floor(totalSize || 0));
  const paginationState = buildQueryPaginationState({
    totalSize,
    loadedRowCount,
    pageSize,
    currentOffset
  });
  const lastOffset =
    normalizedTotalSize > 0 ? Math.max(0, Math.floor((normalizedTotalSize - 1) / normalizedPageSize) * normalizedPageSize) : 0;

  if (action === "first") return 0;
  if (action === "previous") return Math.max(0, normalizedCurrentOffset - normalizedPageSize);
  if (action === "next") {
    return paginationState.canGoNext ? normalizedCurrentOffset + normalizedPageSize : normalizedCurrentOffset;
  }
  return paginationState.canGoLast ? lastOffset : normalizedCurrentOffset;
}

// 从已执行成功的语句中反推分页与排序状态：保证后续翻页/改 page size 仍复用最新语义。
export function resolveExecutedQueryStatementState({
  queryText,
  fallbackLimit,
  fallbackSortField,
  fallbackSortDirection,
  fallbackSortClause
}: ResolveExecutedQueryStatementStateInput): ExecutedQueryStatementState {
  const normalizedQueryText = String(queryText || "").replace(/\s+/g, " ").trim();
  const topLevelLimitValue = extractTopLevelLimitValue(normalizedQueryText);
  const rawLimit = Number(topLevelLimitValue || fallbackLimit || 200);
  const limit = Math.max(1, Math.floor(Number.isFinite(rawLimit) ? rawLimit : 200));
  const sortClause = extractTopLevelOrderByClause(normalizedQueryText);

  if (!sortClause) {
    return {
      limit,
      sortField: "",
      sortDirection: fallbackSortDirection,
      sortClause: ""
    };
  }

  const firstSortSegment = sortClause.split(",")[0]?.trim() || fallbackSortClause.trim();
  const directionMatch = firstSortSegment.match(/\s+(ASC|DESC)\s*(?:NULLS\s+(?:FIRST|LAST))?$/i);
  const sortDirection = ((directionMatch?.[1] || "ASC").toUpperCase() === "ASC" ? "ASC" : "DESC") as "ASC" | "DESC";
  const rawSortField = (directionMatch
    ? firstSortSegment.slice(0, directionMatch.index).trim()
    : firstSortSegment.replace(/\s+NULLS\s+(?:FIRST|LAST)$/i, "").trim()) || fallbackSortField.trim();
  const sortField = /^[A-Za-z_][\w.]*$/.test(rawSortField) ? rawSortField : "";

  return {
    limit,
    sortField,
    sortDirection,
    sortClause
  };
}

// 判断当前位置是否命中完整关键字：避免把字段名或字符串片段误判为子句。
function isKeywordMatched(queryText: string, startIndex: number, keyword: string): boolean {
  const lowerQueryText = queryText.toLowerCase();
  const lowerKeyword = keyword.toLowerCase();
  if (!lowerQueryText.startsWith(lowerKeyword, startIndex)) return false;
  const beforeChar = startIndex > 0 ? queryText[startIndex - 1] : " ";
  const afterChar = queryText[startIndex + keyword.length] || " ";
  return !/[a-z0-9_]/i.test(beforeChar) && !/[a-z0-9_]/i.test(afterChar);
}

// 查找顶层关键字：忽略括号内子查询与字符串字面量中的同名片段。
function findTopLevelKeywordIndex(queryText: string, keyword: string, fromIndex = 0): number {
  let depth = 0;
  let stringQuote: "'" | "\"" | "" = "";
  for (let index = Math.max(0, fromIndex); index < queryText.length; index += 1) {
    const char = queryText[index];
    const previousChar = index > 0 ? queryText[index - 1] : "";
    if (stringQuote) {
      if (char === stringQuote && previousChar !== "\\") {
        stringQuote = "";
      }
      continue;
    }
    if ((char === "'" || char === "\"") && previousChar !== "\\") {
      stringQuote = char;
      continue;
    }
    if (char === "(") {
      depth += 1;
      continue;
    }
    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }
    if (depth === 0 && isKeywordMatched(queryText, index, keyword)) {
      return index;
    }
  }
  return -1;
}

// 提取主查询级 ORDER BY 片段：遇到顶层 LIMIT/OFFSET 即截断。
function extractTopLevelOrderByClause(queryText: string): string {
  const orderByIndex = findTopLevelKeywordIndex(queryText, "order by");
  if (orderByIndex < 0) return "";
  const contentStartIndex = orderByIndex + "order by".length;
  const limitIndex = findTopLevelKeywordIndex(queryText, "limit", contentStartIndex);
  const offsetIndex = findTopLevelKeywordIndex(queryText, "offset", contentStartIndex);
  const endIndexCandidates = [limitIndex, offsetIndex].filter((index) => index >= 0);
  const contentEndIndex = endIndexCandidates.length > 0 ? Math.min(...endIndexCandidates) : queryText.length;
  return queryText.slice(contentStartIndex, contentEndIndex).trim();
}

// 提取主查询级 LIMIT 数值：忽略括号内子查询的分页片段。
function extractTopLevelLimitValue(queryText: string): number | null {
  const limitIndex = findTopLevelKeywordIndex(queryText, "limit");
  if (limitIndex < 0) return null;
  const valueSegment = queryText.slice(limitIndex + "limit".length).trimStart();
  const valueMatch = valueSegment.match(/^(\d+)/);
  if (!valueMatch?.[1]) return null;
  return Number(valueMatch[1]);
}
