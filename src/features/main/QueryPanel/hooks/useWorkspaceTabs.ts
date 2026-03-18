import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildDataWorkspaceTabId,
  buildWorkspaceTabs,
  parseWorkspaceTabId,
  resolveActiveWorkspaceTabId,
  type ConsoleWorkspaceTab,
  type DataWorkspaceTab,
  type WorkspaceTabTarget
} from "../logic/workspaceTabs";

export {
  buildConsoleWorkspaceTabId,
  buildDataWorkspaceTabId,
  parseWorkspaceTabId,
  resolveActiveWorkspaceTabId
} from "../logic/workspaceTabs";

type UseWorkspaceTabsInput = {
  // data 工作区 Tab 列表。
  dataTabs: DataWorkspaceTab[];
  // console 工作区 Tab 列表。
  consoleTabs: ConsoleWorkspaceTab[];
  // 当前激活 data 对象名。
  activeDataObjectName: string;
  // 当前激活 console Tab ID。
  activeConsoleTabId: string;
};

// 统一工作区 Tab hook：集中处理列表映射、激活态回退和 data 焦点同步。
export function useWorkspaceTabs({
  dataTabs,
  consoleTabs,
  activeDataObjectName,
  activeConsoleTabId
}: UseWorkspaceTabsInput) {
  // 当前激活工作区 Tab ID：由 UI 层控制并与 store 双向同步。
  const [activeWorkspaceTabId, setActiveWorkspaceTabId] = useState("");
  // 工作区 Tab 展示顺序：保留既有顺序，并将新打开 Tab 始终追加到末尾。
  const [workspaceTabOrder, setWorkspaceTabOrder] = useState<string[]>([]);
  // 统一工作区原始 Tab 列表：用于计算增量与基础映射。
  const baseWorkspaceTabs = useMemo(() => buildWorkspaceTabs(dataTabs, consoleTabs), [dataTabs, consoleTabs]);

  // 拖拽排序回调：仅调整展示顺序，不改变“激活态”与业务 tab 的归属关系。
  const reorderWorkspaceTabs = useCallback((activeId: string, overId: string) => {
    if (!activeId || !overId) return;
    if (activeId === overId) return;
    setWorkspaceTabOrder((current) => {
      const fromIndex = current.indexOf(activeId);
      const toIndex = current.indexOf(overId);
      if (fromIndex < 0 || toIndex < 0) return current; // 防御：拖拽目标不在当前顺序中时忽略。
      if (fromIndex === toIndex) return current;
      const nextOrder = [...current];
      nextOrder.splice(fromIndex, 1); // 先移除拖拽项。
      nextOrder.splice(toIndex, 0, activeId); // 再插入到目标位置。
      return nextOrder;
    });
  }, []);

  // 维护稳定顺序：删除已关闭 Tab，并把新增 Tab 统一追加在最后。
  useEffect(() => {
    const currentIdSet = new Set(baseWorkspaceTabs.map((tab) => tab.id));
    const preservedOrder = workspaceTabOrder.filter((tabId) => currentIdSet.has(tabId));
    const preservedSet = new Set(preservedOrder);
    const appendedIds = baseWorkspaceTabs.map((tab) => tab.id).filter((tabId) => !preservedSet.has(tabId));
    const nextOrder = [...preservedOrder, ...appendedIds];
    if (nextOrder.length === workspaceTabOrder.length && nextOrder.every((tabId, index) => tabId === workspaceTabOrder[index])) {
      return;
    }
    setWorkspaceTabOrder(nextOrder); // 仅在顺序真实变化时回写，避免无意义渲染。
  }, [baseWorkspaceTabs, workspaceTabOrder]);

  // 按稳定顺序输出工作区 Tab：确保“新开在末尾”。
  const workspaceTabs = useMemo(() => {
    const tabMap = new Map(baseWorkspaceTabs.map((tab) => [tab.id, tab] as const));
    return workspaceTabOrder.map((tabId) => tabMap.get(tabId)).filter((tab): tab is NonNullable<typeof tab> => Boolean(tab));
  }, [baseWorkspaceTabs, workspaceTabOrder]);

  // 工作区激活态修正：当前激活 ID 无效时，按 data > console > 空态回退。
  useEffect(() => {
    const nextWorkspaceTabId = resolveActiveWorkspaceTabId({
      workspaceTabs,
      currentActiveWorkspaceTabId: activeWorkspaceTabId,
      activeDataObjectName,
      activeConsoleTabId
    });
    if (nextWorkspaceTabId === activeWorkspaceTabId) return;
    setActiveWorkspaceTabId(nextWorkspaceTabId); // 回写修正后的激活态。
  }, [workspaceTabs, activeWorkspaceTabId, activeDataObjectName, activeConsoleTabId]);

  // 当 data 侧主动切换对象 Tab 时，若当前不是 console 焦点，则同步工作区激活态。
  useEffect(() => {
    if (!activeDataObjectName) return;
    const current = parseWorkspaceTabId(activeWorkspaceTabId);
    if (current?.kind === "console") return; // 用户明确在 console，不覆盖焦点。
    const nextWorkspaceTabId = buildDataWorkspaceTabId(activeDataObjectName);
    if (nextWorkspaceTabId === activeWorkspaceTabId) return;
    setActiveWorkspaceTabId(nextWorkspaceTabId); // 保持 data 焦点与工作区一致。
  }, [activeDataObjectName, activeWorkspaceTabId]);

  // 当前激活工作区 Tab 解析结果。
  const activeWorkspaceTabParsed: WorkspaceTabTarget | null = useMemo(
    () => parseWorkspaceTabId(activeWorkspaceTabId),
    [activeWorkspaceTabId]
  );
  // 当前激活工作区类型：默认 data，保证 Query 页面可渲染。
  const activeWorkspaceTabKind: "data" | "console" = activeWorkspaceTabParsed?.kind || "data";

  return {
    workspaceTabs,
    activeWorkspaceTabId,
    setActiveWorkspaceTabId,
    reorderWorkspaceTabs,
    activeWorkspaceTabParsed,
    activeWorkspaceTabKind
  };
}
