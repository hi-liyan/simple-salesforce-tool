import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { api } from "../../../../api";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import { getDataSourceDriver } from "../../../../drivers/registry";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import { useSourceTreeState, type QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";
import { buildSourceSurfacePalette, getSourceColor } from "../logic/sourceColor.ts";
import type { QuerySourceObjectSearchResult } from "../logic/sourceObjectSearch.ts";
import { buildSourceTreeContextMenuEntries } from "../logic/sourceTreeContextMenu.ts";
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
  // 打开查询控制台回调（支持携带初始 SQL）。
  onOpenConsole?: (source?: SalesforceSource, initialSql?: string) => void;
  // 打开 OAuth 授权窗口回调。
  onOpenAuthWindow?: () => void;
  // 提示消息回调。
  onNotify?: (message: string, tone?: "success" | "error") => void;
  // 刷新指定 MySQL 表的字段元数据与 DDL。
  onRefreshMysqlObjectMetadata: (objectName: string) => Promise<unknown>;
  // 强刷指定数据源后同步工作区缓存与已打开 Tab。
  onRefreshSourceWorkspace?: (sourceId: string) => Promise<void>;
  // 不可查询对象提示。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 当前聚焦数据源变化：供上层侧边栏实时同步搜索范围与动作上下文。
  onFocusedSourceChange?: (sourceId: string) => void;
  // 对外暴露树操作能力。
  onReady?: (actions: {
    refreshFocusedSource: () => Promise<void>;
    getFocusedSourceId: () => string;
    locateNodeByTarget: (target: { sourceId: string; objectName?: string }) => Promise<void>;
    searchFocusedSourceObjects: (keyword: string) => Promise<QuerySourceObjectSearchResult[]>;
    openObjectByTarget: (target: { sourceId: string; objectName: string }) => Promise<void>;
  }) => void;
};

type QuerySourceTreeBranchProps = {
  nodes: QueryTreeRenderNode[];
  level: number;
  expandedNodeIdSet: ReadonlySet<string>;
  sourceSurfaceBackgroundById: Record<string, string>;
  treeState: ReturnType<typeof useSourceTreeState>["treeState"];
  activeTabObjectName: string;
  onNodeClick: ReturnType<typeof useSourceTreeState>["onNodeClick"];
  onNodeDoubleClick: (node: QueryTreeRenderNode) => void | Promise<void>;
  onToggleNode: (node: QueryTreeRenderNode) => void | Promise<void>;
  onNodeContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) => void;
  getObjectTooltip?: (node: QueryTreeRenderNode) => string;
  registerNodeElement: (nodeId: string, element: HTMLDivElement | null) => void;
};

