import type { ObjectDescribe, TabState } from "../../../../types/index.ts";

type EnsureQueryTabReadyInput = {
  // 当前命中的对象 Tab。
  tab: TabState | null;
  // 当前 Tab 的稳定唯一键。
  tabBindingKey: string;
  // 当前 Tab 绑定的对象名。
  tabObjectName: string;
  // 当前 Tab 绑定的数据源 ID。
  resolvedSourceId: string;
  // 当前 Tab 绑定的数据源类型。
  resolvedSourceType: string;
  // 调用方传入的 describe 覆盖值；存在时直接复用。
  describeOverride?: ObjectDescribe;
  // 拉取对象 describe。
  loadDescribe: (sourceId: string, objectName: string) => Promise<ObjectDescribe>;
  // 拉取字段可见性。
  loadColumnVisibility: (sourceId: string, objectName: string, describe: ObjectDescribe) => Promise<Record<string, boolean>>;
  // 获取可排序字段名集合。
  getSortableFieldNames: (describe: ObjectDescribe) => string[];
  // 选择默认排序字段。
  pickDefaultSortField: (sortableFieldNames: string[]) => string;
  // 将补齐后的元数据回写到当前 Tab。
  patchTab: (tabIdentity: string, updater: (tab: TabState) => TabState) => void;
};

type EnsureQueryTabReadyResult = {
  // 当前查询可用的 describe。
  describe: ObjectDescribe;
  // 已补齐元数据后的 Tab 快照。
  tab: TabState;
};

// 查询预热：当 Tab 尚未补齐 describe/字段可见性时，先同步元数据，再继续执行查询。
export async function ensureQueryTabReady({
  tab,
  tabBindingKey,
  tabObjectName,
  resolvedSourceId,
  resolvedSourceType,
  describeOverride,
  loadDescribe,
  loadColumnVisibility,
  getSortableFieldNames,
  pickDefaultSortField,
  patchTab
}: EnsureQueryTabReadyInput): Promise<EnsureQueryTabReadyResult> {
  if (!tab) {
    throw new Error("当前查询标签不存在。");
  }

  const existingDescribe = describeOverride ?? tab.describe;
  if (existingDescribe) {
    return {
      describe: existingDescribe,
      tab
    };
  }

  const describe = await loadDescribe(resolvedSourceId, tabObjectName);
  const visibility = await loadColumnVisibility(resolvedSourceId, tabObjectName, describe);
  const normalizedSourceType = String(resolvedSourceType || tab.sourceType || "salesforce");
  const defaultSortField = pickDefaultSortField(getSortableFieldNames(describe));
  const nextTab: TabState = {
    ...tab,
    sourceId: resolvedSourceId,
    sourceType: normalizedSourceType,
    describe,
    columnVisibility: visibility,
    sortField: tab.sortField || defaultSortField
  };

  patchTab(tabBindingKey, () => nextTab);
  return {
    describe,
    tab: nextTab
  };
}
