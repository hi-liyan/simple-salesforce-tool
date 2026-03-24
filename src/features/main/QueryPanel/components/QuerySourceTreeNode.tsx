import { ChevronRight } from "lucide-react";
import type { NodeRendererProps } from "react-arborist";
import { buildObjectTabBindingKey } from "../../../../types";
import { resolveQueryTreeBadgeMeta, resolveQueryTreeVisualKind } from "../logic/queryTreeVisuals.ts";
import type { QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";
import type { SourceTreeState } from "../types/tree.ts";

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

// 文字小徽标：把树节点前缀收敛成紧凑的字母标签，避免大量图形图标造成视觉噪音。
function QueryTreeBadge({ text, tone }: { text: string; tone: "neutral" | "blue" | "green" | "amber" | "orange" | "gray" | "muted" }) {
  const toneClassMap = {
    neutral: "border-base-300 bg-base-200 text-base-content/60",
    blue: "border-sky-200 bg-sky-50 text-sky-700",
    green: "border-lime-200 bg-lime-50 text-lime-700",
    amber: "border-amber-200 bg-amber-50 text-amber-700",
    orange: "border-orange-200 bg-orange-50 text-orange-700",
    gray: "border-slate-200 bg-slate-100 text-slate-500",
    muted: "border-transparent bg-base-300 text-base-content/75"
  } as const;

  return (
    <span
      className={`inline-flex h-[15px] min-w-[15px] items-center justify-center rounded border px-[3px] font-mono text-[8px] font-semibold leading-[1] ${toneClassMap[tone]}`}
      aria-hidden="true"
    >
      {text}
    </span>
  );
}

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
  const isObjectNode = data.kind === "object";
  const objectBindingKey = isObjectNode ? buildObjectTabBindingKey(data.sourceId, data.objectName) : "";
  const isFocusedSource = isSourceNode && treeState.focusedSourceId === sourceId;
  const isActiveObject = isObjectNode && (activeTabObjectName === objectBindingKey || activeTabObjectName === data.objectName);
  const sourceLoading = Boolean(treeState.sourceLoadingById[sourceId] || treeState.sourceRefreshingById[sourceId]);
  const sourceAuthPending = Boolean(treeState.sourceAuthPendingById[sourceId]);
  const sourceError = treeState.sourceErrorById[sourceId] || "";
  const visualKind = resolveQueryTreeVisualKind(data);
  const badgeMeta = resolveQueryTreeBadgeMeta(visualKind);

  return (
    <div style={style} className="px-2">
      {/* 节点主体：统一收紧箭头、图标、文字的间距，避免当前树看起来松散又凌乱。 */}
      <div
        className={`group flex min-h-[30px] items-center gap-1.5 rounded px-2 py-[3px] text-[12px] ${
          isActiveObject || isFocusedSource ? "bg-base-200 text-base-content" : "text-base-content/80 hover:bg-base-200/70"
        }`}
        onClick={() => onNodeClick(data)}
        onDoubleClick={() => onNodeDoubleClick(data)}
      >
        {/* 展开箭头：减弱存在感，只负责树结构层级提示。 */}
        <button
          type="button"
          className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${node.isLeaf ? "invisible" : "visible hover:bg-base-300/50"}`}
          onClick={(event) => {
            event.stopPropagation();
            onToggleNode(data);
          }}
          aria-label={node.isOpen ? "折叠节点" : "展开节点"}
        >
          <ChevronRight size={12} className={`${node.isOpen ? "rotate-90" : ""} text-base-content/55 transition-transform`} />
        </button>

        {/* 主徽标：统一缩成非常轻量的文字 badge，减少整棵树的视觉噪音。 */}
        <span className="flex h-[15px] w-[18px] shrink-0 items-center justify-center">
          <QueryTreeBadge text={badgeMeta.text} tone={badgeMeta.tone} />
        </span>

        {/* source 节点刷新时在名称前显示 loading，满足单源刷新反馈要求。 */}
        {isSourceNode && sourceLoading && <span className="loading loading-spinner shrink-0" style={{ width: 12, height: 12 }} />}

        {/* source 颜色点：仅保留为很轻的辅助信息，不再让主图标承担颜色识别。 */}
        {isSourceNode && data.sourceColor && (
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: data.sourceColor }}
            aria-hidden="true"
          />
        )}

        {/* 名称主体。 */}
        <span className="min-w-0 flex-1 truncate leading-[1.35]">{data.label}</span>

        {/* 认证刷新提示：当前 source 正在自动刷新 token 时显示轻量文案。 */}
        {isSourceNode && sourceAuthPending && (
          <span className="rounded bg-warning/15 px-1.5 py-[2px] text-[10px] leading-[1] text-warning-content">
            认证中
          </span>
        )}

        {/* 不可查询 badge：沿用旧对象列表的中性灰提示语义。 */}
        {isObjectNode && !data.queryable && (
          <span className="rounded bg-base-300 px-1.5 py-[2px] text-[10px] leading-[1] text-base-content/80">不可查询</span>
        )}
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
