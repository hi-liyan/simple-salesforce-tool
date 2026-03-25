import { buildObjectTabBindingKey, type TabState } from "../../../../types/index.ts";

type ResolveQueryExecutionContextInput = {
  // 当前闭包里可见的 Query tabs。
  tabs: TabState[];
  // 本次查询目标 tab 身份（bindingKey 或 objectName）。
  tabIdentity: string;
  // 页面级当前数据源 ID：作为最后兜底。
  selectedSourceId: string;
  // 页面级当前数据源类型：作为最后兜底。
  selectedSourceType: string;
  // fallback tab：用于“刚创建但尚未进入闭包 tabs”的场景。
  fallbackTab?: TabState;
};

// 查询执行上下文：集中收敛对象名、bindingKey 与 source 元信息解析。
export type QueryExecutionContext = {
  tab: TabState | null;
  tabBindingKey: string;
  tabObjectName: string;
  resolvedSourceId: string;
  resolvedSourceType: string;
};

// 解析查询执行上下文：优先命中 tabs，其次回退到 fallbackTab，避免新建 tab 首次查询时拿到旧闭包数据。
export function resolveQueryExecutionContext({
  tabs,
  tabIdentity,
  selectedSourceId,
  selectedSourceType,
  fallbackTab
}: ResolveQueryExecutionContextInput): QueryExecutionContext | null {
  const tab = tabs.find((item) => item.bindingKey === tabIdentity || item.objectName === tabIdentity) || fallbackTab || null;
  if (!tab) return null;

  const tabObjectName = tab.objectName || tabIdentity;
  const resolvedSourceId = tab.sourceId || selectedSourceId;
  if (!resolvedSourceId) return null;

  const resolvedSourceType = String(tab.sourceType || selectedSourceType || "salesforce");
  const tabBindingKey = tab.bindingKey || buildObjectTabBindingKey(resolvedSourceId, tabObjectName);
  return {
    tab,
    tabBindingKey,
    tabObjectName,
    resolvedSourceId,
    resolvedSourceType
  };
}
