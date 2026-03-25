import { LucideIcon } from "lucide-react";

// 左侧动作项定义：通过配置驱动按钮渲染，便于后续扩展更多动作。
export type QuerySidebarActionItem = {
  // 动作唯一标识。
  id: string;
  // 动作图标组件。
  icon: LucideIcon;
  // 无障碍标签。
  ariaLabel: string;
  // 当前动作是否禁用。
  disabled?: boolean;
  // 点击事件。
  onClick: () => void;
};

type QuerySidebarActionsProps = {
  // 动作项列表。
  actions: QuerySidebarActionItem[];
  // 全局禁用状态。
  disabled?: boolean;
};

// 左侧动作区组件：统一渲染 Icon 按钮，减少侧边栏模板重复。
export function QuerySidebarActions({ actions, disabled = false }: QuerySidebarActionsProps) {
  return (
    // 动作区容器：右对齐展示紧凑按钮组。
    <div className="flex items-center justify-end gap-1">
      {actions.map((action) => {
        const Icon = action.icon;
        const actionDisabled = disabled || Boolean(action.disabled);
        return (
          // 单个动作按钮：保留统一尺寸与视觉样式。
          <button
            key={action.id}
            className="btn btn-ghost btn-square btn-sm"
            aria-label={action.ariaLabel}
            title={action.ariaLabel}
            onClick={() => {
              if (actionDisabled) return;
              action.onClick(); // 统一由配置项回调处理具体动作。
            }}
            disabled={actionDisabled}
          >
            {/* 动作图标。 */}
            <Icon size={14} />
          </button>
        );
      })}
    </div>
  );
}
