import { ChevronRight, Folder } from "lucide-react";
import type { NodeRendererProps } from "react-arborist";
import type { MouseEvent as ReactMouseEvent } from "react";
import { buildObjectTabBindingKey } from "../../../../types";
import { buildTreeNodeInteractionClassName } from "../logic/sourceTreeInteractions.ts";
import { resolveQueryTreeBadgeMeta, resolveQueryTreeVisualKind } from "../logic/queryTreeVisuals.ts";
import type { QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";
import type { SourceTreeState } from "../types/tree.ts";

type QuerySourceTreeNodeProps = NodeRendererProps<QueryTreeRenderNode> & {
  // 左树纯状态：用于渲染聚焦/刷新/错误态。
  treeState: SourceTreeState;
  // 当前激活对象 Tab 身份。
  activeTabObjectName: string;
  // 数据源颜色映射：用于让同一 source 的所有节点共享整块区域背景。
  sourceColorById: Record<string, string>;
  // 单击节点。
  onNodeClick: (node: QueryTreeRenderNode) => void;
  // 点击展开箭头。
  onToggleNode: (node: QueryTreeRenderNode) => void;
  // 右键 Object 节点。
  onObjectContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) => void;
  // 解析 Object 节点 tooltip。
  getObjectTooltip?: (node: QueryTreeRenderNode) => string;
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
  sourceColorById,
  onNodeClick,
  onToggleNode,
  onObjectContextMenu,
  getObjectTooltip
}: QuerySourceTreeNodeProps) {
  const data = node.data;
  const sourceId = data.sourceId;
  const isSourceNode = data.kind === "source";
  const isObjectNode = data.kind === "object";
  const objectBindingKey = isObjectNode ? buildObjectTabBindingKey(data.sourceId, data.objectName) : "";
  const isFocusedSource = isSourceNode && treeState.focusedSourceId === sourceId;
  const isActiveObject = isObjectNode && (activeTabObjectName === objectBindingKey || activeTabObjectName === data.objectName);
  const isSelectedNode = node.isSelected;
  const sourceLoading = Boolean(treeState.sourceLoadingById[sourceId] || treeState.sourceRefreshingById[sourceId]);
  const sourceAuthPending = Boolean(treeState.sourceAuthPendingById[sourceId]);
  const sourceError = treeState.sourceErrorById[sourceId] || "";
  const visualKind = resolveQueryTreeVisualKind(data);
  const badgeMeta = resolveQueryTreeBadgeMeta(visualKind);
  const showFolderIcon = data.expandable && !isSourceNode;
  const folderIconClassName = visualKind === "group-views" ? "text-violet-400" : "text-primary/75";
  // Object 节点 tooltip：恢复旧版“鼠标经过显示对象元数据”的能力。
  const objectTooltip = isObjectNode ? getObjectTooltip?.(data) || "" : "";
  // 节点行最小内容宽度：让超长名称真实撑开，交给父容器显示底部横向滚动条。
  const rowMinContentWidthClassName = isSourceNode && sourceAuthPending ? "min-w-[320px]" : "min-w-full";

  return (
    <>
      {/* 行容器：背景挂在带缩进 padding 的整行上，确保高亮铺满整行宽度而不是只包住内容区。 */}
      <div
        style={style}
        className={buildTreeNodeInteractionClassName({
          // 真实选中态优先用于整行浅蓝背景；兼容态仅保留正常文字强调。
          selected: isSelectedNode,
          active: isActiveObject || isFocusedSource
        })}
        title={objectTooltip || undefined}
        onClick={() => onNodeClick(data)}
        onContextMenu={(event) => {
          if (!isObjectNode || !onObjectContextMenu) return;
          onObjectContextMenu(event, data);
        }}
      >
        {/* 节点主体：统一收紧箭头、图标、文字的间距，避免当前树看起来松散又凌乱。 */}
        <div className={`flex min-h-[30px] w-max items-center gap-1.5 px-2 py-[3px] text-[12px] ${rowMinContentWidthClassName}`}>
          {/* 展开箭头：减弱存在感，只负责树结构层级提示。 */}
          <button
            type="button"
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${node.isLeaf ? "invisible" : "visible hover:bg-base-300/50"}`}
            onClick={(event) => {
              event.stopPropagation();
              onToggleNode(data); // 行内注释：仅切换当前节点展开态，不触发整行点击。
            }}
            aria-label={node.isOpen ? "折叠节点" : "展开节点"}
          >
            <ChevronRight size={12} className={`${node.isOpen ? "rotate-90" : ""} text-base-content/55 transition-transform`} />
          </button>

          {/* 主图标：可展开节点改为文件夹图标，保持树结构语义更直观。 */}
          <span className="flex h-[15px] w-[18px] shrink-0 items-center justify-center">
            {showFolderIcon ? (
              /* 文件夹图标：仅用于可展开节点，替代原来的文字徽标。 */
              <Folder size={15} className={folderIconClassName} aria-hidden="true" />
            ) : (
              /* 文字徽标：不可展开节点继续保留当前轻量视觉。 */
              <QueryTreeBadge text={badgeMeta.text} tone={badgeMeta.tone} />
            )}
          </span>

          {/* source 节点刷新时在名称前显示 loading，满足单源刷新反馈要求。 */}
          {isSourceNode && sourceLoading && <span className="loading loading-spinner shrink-0" style={{ width: 12, height: 12 }} />}

          {/* 名称主体：取消 truncate，让超长内容撑开整行并触发横向滚动。 */}
          <span className={`whitespace-nowrap leading-[1.35] ${isFocusedSource ? "font-semibold" : ""}`}>{data.label}</span>

          {/* 认证刷新提示：当前 source 正在自动刷新 token 时显示轻量文案。 */}
          {isSourceNode && sourceAuthPending && (
            <span className="shrink-0 rounded bg-warning/15 px-1.5 py-[2px] text-[10px] leading-[1] text-warning-content">
              认证中
            </span>
          )}

          {/* 不可查询 badge：沿用旧对象列表的中性灰提示语义。 */}
          {isObjectNode && !data.queryable && (
            <span className="shrink-0 rounded bg-base-300 px-1.5 py-[2px] text-[10px] leading-[1] text-base-content/80">不可查询</span>
          )}
        </div>
      </div>

      {/* source 错误提示：以轻量文本贴近节点，避免遮挡整个树。 */}
      {isSourceNode && sourceError && (
        <div style={style} className="px-7 pt-0.5 text-[11px] text-error">
          {sourceError}
        </div>
      )}
    </>
  );
}