// 递归树分支。
function QuerySourceTreeBranch({
  nodes,
  level,
  expandedNodeIdSet,
  sourceSurfaceBackgroundById,
  treeState,
  activeTabObjectName,
  onNodeClick,
  onNodeDoubleClick,
  onToggleNode,
  onNodeContextMenu,
  getObjectTooltip,
  registerNodeElement
}: QuerySourceTreeBranchProps) {
  return (
    <>
      {nodes.map((node) => {
        const rowBackgroundColor = sourceSurfaceBackgroundById[node.sourceId] || "";
        const isOpen = expandedNodeIdSet.has(node.id);
        const childNodes = node.children || [];

        return (
          <div key={node.id}>
            <QuerySourceTreeNode
              node={node}
              level={level}
              isOpen={isOpen}
              rowBackgroundColor={rowBackgroundColor}
              treeState={treeState}
              activeTabObjectName={activeTabObjectName}
              onNodeClick={onNodeClick}
              onNodeDoubleClick={onNodeDoubleClick}
              onToggleNode={onToggleNode}
              onNodeContextMenu={onNodeContextMenu}
              getObjectTooltip={getObjectTooltip}
              registerNodeElement={registerNodeElement}
            />

            {isOpen && childNodes.length > 0 && (
              <QuerySourceTreeBranch
                nodes={childNodes}
                level={level + 1}
                expandedNodeIdSet={expandedNodeIdSet}
                sourceSurfaceBackgroundById={sourceSurfaceBackgroundById}
                treeState={treeState}
                activeTabObjectName={activeTabObjectName}
                onNodeClick={onNodeClick}
                onNodeDoubleClick={onNodeDoubleClick}
                onToggleNode={onToggleNode}
                onNodeContextMenu={onNodeContextMenu}
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

// 左侧多数据源树：统一展示所有 source、按需懒加载子节点、四级 DBX 风格右键菜单。
export function QuerySourceTree({
  sources,
  selectedSourceId,
  objects,
  objectsLoading,
  activeTabObjectName,
  onOpenObject,
  onOpenConsole,
  onOpenAuthWindow,
  onNotify,
  onRefreshMysqlObjectMetadata,
  onRefreshSourceWorkspace,
  onNotQueryableObjectClick,
  onFocusedSourceChange,
  onReady
}: QuerySourceTreeProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const nodeElementMapRef = useRef<Record<string, HTMLDivElement | null>>({});
  const [pendingScrollNodeId, setPendingScrollNodeId] = useState("");
  const [nodeContextMenu, setNodeContextMenu] = useState<{
    x: number;
    y: number;
    node: QueryTreeRenderNode;
    source: SalesforceSource;
    objectItem: SalesforceObject | null;
  } | null>(null);

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
    refreshSourceById,
    refreshObjectColumns,
    collapseSourceNodes,
    locateNodeByTarget: locateTreeNodeByTarget,
    searchFocusedSourceObjects,
    openObjectByTarget
  } = useSourceTreeState({
    sources,
    selectedSourceId,
    selectedSourceObjects: objects,
    selectedSourceObjectsLoading: objectsLoading,
    onOpenObject,
    onNotQueryableObjectClick,
    onFocusedSourceChange
  });

  const expandedNodeIdSet = useMemo(() => new Set(treeState.expandedNodeIds), [treeState.expandedNodeIds]);
  const sourceMap = useMemo(() => new Map(sources.map((source) => [source.id, source])), [sources]);

  const registerNodeElement = useCallback((nodeId: string, element: HTMLDivElement | null) => {
    nodeElementMapRef.current[nodeId] = element;
  }, []);

  // 全局关闭右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!nodeContextMenu) return;

    const closeMenu = () => setNodeContextMenu(null);
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeMenu();
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [nodeContextMenu]);

  // 节点定位滚动。
  useEffect(() => {
    if (!pendingScrollNodeId) return;

    const scrollToTargetNode = () => {
      const targetElement = nodeElementMapRef.current[pendingScrollNodeId];
      if (!targetElement) return;
      targetElement.scrollIntoView({
        block: "nearest",
        inline: "nearest"
      });
      setPendingScrollNodeId("");
    };

    const frameId = window.requestAnimationFrame(scrollToTargetNode);
    return () => window.cancelAnimationFrame(frameId);
  }, [pendingScrollNodeId, treeData, treeState.expandedNodeIds]);

  const resolveObjectItemFromNode = useCallback(
    (node: QueryTreeRenderNode): SalesforceObject | null => {
      if (node.kind !== "object") return null;
      const objectItems = treeState.sourceObjectsById[node.sourceId] || [];
      return objectItems.find((item) => item.name === node.objectName) || null;
    },
    [treeState.sourceObjectsById]
  );

  const locateNodeByTarget = useCallback(
    async (target: { sourceId: string; objectName?: string }) => {
      const locateResult = await locateTreeNodeByTarget(target);
      if (!locateResult) return;
      setPendingScrollNodeId(locateResult.targetNodeId);
    },
    [locateTreeNodeByTarget]
  );

  useEffect(() => {
    onReady?.({
      refreshFocusedSource: async () => {
        const focusedSourceId = treeState.focusedSourceId;
        await refreshFocusedSource();
        if (!focusedSourceId || !onRefreshSourceWorkspace) return;
        await onRefreshSourceWorkspace(focusedSourceId);
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

  // 构建对象 tooltip：通过驱动能力声明决定展示格式，禁止硬编码分支。
  const getObjectTooltip = useCallback(
    (node: QueryTreeRenderNode): string => {
      const objectItem = resolveObjectItemFromNode(node);
      if (!objectItem) return "";
      const driver = getDataSourceDriver(node.sourceType);
      if (driver.capabilities.supportsDdl) {
        return [`表名: ${objectItem.name}`, `注释: ${objectItem.comment?.trim() || "-"}`].join("\n");
      }
      return [
        `名称: ${objectItem.name}`,
        `标签: ${objectItem.label}`,
        `可查询: ${objectItem.queryable ? "是" : "否"}`,
        `可新增: ${objectItem.createable ? "是" : "否"}`,
        `可更新: ${objectItem.updateable ? "是" : "否"}`,
        `可删除: ${objectItem.deletable ? "是" : "否"}`
      ].join("\n");
    },
    [resolveObjectItemFromNode]
  );

  // 打开任意树节点的右键菜单。
  const handleNodeContextMenu = useCallback(
    (event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) => {
      event.preventDefault();
      event.stopPropagation();
      const source = sourceMap.get(node.sourceId);
      if (!source) return;
      const objectItem = resolveObjectItemFromNode(node);
      setNodeContextMenu({
        x: event.clientX,
        y: event.clientY,
        node,
        source,
        objectItem
      });
    },
    [resolveObjectItemFromNode, sourceMap]
  );

  // 构建四级右键上下文菜单项。
  const contextMenuEntries = useMemo<ContextMenuEntry[]>(() => {
    if (!nodeContextMenu) return [];
    return buildSourceTreeContextMenuEntries({
      node: nodeContextMenu.node,
      source: nodeContextMenu.source,
      objectItem: nodeContextMenu.objectItem,
      handlers: {
        onOpenObjectData: (source, objectItem) => {
          setNodeContextMenu(null);
          if (!objectItem.queryable) {
            onNotQueryableObjectClick?.(objectItem);
            return;
          }
          onOpenObject(objectItem, source);
        },
        onOpenConsole: (source, initialSql) => {
          setNodeContextMenu(null);
          onOpenConsole?.(source, initialSql);
        },
        onRefreshSource: (source) => {
          setNodeContextMenu(null);
          void (async () => {
            await refreshSourceById(source.id);
            if (onRefreshSourceWorkspace) {
              await onRefreshSourceWorkspace(source.id);
            }
            onNotify?.(`已刷新数据源 ${source.name}`, "success");
          })();
        },
        onTestSourceConnection: (source) => {
          setNodeContextMenu(null);
          void (async () => {
            try {
              const secret = await api.getSourceSecretView(source.id);
              const driver = getDataSourceDriver(source.sourceType);
              const hydrated = driver.hydrateSourceSecrets(source, secret);
              await api.testSourceConnection({
                name: hydrated.name,
                sourceType: hydrated.sourceType,
                configJson: hydrated.configJson,
                instanceUrl: hydrated.instanceUrl,
                accessToken: hydrated.accessToken || "",
                apiVersion: hydrated.apiVersion
              });
              onNotify?.(`数据源 ${source.name} 连接正常`, "success");
            } catch (error) {
              onNotify?.(`连接测试失败：${String(error)}`, "error");
            }
          })();
        },
        onCollapseSource: (sourceId) => {
          setNodeContextMenu(null);
          collapseSourceNodes(sourceId);
        },
        onOpenAuthWindow: () => {
          setNodeContextMenu(null);
          onOpenAuthWindow?.();
        },
        onRefreshObject: (source, objectName) => {
          setNodeContextMenu(null);
          void (async () => {
            try {
              await refreshObjectColumns(source.id, objectName);
              const driver = getDataSourceDriver(source.sourceType);
              if (driver.capabilities.supportsDdl) {
                await onRefreshMysqlObjectMetadata(objectName);
              }
              onNotify?.(`已刷新表 ${objectName} 结构`, "success");
            } catch (error) {
              onNotify?.(`刷新表结构失败：${String(error)}`, "error");
            }
          })();
        },
        onCopyText: (text, label) => {
          setNodeContextMenu(null);
          void navigator.clipboard.writeText(text).then(() => {
            onNotify?.(`已复制 ${label}`, "success");
          });
        },
        onCopyObjectDdl: (source, objectName) => {
          setNodeContextMenu(null);
          void (async () => {
            try {
              const ddl = await api.getObjectDdl(source.id, objectName);
              const text = ddl.createTableDdl || "";
              if (!text) {
                onNotify?.("未获取到建表 DDL", "error");
                return;
              }
              await navigator.clipboard.writeText(text);
              onNotify?.(`已复制 ${objectName} 建表 DDL`, "success");
            } catch (error) {
              onNotify?.(`获取 DDL 失败：${String(error)}`, "error");
            }
          })();
        },
        onOpenCloudListPage: (source, objectItem) => {
          setNodeContextMenu(null);
          if (!objectItem.queryable) {
            onNotQueryableObjectClick?.(objectItem);
            return;
          }
          void api.openObjectListPage(source.id, objectItem.name);
        },
        onOpenCloudEditPage: (source, objectItem) => {
          setNodeContextMenu(null);
          void api.openObjectEditPage(source.id, objectItem.name);
        }
      }
    });
  }, [
    nodeContextMenu,
    collapseSourceNodes,
    onNotQueryableObjectClick,
    onNotify,
    onOpenAuthWindow,
    onOpenConsole,
    onOpenObject,
    onRefreshMysqlObjectMetadata,
    onRefreshSourceWorkspace,
    refreshObjectColumns,
    refreshSourceById
  ]);

  if (sources.length === 0) {
    return (
      <div className="flex h-full items-center justify-center bg-white px-4 text-[12px] text-neutral/60">
        暂无数据源，点击上方“新增数据源”开始配置。
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-hidden bg-white">
      <div ref={containerRef} className="h-full w-full overflow-auto">
        <div className="min-h-full min-w-full w-max py-2">
          <QuerySourceTreeBranch
            nodes={treeData}
            level={0}
            expandedNodeIdSet={expandedNodeIdSet}
            sourceSurfaceBackgroundById={sourceSurfaceBackgroundById}
            treeState={treeState}
            activeTabObjectName={activeTabObjectName}
            onNodeClick={onNodeClick}
            onNodeDoubleClick={onNodeDoubleClick}
            onToggleNode={onToggleNode}
            onNodeContextMenu={handleNodeContextMenu}
            getObjectTooltip={getObjectTooltip}
            registerNodeElement={registerNodeElement}
          />
        </div>
      </div>

      {nodeContextMenu && (
        <ContextMenu x={nodeContextMenu.x} y={nodeContextMenu.y} entries={contextMenuEntries} />
      )}
    </div>
  );
}
