import { AlertCircle, ChevronRight, Folder } from "lucide-react";
import { useState, type MouseEvent as ReactMouseEvent } from "react";
import { createPortal } from "react-dom";
import { buildObjectTabBindingKey } from "../../../../types";
import { buildQuerySourceErrorPresentation } from "../logic/sourceTreeErrorPresentation.ts";
import { buildTreeNodeInteractionClassName } from "../logic/sourceTreeInteractions.ts";
import { resolveQueryTreeBadgeMeta, resolveQueryTreeVisualKind } from "../logic/queryTreeVisuals.ts";
import type { QueryTreeRenderNode } from "../hooks/useSourceTreeState.ts";
import type { SourceTreeState } from "../types/tree.ts";

type QuerySourceTreeNodeProps = {
  // 当前树节点。
  node: QueryTreeRenderNode;
  // 当前节点层级：用于按树结构缩进显示。
  level: number;
  // 当前节点是否处于展开态。
  isOpen: boolean;
  // 当前节点所在来源区域背景色。
  rowBackgroundColor: string;
  // 左树纯状态：用于渲染聚焦、刷新和错误态。
  treeState: SourceTreeState;
  // 当前激活对象 Tab 身份。
  activeTabObjectName: string;
  // 单击节点。
  onNodeClick: (node: QueryTreeRenderNode) => void;
  // 双击节点。
  onNodeDoubleClick: (node: QueryTreeRenderNode) => void;
  // 点击展开箭头。
  onToggleNode: (node: QueryTreeRenderNode) => void;
  // 右键 Object 节点。
  onObjectContextMenu?: (event: ReactMouseEvent<HTMLDivElement>, node: QueryTreeRenderNode) => void;
  // 解析 Object 节点 tooltip。
  getObjectTooltip?: (node: QueryTreeRenderNode) => string;
  // 注册节点 DOM：供父组件执行滚动定位。
  registerNodeElement?: (nodeId: string, element: HTMLDivElement | null) => void;
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

// 左侧树节点渲染器：使用受控 DOM 树渲染，保留当前视觉与交互语义。
export function QuerySourceTreeNode({
  node,
  level,
  isOpen,
  rowBackgroundColor,
  treeState,
  activeTabObjectName,
  onNodeClick,
  onNodeDoubleClick,
  onToggleNode,
  onObjectContextMenu,
  getObjectTooltip,
  registerNodeElement
}: QuerySourceTreeNodeProps) {
  // 错误浮层坐标：固定锚定到红色叹号左下方，避免手动推算居中带来的偏移误差。
  const [errorTooltipPosition, setErrorTooltipPosition] = useState<{ left: number; top: number } | null>(null);
  const data = node;
  const sourceId = data.sourceId;
  const isSourceNode = data.kind === "source";
  const isObjectNode = data.kind === "object";
  const objectBindingKey = isObjectNode ? buildObjectTabBindingKey(data.sourceId, data.objectName) : "";
  const isFocusedSource = isSourceNode && treeState.focusedSourceId === sourceId;
  const isActiveObject = isObjectNode && (activeTabObjectName === objectBindingKey || activeTabObjectName === data.objectName);
  const isSelectedNode = treeState.selectedNodeId === data.id;
  const sourceLoading = Boolean(treeState.sourceLoadingById[sourceId] || treeState.sourceRefreshingById[sourceId]);
  const sourceAuthPending = Boolean(treeState.sourceAuthPendingById[sourceId]);
  const sourceError = treeState.sourceErrorById[sourceId] || "";
  const sourceErrorPresentation = buildQuerySourceErrorPresentation(sourceError);
  const sourceHasVisibleError = isSourceNode && !sourceLoading && Boolean(sourceError);
  const visualKind = resolveQueryTreeVisualKind(data);
  const badgeMeta = resolveQueryTreeBadgeMeta(visualKind);
  const showFolderIcon = data.expandable && !isSourceNode;
  const folderIconClassName = visualKind === "group-views" ? "text-violet-400" : "text-primary/75";
  // Object 节点 tooltip：恢复旧版“鼠标经过显示对象元数据”的能力。
  const objectTooltip = isObjectNode ? getObjectTooltip?.(data) || "" : "";
  // 节点行最小内容宽度：让超长名称真实撑开，交给父容器显示底部横向滚动条。
  const rowMinContentWidthClassName = isSourceNode && sourceAuthPending ? "min-w-[320px]" : "min-w-full";

  return (
    // 节点外层：独立承接滚动定位 ref，并在同一数据源区域内维持连续背景色。
    <div
      ref={(element) => {
        registerNodeElement?.(data.id, element);
      }}
      className="min-w-full"
      style={{ backgroundColor: rowBackgroundColor || undefined }}
    >
      {/* 行容器：按层级缩进，并统一承接单击、双击与右键菜单。 */}
      <div
        style={{ paddingLeft: level * 18 }}
        className={buildTreeNodeInteractionClassName({
          // 真实选中态优先用于整行浅蓝背景；兼容态仅保留正常文字强调。
          selected: isSelectedNode,
          active: isActiveObject || isFocusedSource
        })}
        title={objectTooltip || undefined}
        onClick={() => {
          onNodeClick(data); // 行内注释：单击仅处理高亮与聚焦，不自动展开节点。
        }}
        onDoubleClick={(event) => {
          event.stopPropagation(); // 行内注释：双击只在当前节点内消费，避免外层容器收到重复事件。
          void onNodeDoubleClick(data);
        }}
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
            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded ${!data.expandable ? "invisible" : "visible hover:bg-base-300/50"}`}
            onClick={(event) => {
              event.stopPropagation();
              void onToggleNode(data); // 行内注释：仅切换当前节点展开态，不触发行点击。
            }}
            aria-label={isOpen ? "折叠节点" : "展开节点"}
          >
            <ChevronRight size={12} className={`${isOpen ? "rotate-90" : ""} text-base-content/55 transition-transform`} />
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

          {/* source 状态位：优先显示 loading；无 loading 且最终失败时显示红色叹号。 */}
          {isSourceNode && sourceLoading && <span className="loading loading-spinner shrink-0" style={{ width: 12, height: 12 }} />}
          {sourceHasVisibleError && !sourceLoading && (
            <span
              className="relative inline-flex shrink-0"
              onMouseEnter={(event) => {
                const iconRect = event.currentTarget.getBoundingClientRect();
                setErrorTooltipPosition({
                  left: Math.min(Math.max(12, iconRect.left), Math.max(12, window.innerWidth - 272)),
                  top: Math.min(Math.max(12, iconRect.bottom + 8), Math.max(12, window.innerHeight - 84))
                }); // 行内注释：错误卡片直接锚定叹号左下角，避免再做宽度居中计算。
              }}
              onMouseMove={(event) => {
                const iconRect = event.currentTarget.getBoundingClientRect();
                setErrorTooltipPosition({
                  left: Math.min(Math.max(12, iconRect.left), Math.max(12, window.innerWidth - 272)),
                  top: Math.min(Math.max(12, iconRect.bottom + 8), Math.max(12, window.innerHeight - 84))
                }); // 行内注释：滚动树或窗口变化时，持续按叹号真实位置校正浮层。
              }}
              onMouseLeave={() => {
                setErrorTooltipPosition(null); // 行内注释：移出叹号后立即关闭错误浮层。
              }}
            >
              <span
                className="inline-flex h-4 w-4 items-center justify-center rounded-full text-error"
                aria-label={sourceErrorPresentation.title}
              >
                {/* 红色叹号图标：放在数据源名称前，复用原 loading 的视觉位置。 */}
                <AlertCircle size={14} aria-hidden="true" />
              </span>

              {/* 错误悬浮卡片：固定显示在叹号下方，并提升层级避免被侧边 panel tabs 遮挡。 */}
              {errorTooltipPosition && (
                createPortal(
                  <span
                    className="pointer-events-none fixed z-[140] w-[260px]"
                    style={{
                      left: errorTooltipPosition.left,
                      top: errorTooltipPosition.top
                    }}
                  >
                    <span className="block rounded-md border border-[#f3c2c2] bg-[#fff6f6] px-2 py-1.5 text-left text-[#8b2a2a] shadow-md">
                      {/* 错误标题：沿用之前的摘要标题，帮助用户快速理解失败类型。 */}
                      <span className="block text-[11px] font-semibold leading-[1.3]">{sourceErrorPresentation.title}</span>
                      {/* 错误说明：保持短说明风格，避免把树节点 hover 做成日志面板。 */}
                      <span className="mt-0.5 block break-words text-[11px] leading-[1.4] text-[#a54848]">
                        {sourceErrorPresentation.detail}
                      </span>
                    </span>
                  </span>,
                  document.body
                )
              )}
            </span>
          )}

          {/* 名称主体：错误时切换为红色，恢复成功后自动回到默认样式。 */}
          <span
            className={`whitespace-nowrap leading-[1.35] ${isFocusedSource ? "font-semibold" : ""} ${sourceHasVisibleError ? "text-error" : ""}`}
          >
            {data.label}
          </span>

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
    </div>
  );
}
