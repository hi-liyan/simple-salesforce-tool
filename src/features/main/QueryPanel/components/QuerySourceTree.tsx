import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../../../../api";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import { useSourceTreeState, type QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";
import { buildSourceSurfacePalette, getSourceColor } from "../logic/sourceColor.ts";
import type { QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";
import { QuerySourceTreeNode } from "./QuerySourceTreeNode";

type QuerySourceTreeProps = {
  // 全部数据源。
  sources: SalesforceSource[];
  // 兼容层：当前页面已持有的 sourceId。
  selectedSourceId: string;
  // 兼容层：当前页面已持有的对象列表。
  objects: SalesforceObject[];
  // 兼容层：当前页面对象列表加载态。
  objectsLoading: boolean;
  // 当前激活对象身份。
  activeTabObjectName: string;
  // 打开对象回调。
  onOpenObject: (item: SalesforceObject, source?: SalesforceSource) => void;
  // 刷新指定 MySQL 表的字段元数据与 DDL。
  onRefreshMysqlObjectMetadata: (objectName: string) => Promise<unknown>;
  // 强刷指定数据源后同步工作区缓存与已打开 Tab。
  onRefreshSourceWorkspace?: (sourceId: string) => Promise<void>;
  // 不可查询对象提示。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 对外暴露刷新聚焦数据源能力。
  onReady?: (actions: {
    refreshFocusedSource: () => Promise<void>;
    getFocusedSourceId: () => string;
    locateNodeByTarget: (target: { sourceId: string; objectName?: string }) => Promise<void>;
    searchFocusedSourceObjects: (keyword: string) => Promise<QuerySourceObjectSearchResult[]>;
    openObjectByTarget: (target: { sourceId: string; objectName: string }) => Promise<void>;
  }) => void;
};

type QuerySourceTreeBranchProps = {
  // 当前分支节点列表。
  nodes: QueryTreeRenderNode[];
  // 当前分支层级。
  level: number;
  // 数据源背景色映射：用于维持同一来源的连续背景区域。
  sourceSurfaceBackgroundById: Record<string, string>;
  // 当前左树纯状态。
  treeState: ReturnType<typeof useSourceTreeState>["treeState"];
  // 当前激活对象身份。
  activeTabObjectName: string;
  // 单击节点。
  onNodeClick: ReturnType<typeof useSourceTreeState>["onNodeClick"];
  // 双击节点。
  onNodeDoubleClick: ReturnType<typeof useSourceTreeState>["onNodeDoubleClick"];
  // 点击展开箭头。
  onToggleNode: ReturnType<typeof useSourceTreeState>["onToggleNode"];
  // 右键 Object 节点。
  onObjectContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) => void;
  // 解析 Object 节点 tooltip。
  getObjectTooltip?: (node: QueryTreeRenderNode) => string;
  // 注册节点 DOM：供外层滚动定位。
  registerNodeElement: (nodeId: string, element: HTMLDivElement | null) => void;
};

// 递归树分支：改用受控 DOM 树渲染，避免虚拟树在当前布局下产生 hover 闪烁与事件丢失。
function QuerySourceTreeBranch({
  nodes,
  level,
  sourceSurfaceBackgroundById,
  treeState,
  activeTabObjectName,
  onNodeClick,
  onNodeDoubleClick,
  onToggleNode,
  onObjectContextMenu,
  getObjectTooltip,
  registerNodeElement
}: QuerySourceTreeBranchProps) {
  return (
    <>
      {/* 当前层节点列表：按当前树状态逐个渲染，并在展开时递归输出子节点。 */}
      {nodes.map((node) => {
        const rowBackgroundColor = sourceSurfaceBackgroundById[node.sourceId] || "";
        const isOpen = treeState.expandedNodeIds.includes(node.id);
        const childNodes = node.children || [];

        return (
          <div key={node.id}>
            {/* 当前节点行：统一复用节点渲染器，保持既有视觉样式。 */}
            <QuerySourceTreeNode
              node={node}
              level={level}
              isOpen={isOpen}
              rowBackgroundColor={rowBackgroundColor}
              treeState={treeState}
              activeTabObjectName={activeTabObjectName}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={(targetNode) => {
                void onNodeDoubleClick(targetNode);
              }}
              onToggleNode={(targetNode) => {
                void onToggleNode(targetNode);
              }}
              onObjectContextMenu={onObjectContextMenu}
              getObjectTooltip={getObjectTooltip}
              registerNodeElement={registerNodeElement}
            />

            {/* 子节点区域：仅在当前节点已展开时递归渲染。 */}
            {isOpen && childNodes.length > 0 && (
              <QuerySourceTreeBranch
                nodes={childNodes}
                level={level + 1}
                sourceSurfaceBackgroundById={sourceSurfaceBackgroundById}
                treeState={treeState}
                activeTabObjectName={activeTabObjectName}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onToggleNode={onToggleNode}
                onObjectContextMenu={onObjectContextMenu}
                getObjectTooltip={getObjectTooltip}
                registerNodeElement={registerNodeElement}
              />
            )}
          </div>
        );
      })}
    </>
  );
}

