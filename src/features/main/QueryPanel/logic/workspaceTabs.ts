// 数据查询 Tab 的最小输入结构：仅依赖工作区映射所需字段。
export type DataWorkspaceTab = {
  // 对象 Tab 稳定唯一键：用于区分不同数据源的同名对象。
  bindingKey: string;
  // 对象 API 名称。
  objectName: string;
  // 对象 Tab 绑定的数据源 ID。
  sourceId?: string;
  // 对象 Tab 绑定的数据源名称。
  sourceName?: string;
  // 展示标题：优先使用对象标签，兜底为对象 API 名称。
  title?: string;
};

// 控制台 Tab 的最小输入结构：仅依赖工作区映射所需字段。
export type ConsoleWorkspaceTab = {
  // 控制台 Tab 唯一 ID。
  id: string;
  // 控制台 Tab 名称。
  name: string;
  // 控制台 Tab 绑定的数据源 ID。
  sourceId?: string;
  // 控制台 Tab 绑定的数据源名称。
  sourceName?: string;
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
  // 目标 ID：data 为对象 Tab bindingKey，console 为 soqlTabId。
  targetId: string;
};

// 生成 data 工作区 Tab ID。
export function buildDataWorkspaceTabId(bindingKey: string): string {
  return `data:${bindingKey}`;
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

// 构建统一工作区 Tab 列表：提供 data/console 基础映射，最终展示顺序由 hook 层维护。
export function buildWorkspaceTabs(dataTabs: DataWorkspaceTab[], consoleTabs: ConsoleWorkspaceTab[]): WorkspaceTabItem[] {
  const sourceNameSet = new Set(
    [...dataTabs, ...consoleTabs]
      .map((tab) => String(tab.sourceName || tab.sourceId || "").trim())
      .filter((item) => item !== "")
  );
  const shouldAppendSourceName = sourceNameSet.size > 1;
  const buildWorkspaceTitle = (baseTitle: string, sourceName?: string, sourceId?: string): string => {
    const resolvedSourceName = String(sourceName || sourceId || "").trim();
    if (!shouldAppendSourceName || !resolvedSourceName) return baseTitle;
    return `${baseTitle} [${resolvedSourceName}]`;
  };

  return [
    ...dataTabs.map((tab) => ({
      id: buildDataWorkspaceTabId(tab.bindingKey),
      kind: "data" as const,
      title: buildWorkspaceTitle(tab.title || tab.objectName, tab.sourceName, tab.sourceId)
    })),
    ...consoleTabs.map((tab) => ({
      id: buildConsoleWorkspaceTabId(tab.id),
      kind: "console" as const,
      title: buildWorkspaceTitle(tab.name, tab.sourceName, tab.sourceId)
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
  // 回退优先级：优先落到 data（对象查询），避免因 console 的瞬时失效 ID 抢占焦点。
  if (activeDataObjectName) return buildDataWorkspaceTabId(activeDataObjectName);
  // 当没有可用 data 时，再回退到 console 的当前激活 tab。
  if (currentActiveWorkspaceTabId.startsWith("console:") && activeConsoleTabId) {
    return buildConsoleWorkspaceTabId(activeConsoleTabId);
  }
  if (activeConsoleTabId) return buildConsoleWorkspaceTabId(activeConsoleTabId);
  return "";
}
