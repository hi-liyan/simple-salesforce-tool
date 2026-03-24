import { useEffect, useRef, useState } from "react";
import { Tree } from "react-arborist";
import type { SalesforceObject, SalesforceSource } from "../../../../types";
import { useSourceTreeState } from "../hooks/useSourceTreeState.ts";
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
  // 不可查询对象提示。
  onNotQueryableObjectClick?: (item: SalesforceObject) => void;
  // 对外暴露刷新聚焦数据源能力。
  onReady?: (actions: { refreshFocusedSource: () => Promise<void>; getFocusedSourceId: () => string }) => void;
};

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
      <div className="flex h-full items-center justify-center px-4 text-[12px] text-neutral/60">
        暂无数据源，点击上方“新增数据源”开始配置。
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <Tree
        data={treeData}
        width="100%"
        height={treeHeight}
        rowHeight={36}
        indent={18}
        paddingTop={8}
        paddingBottom={8}
        openByDefault={false}
        disableDrag
        selection={selectionId}
        childrenAccessor="children"
        idAccessor="id"
      >
        {(props) => (
          <QuerySourceTreeNode
            {...props}
            treeState={treeState}
            activeTabObjectName={activeTabObjectName}
            onNodeClick={(node) => void onNodeClick(node, props.node)}
            onToggleNode={(node) => void onToggleNode(node, props.node)}
          />
        )}
      </Tree>
    </div>
  );
}
