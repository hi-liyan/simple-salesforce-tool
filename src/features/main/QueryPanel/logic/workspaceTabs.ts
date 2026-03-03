// 数据查询 Tab 的最小输入结构：仅依赖工作区映射所需字段。
export type DataWorkspaceTab = {
  // 对象 API 名称。
  objectName: string;
};

// 控制台 Tab 的最小输入结构：仅依赖工作区映射所需字段。
export type ConsoleWorkspaceTab = {
  // 控制台 Tab 唯一 ID。
  id: string;
  // 控制台 Tab 名称。
  name: string;
};

// 统一工作区 Tab 项：用于 data/console 混合渲染。
export type WorkspaceTabItem = {
  // 唯一 ID（例如 data:Account / console:soql-tab-1）。
  id: string;
  // Tab 类型：data=对象查询，console=查询控制台。
  kind: "data" | "console";
  // Tab 标题。
  title: string;
};

// 统一工作区 Tab 解析结果。
export type WorkspaceTabTarget = {
  // Tab 类型：data=对象查询，console=查询控制台。
  kind: "data" | "console";
  // 目标 ID：data 为 objectName，console 为 soqlTabId。
  targetId: string;
};

// 生成 data 工作区 Tab ID。
export function buildDataWorkspaceTabId(objectName: string): string {
  return `data:${objectName}`;
}

// 生成 console 工作区 Tab ID。
export function buildConsoleWorkspaceTabId(tabId: string): string {
  return `console:${tabId}`;
}

// 解析统一工作区 Tab ID。
export function parseWorkspaceTabId(workspaceTabId: string): WorkspaceTabTarget | null {
  if (workspaceTabId.startsWith("data:")) {
    return { kind: "data", targetId: workspaceTabId.slice("data:".length) };
  }
  if (workspaceTabId.startsWith("console:")) {
    return { kind: "console", targetId: workspaceTabId.slice("console:".length) };
  }
  return null;
}

// 构建统一工作区 Tab 列表：固定 data 在前、console 在后。
export function buildWorkspaceTabs(dataTabs: DataWorkspaceTab[], consoleTabs: ConsoleWorkspaceTab[]): WorkspaceTabItem[] {
  return [
    ...dataTabs.map((tab) => ({
      id: buildDataWorkspaceTabId(tab.objectName),
      kind: "data" as const,
      title: tab.objectName
    })),
    ...consoleTabs.map((tab) => ({
      id: buildConsoleWorkspaceTabId(tab.id),
      kind: "console" as const,
      title: tab.name
    }))
  ];
}

type ResolveActiveWorkspaceTabIdInput = {
  // 当前可用的统一工作区 Tab 列表。
  workspaceTabs: WorkspaceTabItem[];
  // 当前激活工作区 Tab ID。
  currentActiveWorkspaceTabId: string;
  // 当前激活 data Tab 对象名。
  activeDataObjectName: string;
  // 当前激活 console Tab ID。
  activeConsoleTabId: string;
};

// 计算下一次应使用的激活工作区 Tab ID。
export function resolveActiveWorkspaceTabId({
  workspaceTabs,
  currentActiveWorkspaceTabId,
  activeDataObjectName,
  activeConsoleTabId
}: ResolveActiveWorkspaceTabIdInput): string {
  const hasCurrent = workspaceTabs.some((tab) => tab.id === currentActiveWorkspaceTabId);
  if (hasCurrent) return currentActiveWorkspaceTabId;
  if (activeDataObjectName) return buildDataWorkspaceTabId(activeDataObjectName);
  if (activeConsoleTabId) return buildConsoleWorkspaceTabId(activeConsoleTabId);
  return "";
}
