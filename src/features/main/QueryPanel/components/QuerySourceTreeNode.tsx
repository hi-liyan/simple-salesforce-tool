import { ChevronRight, Database, FolderTree, Table2 } from "lucide-react";
import type { NodeRendererProps } from "react-arborist";
import { buildObjectTabBindingKey } from "../../../../types";
import type { SourceTreeState } from "../types/tree.ts";
import type { QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";

type QuerySourceTreeNodeProps = NodeRendererProps<QueryTreeRenderNode> & {
  // 左树纯状态：用于渲染聚焦/刷新/错误态。
  treeState: SourceTreeState;
  // 当前激活对象 Tab 身份。
  activeTabObjectName: string;
  // 单击节点。
  onNodeClick: (node: QueryTreeRenderNode) => void;
  // 双击节点。
  onNodeDoubleClick: (node: QueryTreeRenderNode) => void;
  // 点击展开箭头。
  onToggleNode: (node: QueryTreeRenderNode) => void;
};

// 树节点渲染器：统一封装 source/group/object 三类视觉与交互。
export function QuerySourceTreeNode({
  node,
  style,
  treeState,
  activeTabObjectName,
  onNodeClick,
  onNodeDoubleClick,
  onToggleNode
}: QuerySourceTreeNodeProps) {
  const data = node.data;
  const sourceId = data.sourceId;
  const isSourceNode = data.kind === "source";
  const isGroupNode = data.kind === "group";
  const isObjectNode = data.kind === "object";
  const objectBindingKey = isObjectNode ? buildObjectTabBindingKey(data.sourceId, data.objectName) : "";
  const isFocusedSource = isSourceNode && treeState.focusedSourceId === sourceId;
  const isActiveObject = isObjectNode && (activeTabObjectName === objectBindingKey || activeTabObjectName === data.objectName);
  const sourceLoading = Boolean(treeState.sourceLoadingById[sourceId] || treeState.sourceRefreshingById[sourceId]);
  const sourceError = treeState.sourceErrorById[sourceId] || "";

  return (
    <div style={style} className="px-2">
      {/* 节点主体：单击仅聚焦，双击按节点类型执行展开或打开。 */}
      <div
        className={`group flex h-[28px] items-center gap-1 rounded px-2 text-[12px] ${
          isActiveObject || isFocusedSource ? "bg-base-200 text-base-content" : "text-base-content/80 hover:bg-base-200/70"
        }`}
        onClick={() => onNodeClick(data)}
        onDoubleClick={() => onNodeDoubleClick(data)}
      >
        {/* 展开箭头：仅 source/group 可展开。 */}
        <button
          type="button"
          className={`flex h-4 w-4 items-center justify-center rounded ${node.isLeaf ? "invisible" : "visible hover:bg-base-300/60"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleNode(data);
          }}
          aria-label={node.isOpen ? "折叠节点" : "展开节点"}
        >
          <ChevronRight size={12} className={`${node.isOpen ? "rotate-90" : ""} transition-transform`} />
        </button>

        {/* 节点图标：source/group/object 各自保持不同语义。 */}
        <span className="flex h-4 w-4 items-center justify-center">
          {isSourceNode ? (
            <Database size={13} style={{ color: data.sourceColor || undefined }} />
          ) : isGroupNode ? (
            <FolderTree size={13} />
          ) : (
            <Table2 size={13} />
          )}
        </span>

        {/* source 节点刷新时在名称前显示 loading，满足单源刷新反馈要求。 */}
        {isSourceNode && sourceLoading && <span className="loading loading-spinner" style={{ width: 12, height: 12 }} />}

        {/* source 颜色点：仅在用户手动配置颜色时显示。 */}
        {isSourceNode && data.sourceColor && (
          <span
            className="h-2 w-2 rounded-full"
            style={{ backgroundColor: data.sourceColor }}
            aria-hidden="true"
          />
        )}

        {/* 名称主体。 */}
        <span className="min-w-0 flex-1 truncate">{data.label}</span>

        {/* 不可查询对象提示：避免双击后无反馈。 */}
        {isObjectNode && !data.queryable && <span className="rounded bg-warning/15 px-1 text-[10px] text-warning-content">只读</span>}
      </div>

      {/* source 错误提示：以轻量文本贴近节点，避免遮挡整个树。 */}
      {isSourceNode && sourceError && (
        <div className="px-7 pt-0.5 text-[11px] text-error">
          {sourceError}
        </div>
      )}
    </div>
  );
}
