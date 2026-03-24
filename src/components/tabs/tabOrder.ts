// 可排序标签最小结构：仅要求具备唯一 ID。
export type OrderableTabItem = {
  // 标签唯一标识。
  id: string;
};

// 标签批量关闭模式：用于右键菜单批量关闭计算。
export type TabCloseMode = "left" | "right" | "others" | "all";

// 归一化标签顺序：过滤无效 ID，并将缺失标签追加到末尾。
export function normalizeTabOrder<T extends OrderableTabItem>(order: string[], tabs: T[]): string[] {
  const tabIdSet = new Set(tabs.map((tab) => tab.id));
  const preservedOrder = order.filter((tabId, index) => tabIdSet.has(tabId) && order.indexOf(tabId) === index);
  const preservedSet = new Set(preservedOrder);
  const appendedIds = tabs.map((tab) => tab.id).filter((tabId) => !preservedSet.has(tabId));
  return [...preservedOrder, ...appendedIds];
}

// 按顺序快照输出标签列表：若顺序不完整，则自动补齐。
export function sortTabsByOrder<T extends OrderableTabItem>(order: string[], tabs: T[]): T[] {
  const normalizedOrder = normalizeTabOrder(order, tabs);
  const tabMap = new Map(tabs.map((tab) => [tab.id, tab] as const));
  return normalizedOrder.map((tabId) => tabMap.get(tabId)).filter((tab): tab is T => Boolean(tab));
}

// 调整标签顺序：将活动标签移动到目标标签位置。
export function moveTabOrder(order: string[], activeTabId: string, overTabId: string): string[] {
  if (!activeTabId || !overTabId) return order;
  if (activeTabId === overTabId) return order;
  const fromIndex = order.indexOf(activeTabId);
  const toIndex = order.indexOf(overTabId);
  if (fromIndex < 0 || toIndex < 0) return order;
  const nextOrder = [...order];
  nextOrder.splice(fromIndex, 1);
  nextOrder.splice(toIndex, 0, activeTabId);
  return nextOrder;
}

// 根据关闭模式计算应关闭的标签 ID 列表。
export function getTabIdsByCloseMode<T extends OrderableTabItem>(tabs: T[], targetTabId: string, mode: TabCloseMode): string[] {
  const index = tabs.findIndex((tab) => tab.id === targetTabId);
  if (index < 0) return mode === "all" ? tabs.map((tab) => tab.id) : [];

  if (mode === "left") {
    return tabs.slice(0, index).map((tab) => tab.id);
  }
  if (mode === "right") {
    return tabs.slice(index + 1).map((tab) => tab.id);
  }
  if (mode === "others") {
    return tabs.filter((tab) => tab.id !== targetTabId).map((tab) => tab.id);
  }
  return tabs.map((tab) => tab.id);
}
