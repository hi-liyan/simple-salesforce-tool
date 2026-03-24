import { useEffect, useMemo, useRef, useState } from "react";
import { Tree } from "react-arborist";
import type { RowRendererProps } from "react-arborist";
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
  onNotQueryableObjectClick,
  onReady
}: QuerySourceTreeProps) {
  // 容器尺寸：react-arborist 需要明确高度。
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [treeHeight, setTreeHeight] = useState(360);
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
          />
        )}
      </Tree>
    </div>
  );
}
