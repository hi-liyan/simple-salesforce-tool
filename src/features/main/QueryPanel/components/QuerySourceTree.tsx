import { useEffect, useMemo, useRef, useState } from "react";
import type { MouseEvent as ReactMouseEvent } from "react";
import { Tree } from "react-arborist";
import type { RowRendererProps } from "react-arborist";
import { api } from "../../../../api";
import { ContextMenu, type ContextMenuEntry } from "../../../../components/ContextMenu";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import { useSourceTreeState } from "../hooks/useSourceTreeState.ts";
import { buildSourceSurfacePalette, getSourceColor } from "../logic/sourceColor.ts";
import { buildInitialOpenState } from "../logic/sourceTreePersistence.ts";
import { QuerySourceTreeNode } from "./QuerySourceTreeNode";
import type { QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";

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
  // 不可查询对象提示。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 对外暴露刷新聚焦数据源能力。
  onReady?: (actions: { refreshFocusedSource: () => Promise<void>; getFocusedSourceId: () => string }) => void;
};

type QuerySourceTreeRowProps = RowRendererProps<QueryTreeRenderNode> & {
  // 数据源浅色背景映射：用于把同一 source 的整块区域着色为连续背景。
  sourceSurfaceBackgroundById: Record<string, string>;
};

// 树行容器：背景画在 row 层，而不是节点内容层，这样视觉上是一整块连续区域。
function QuerySourceTreeRow({ node, innerRef, attrs, children, sourceSurfaceBackgroundById }: QuerySourceTreeRowProps) {
  const sourceId = String(node.data?.sourceId || "");
  const rowBackgroundColor = sourceSurfaceBackgroundById[sourceId] || "";

  return (
    <div
      ref={innerRef}
      {...attrs}
      style={{
        ...(attrs.style || {}),
        backgroundColor: rowBackgroundColor || undefined
      }}
    >
      {children}
    </div>
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
  onNotQueryableObjectClick,
  onReady
}: QuerySourceTreeProps) {
  // 容器尺寸：react-arborist 需要明确高度。
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [treeHeight, setTreeHeight] = useState(360);
  // Object 右键菜单状态：记录菜单位置与目标对象。
  const [objectContextMenu, setObjectContextMenu] = useState<{
    x: number;
    y: number;
    objectItem: SalesforceObject;
    source: SalesforceSource;
  } | null>(null);
  // 数据源颜色映射：供节点内部读取来源色（例如 source 根节点色点）。
  const sourceColorById = useMemo(
    () =>
      sources.reduce<Record<string, string>>((acc, source) => {
        acc[source.id] = getSourceColor(source);
        return acc;
      }, {}),
    [sources]
  );
  // 数据源浅色背景映射：供 row 层形成连续的背景区块。
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
    selectionId,
    onNodeClick,
    onToggleNode,
    refreshFocusedSource
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
  // 树首次挂载时的展开映射：配合持久化状态恢复 source/group 展开态。
  const initialOpenState = useMemo(() => buildInitialOpenState(treeState.expandedNodeIds), [treeState.expandedNodeIds]);

  // 将刷新动作回传给侧边栏顶部按钮，避免继续走“全量刷新 source 列表”旧逻辑。
  useEffect(() => {
    onReady?.({
      refreshFocusedSource,
      getFocusedSourceId: () => treeState.focusedSourceId
    });
  }, [onReady, refreshFocusedSource, treeState.focusedSourceId]);

  // 监听容器尺寸变化，保持树高度自适应。
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const updateHeight = () => {
      setTreeHeight(Math.max(240, Math.floor(element.clientHeight || 360)));
    };
    updateHeight();

    const observer = new ResizeObserver(() => {
      updateHeight();
    });
    observer.observe(element);
    return () => observer.disconnect();
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

  // 从树节点解析完整对象信息：恢复旧版 tooltip/右键菜单依赖的对象元数据。
  function resolveObjectItemFromNode(node: QueryTreeRenderNode): SalesforceObject | null {
    if (node.kind !== "object") return null;
    const objectItems = treeState.sourceObjectsById[node.sourceId] || [];
    return objectItems.find((item) => item.name === node.objectName) || null;
  }

  // 构建 Salesforce Object tooltip：鼠标经过时展示对象元数据摘要。
  function getObjectTooltip(node: QueryTreeRenderNode): string {
    const objectItem = resolveObjectItemFromNode(node);
    if (!objectItem) return "";
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
    <div ref={containerRef} className="h-full w-full bg-white">
      <Tree
        data={treeData}
        width="100%"
        height={treeHeight}
        rowHeight={36}
        indent={18}
        paddingTop={8}
        paddingBottom={8}
        openByDefault={false}
        initialOpenState={initialOpenState}
        disableDrag
        selection={selectionId}
        childrenAccessor="children"
        idAccessor="id"
        renderRow={(props) => (
          <QuerySourceTreeRow
            {...props}
            sourceSurfaceBackgroundById={sourceSurfaceBackgroundById}
          />
        )}
      >
        {(props) => (
          <QuerySourceTreeNode
            {...props}
            treeState={treeState}
            activeTabObjectName={activeTabObjectName}
            sourceColorById={sourceColorById}
            onNodeClick={(node) => void onNodeClick(node, props.node)}
            onToggleNode={(node) => void onToggleNode(node, props.node)}
            onObjectContextMenu={handleObjectContextMenu}
            getObjectTooltip={getObjectTooltip}
          />
        )}
      </Tree>
      {/* Object 右键菜单：复用公共菜单容器，具体动作仍由树组件自己定义。 */}
      {objectContextMenu && (
        <ContextMenu x={objectContextMenu.x} y={objectContextMenu.y} entries={objectContextMenuEntries} />
      )}
    </div>
  );
}
