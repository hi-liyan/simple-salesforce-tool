import { useCallback, useEffect, useMemo, useState } from "react";
import { sortTabsByOrder, moveTabOrder } from "../../../../components/tabs/tabOrder";
import { useQueryWorkspaceTabsStore } from "../../../../store/useQueryWorkspaceTabsStore";
import {
  buildConsoleWorkspaceTabId,
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
  // 统一工作区原始 Tab 列表：用于计算增量与基础映射。
  const baseWorkspaceTabs = useMemo(() => buildWorkspaceTabs(dataTabs, consoleTabs), [dataTabs, consoleTabs]);
  // 全局工作区持久化顺序：data/console 混排，不再按 source 分桶。
  const workspaceTabOrder = useQueryWorkspaceTabsStore(useCallback((state) => state.getTabOrder(), []));
  // 回写工作区顺序。
  const setWorkspaceTabOrder = useQueryWorkspaceTabsStore((state) => state.setTabOrder);

  // 拖拽排序回调：仅调整展示顺序，不改变“激活态”与业务 tab 的归属关系。
  const reorderWorkspaceTabs = useCallback((activeId: string, overId: string) => {
    if (!activeId || !overId) return;
    if (activeId === overId) return;
    setWorkspaceTabOrder("", (current) => moveTabOrder(current, activeId, overId));
  }, [setWorkspaceTabOrder]);

  // 维护稳定顺序：删除已关闭 Tab，并把新增 Tab 统一追加在最后。
  useEffect(() => {
    const nextOrder = sortTabsByOrder(workspaceTabOrder, baseWorkspaceTabs).map((tab) => tab.id);
    if (nextOrder.length === workspaceTabOrder.length && nextOrder.every((tabId, index) => tabId === workspaceTabOrder[index])) {
      return;
    }
    setWorkspaceTabOrder("", nextOrder); // 仅在顺序真实变化时回写，避免无意义渲染。
  }, [baseWorkspaceTabs, setWorkspaceTabOrder, workspaceTabOrder]);

  // 按稳定顺序输出工作区 Tab：确保“新开在末尾”。
  const workspaceTabs = useMemo(() => sortTabsByOrder(workspaceTabOrder, baseWorkspaceTabs), [baseWorkspaceTabs, workspaceTabOrder]);

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

  // 当 console 侧主动切换 Tab 时，若当前工作区焦点就在 console，则同步工作区激活态。
  // 典型场景：AI“新建Tab并应用”会在 store 内切换 activeConsoleTabId，需让工作区同步到新 tab。
  useEffect(() => {
    if (!activeConsoleTabId) return;
    const current = parseWorkspaceTabId(activeWorkspaceTabId);
    if (current?.kind !== "console") return; // 仅当用户当前就在 console 时才同步焦点，避免覆盖回退优先级。
    const nextWorkspaceTabId = buildConsoleWorkspaceTabId(activeConsoleTabId);
    if (nextWorkspaceTabId === activeWorkspaceTabId) return;
    setActiveWorkspaceTabId(nextWorkspaceTabId); // 保持 console 焦点与工作区一致。
  }, [activeConsoleTabId, activeWorkspaceTabId]);

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
