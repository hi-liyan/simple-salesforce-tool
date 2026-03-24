type ContextMenuItem = {
  // 菜单项唯一标识：用于稳定渲染列表。
  id: string;
  // 菜单项文案。
  label: string;
  // 点击菜单项回调。
  onClick: () => void;
  // 是否禁用当前菜单项。
  disabled?: boolean;
};

type ContextMenuSeparator = {
  // 分隔线唯一标识：用于稳定渲染列表。
  id: string;
  // 分隔项类型。
  type: "separator";
};

export type ContextMenuEntry = ContextMenuItem | ContextMenuSeparator;

type ContextMenuProps = {
  // 当前右键菜单左上角横坐标。
  x: number;
  // 当前右键菜单左上角纵坐标。
  y: number;
  // 菜单项列表：支持普通按钮和分隔线。
  entries: ContextMenuEntry[];
  // 菜单最小宽度 className：默认与 DataGrid 保持一致。
  minWidthClassName?: string;
};

// 判断当前菜单项是否为分隔线：用于帮助 TypeScript 正确收窄联合类型。
function isContextMenuSeparator(entry: ContextMenuEntry): entry is ContextMenuSeparator {
  return "type" in entry && entry.type === "separator";
}

// 通用右键菜单：统一封装固定定位、最小宽度、分隔线和按钮样式。
export function ContextMenu({
  x,
  y,
  entries,
  minWidthClassName = "min-w-[164px]"
}: ContextMenuProps) {
  return (
    /* 右键菜单容器：复用各处统一的浮层视觉与定位方式。 */
    <div
      className={`fixed z-[80] flex flex-col rounded border border-base-300 bg-base-100 p-1 shadow-xl ${minWidthClassName}`}
      style={{ left: x, top: y }}
      onClick={(event) => event.stopPropagation()}
    >
      {entries.map((entry) => {
        if (isContextMenuSeparator(entry)) {
          return (
            /* 分隔线：用于在动作分组之间提供视觉断点。 */
            <div key={entry.id} className="my-1 border-t border-base-300" />
          );
        }

        return (
          /* 菜单按钮：保持各业务菜单统一的 hover / disabled 样式。 */
          <button
            key={entry.id}
            className="btn btn-ghost btn-xs w-full justify-start whitespace-nowrap px-2"
            disabled={entry.disabled}
            onClick={() => {
              entry.onClick(); // 行内注释：由各业务方自行处理关闭菜单与后续动作。
            }}
          >
            {entry.label}
          </button>
        );
      })}
    </div>
  );
}
