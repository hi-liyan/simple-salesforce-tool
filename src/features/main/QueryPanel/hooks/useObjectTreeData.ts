import { useMemo } from "react";
import { SalesforceSource } from "../../../../types";

type UseObjectTreeDataInput = {
  // 数据源列表：用于计算当前选中源类型。
  sources: SalesforceSource[];
  // 当前选中数据源 ID。
  selectedSourceId: string;
  // 对象列表展示模式：list/tree。
  objectListMode: "list" | "tree";
};

type UseObjectTreeDataResult = {
  // 当前数据源类型：用于对象树能力分支。
  selectedSourceType: string;
  // 是否启用树模式。
  treeMode: boolean;
};

// 对象树派生状态：集中计算对象树渲染所需数据，降低侧边栏组件复杂度。
export function useObjectTreeData({ sources, selectedSourceId, objectListMode }: UseObjectTreeDataInput): UseObjectTreeDataResult {
  // 当前选中数据源类型：用于对象右键能力和树节点分支。
  const selectedSourceType = useMemo(
    () => sources.find((source) => source.id === selectedSourceId)?.sourceType || "salesforce",
    [sources, selectedSourceId]
  );
  // 对象列表是否树模式。
  const treeMode = objectListMode === "tree";
  return { selectedSourceType, treeMode };
}