// 左侧多数据源树：统一展示所有 source，并按需懒加载子节点。
export function QuerySourceTree({
  sources,
  selectedSourceId,
  objects,
  objectsLoading,
  activeTabObjectName,
  onOpenObject,
  onRefreshMysqlObjectMetadata,
  onRefreshSourceWorkspace,
  onNotQueryableObjectClick,
  onReady
}: QuerySourceTreeProps) {
  // 树滚动容器：供横向/纵向滚动和定位节点时复用。
  const containerRef = useRef<HTMLDivElement | null>(null);
  // 节点 DOM 映射：用于按节点 ID 滚动定位到对应行。
  const nodeElementMapRef = useRef<Record<string, HTMLDivElement | null>>({});
  // 待滚动定位的节点 ID：在展开态更新后滚动到目标行。
  const [pendingScrollNodeId, setPendingScrollNodeId] = useState("");
  // Object 右键菜单状态：记录菜单位置与目标对象。
  const [objectContextMenu, setObjectContextMenu] = useState<{
    x: number;
    y: number;
    objectItem: SalesforceObject;
    source: SalesforceSource;
  } | null>(null);
  // 数据源浅色背景映射：供每一行形成连续的来源背景区块。
  const sourceSurfaceBackgroundById = useMemo(
    () =>
      sources.reduce<Record<string, string>>((acc, source) => {
        const sourceColor = getSourceColor(source);
        const surfacePalette = buildSourceSurfacePalette(sourceColor);
        acc[source.id] = surfacePalette?.backgroundColor || "";
        return acc;
      }, {}),
    [sources]
  );

  const {
    treeData,
    treeState,
    onNodeClick,
    onNodeDoubleClick,
    onToggleNode,
    refreshFocusedSource,
    locateNodeByTarget: locateTreeNodeByTarget,
    searchFocusedSourceObjects,
    openObjectByTarget
  } = useSourceTreeState({
    sources,
    selectedSourceId,
    selectedSourceObjects: objects,
    selectedSourceObjectsLoading: objectsLoading,
    onOpenObject,
    onNotQueryableObjectClick
  });
  // 数据源索引：供 tooltip、右键菜单动作快速解析来源信息。
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  // 注册节点 DOM：供滚动定位复用。
  const registerNodeElement = useCallback((nodeId: string, element: HTMLDivElement | null) => {
    nodeElementMapRef.current[nodeId] = element;
  }, []);

  // 全局关闭对象右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!objectContextMenu) return;

    const closeMenu = () => {
      setObjectContextMenu(null); // 行内注释：统一关闭菜单，避免浮层残留。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // 行内注释：支持 ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [objectContextMenu]);

  // 节点定位滚动：等待展开后的 DOM 完成挂载，再把目标节点滚动到可视区域。
  useEffect(() => {
    if (!pendingScrollNodeId) return;

    const scrollToTargetNode = () => {
      const targetElement = nodeElementMapRef.current[pendingScrollNodeId];
      if (!targetElement) return;
      targetElement.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
      setPendingScrollNodeId(""); // 行内注释：本轮滚动完成后清空目标，避免后续重复滚动。
    };

    const frameId = window.requestAnimationFrame(scrollToTargetNode);
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingScrollNodeId, treeData, treeState.expandedNodeIds]);

  // 从树节点解析完整对象信息：恢复旧版 tooltip/右键菜单依赖的对象元数据。
  function resolveObjectItemFromNode(node: QueryTreeRenderNode): SalesforceObject | null {
    if (node.kind !== "object") return null;
    const objectItems = treeState.sourceObjectsById[node.sourceId] || [];
    return objectItems.find((item) => item.name === node.objectName) || null;
  }

  // 定位当前工作区目标：data Tab 定位对象节点，console Tab 定位所属数据源根节点。
  const locateNodeByTarget = useCallback(
    async (target: { sourceId: string; objectName?: string }) => {
      const locateResult = await locateTreeNodeByTarget(target);
      if (!locateResult) return;
      setPendingScrollNodeId(locateResult.targetNodeId); // 行内注释：展开态更新完成后再由副作用执行滚动定位。
    },
    [locateTreeNodeByTarget]
  );

  // 将刷新动作回传给侧边栏顶部按钮，避免继续走“全量刷新 source 列表”旧逻辑。
  useEffect(() => {
    onReady?.({
      refreshFocusedSource: async () => {
        const focusedSourceId = treeState.focusedSourceId;
        await refreshFocusedSource(); // 行内注释：先由左树完成对象列表强刷与节点更新。
        if (!focusedSourceId || !onRefreshSourceWorkspace) return;
        await onRefreshSourceWorkspace(focusedSourceId); // 行内注释：工作区只复用这轮强刷结果做后续同步，不再重复拉对象列表。
      },
      getFocusedSourceId: () => treeState.focusedSourceId,
      locateNodeByTarget,
      searchFocusedSourceObjects,
      openObjectByTarget
    });
  }, [
    locateNodeByTarget,
    onReady,
    onRefreshSourceWorkspace,
    openObjectByTarget,
    refreshFocusedSource,
    searchFocusedSourceObjects,
    treeState.focusedSourceId
  ]);

  // 构建对象 tooltip：MySQL 与 Salesforce 按各自元数据摘要展示。
  function getObjectTooltip(node: QueryTreeRenderNode): string {
    const objectItem = resolveObjectItemFromNode(node);
    if (!objectItem) return "";
    const normalizedSourceType = String(node.sourceType || "salesforce").toLowerCase();
    if (normalizedSourceType === "mysql") {
      return [
        `表名: ${objectItem.name}`,
        `注释: ${objectItem.comment?.trim() || "-"}`
      ].join("\n");
    }
    return [
      `名称: ${objectItem.name}`,
      `标签: ${objectItem.label}`,
      `可查询: ${objectItem.queryable ? "是" : "否"}`,
      `可新增: ${objectItem.createable ? "是" : "否"}`,
      `可更新: ${objectItem.updateable ? "是" : "否"}`,
      `可删除: ${objectItem.deletable ? "是" : "否"}`
    ].join("\n");
  }

  // 打开右键菜单：恢复旧版 Salesforce / MySQL 对象节点菜单能力。
  function handleObjectContextMenu(event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) {
    event.preventDefault(); // 行内注释：阻止浏览器默认右键菜单。
    event.stopPropagation(); // 行内注释：避免右键时触发行选中链路的额外副作用。
    if (node.kind !== "object") return;
    const source = sourceMap.get(node.sourceId);
    const objectItem = resolveObjectItemFromNode(node);
    if (!source || !objectItem) return;
    setObjectContextMenu({
      x: event.clientX,
      y: event.clientY,
      objectItem,
      source
    });
  }

  // 右键菜单动作：复制 Object 名称。
  async function copyObjectNameFromMenu() {
    if (!objectContextMenu) return;
    const objectName = objectContextMenu.objectItem.name;
    setObjectContextMenu(null); // 行内注释：复制后立即关闭菜单。
    await navigator.clipboard.writeText(objectName);
  }

  // 右键菜单动作：打开 Salesforce 列表页。
  async function openSalesforceListPageFromMenu() {
    if (!objectContextMenu) return;
    const { source, objectItem } = objectContextMenu;
    setObjectContextMenu(null); // 行内注释：先关闭菜单，避免等待期间悬浮层残留。
    if (!objectItem.queryable) {
      onNotQueryableObjectClick?.(objectItem);
      return;
    }
    await api.openObjectListPage(source.id, objectItem.name);
  }

  // 右键菜单动作：打开 Salesforce Object 管理页。
  async function openSalesforceObjectEditPageFromMenu() {
    if (!objectContextMenu) return;
    const { source, objectItem } = objectContextMenu;
    setObjectContextMenu(null); // 行内注释：先关闭菜单，确保 UI 反馈及时。
    await api.openObjectEditPage(source.id, objectItem.name);
  }

  // 右键菜单动作：强制刷新当前 MySQL 表的字段元数据与 DDL。
  async function refreshMysqlObjectFromMenu() {
    if (!objectContextMenu) return;
    const { source, objectItem } = objectContextMenu;
    setObjectContextMenu(null); // 行内注释：先关闭菜单，避免等待期间悬浮层残留。
    if (String(source.sourceType || "salesforce").toLowerCase() !== "mysql") return;
    await onRefreshMysqlObjectMetadata(objectItem.name);
  }

  // 对象右键菜单项：仅复用菜单 UI，具体动作仍在当前组件实现。
  const objectContextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!objectContextMenu) return [];

    const normalizedSourceType = String(objectContextMenu.source.sourceType || "salesforce").toLowerCase();
    const baseEntries: ContextMenuEntry[] = [
      {
        id: "copy-object-name",
        label: "复制表名",
        onClick: () => {
          void copyObjectNameFromMenu(); // 行内注释：复制对象名称并关闭菜单。
        }
      }
    ];

    if (normalizedSourceType === "mysql") {
      return [
        ...baseEntries,
        { id: "mysql-separator", type: "separator" },
        {
          id: "refresh-mysql-object",
          label: "刷新",
          onClick: () => {
            void refreshMysqlObjectFromMenu(); // 行内注释：刷新 MySQL 表的字段元数据与 DDL。
          }
        }
      ];
    }

    if (normalizedSourceType === "salesforce") {
      return [
        ...baseEntries,
        { id: "salesforce-separator", type: "separator" },
        {
          id: "open-salesforce-list-page",
          label: "打开 Salesforce 列表页",
          disabled: !objectContextMenu.objectItem.queryable,
          onClick: () => {
            void openSalesforceListPageFromMenu(); // 行内注释：打开 Salesforce 列表页。
          }
        },
        {
          id: "open-salesforce-object-edit-page",
          label: "编辑 Object 页面",
          onClick: () => {
            void openSalesforceObjectEditPageFromMenu(); // 行内注释：打开 Object 管理页。
          }
        }
      ];
    }

    return baseEntries;
  }, [objectContextMenu]);

  if (sources.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white px-4 text-[12px] text-neutral/60">
        暂无数据源，点击上方“新增数据源”开始配置。
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-white">
      {/* 树滚动区域：同时承接纵向和横向滚动，不再依赖第三方虚拟树容器。 */}
      <div ref={containerRef} className="h-full w-full overflow-auto">
        {/* 树内容区域：允许超长节点真实撑开宽度，以显示底部横向滚动条。 */}
        <div className="min-h-full min-w-full w-max py-2">
          <QuerySourceTreeBranch
            nodes={treeData}
            level={0}
            sourceSurfaceBackgroundById={sourceSurfaceBackgroundById}
            treeState={treeState}
            activeTabObjectName={activeTabObjectName}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onToggleNode={onToggleNode}
            onObjectContextMenu={handleObjectContextMenu}
            getObjectTooltip={getObjectTooltip}
            registerNodeElement={registerNodeElement}
          />
        </div>
      </div>

      {/* Object 右键菜单：复用公共菜单容器，具体动作仍由树组件自己定义。 */}
      {objectContextMenu && (
        <ContextMenu x={objectContextMenu.x} y={objectContextMenu.y} entries={objectContextMenuEntries} />
      )}
    </div>
  );
}
