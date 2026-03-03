import { useEffect, useMemo, useState } from "react";
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
  // 统一工作区 Tab 列表：固定输出顺序，降低用户定位成本。
  const workspaceTabs = useMemo(() => buildWorkspaceTabs(dataTabs, consoleTabs), [dataTabs, consoleTabs]);

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
    activeWorkspaceTabParsed,
    activeWorkspaceTabKind
  };
}
