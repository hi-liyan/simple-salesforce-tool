import { ContextMenu, type ContextMenuEntry } from "../../ContextMenu";
import { RowContextMenuState } from "../types";

type RowContextMenuProps = {
  // 当前右键菜单状态。
  menuState: RowContextMenuState;
  // 复制单元格值。
  onCopyCell: () => void;
  // 设置单元格为空（None/Null）。
  onSetNullish: () => void;
  // 打开 Salesforce 记录页。
  onOpenRecordPage: () => void;
  // 当前上下文是否允许打开 Salesforce 记录页。
  canOpenRecordPage: boolean;
  // 是否显示“打开 Salesforce 记录页”菜单项。
  showOpenRecordPage: boolean;
};

// 行右键菜单：统一封装复制、置空、打开记录页动作。
export function RowContextMenu({
  menuState,
  onCopyCell,
  onSetNullish,
  onOpenRecordPage,
  canOpenRecordPage,
  showOpenRecordPage
}: RowContextMenuProps) {
  // 菜单项列表：仅复用展示容器，动作仍由 DataGrid 自己提供。
  const entries: ContextMenuEntry[] = [
    {
      id: "copy-cell",
      label: "复制",
      onClick: () => {
        onCopyCell(); // 复制当前单元格数据并关闭菜单。
      }
    },
    ...(menuState.canSetNullish
      ? [{
          id: "set-nullish",
          label: menuState.nullishActionLabel,
          onClick: () => {
            onSetNullish(); // 可空字段支持“一键置空”。
          }
        } satisfies ContextMenuEntry]
      : []),
    ...(showOpenRecordPage
      ? [{
          id: "open-record-page",
          label: "打开 Salesforce 记录页",
          disabled: !canOpenRecordPage,
          onClick: () => {
            onOpenRecordPage(); // 触发菜单动作并关闭菜单。
          }
        } satisfies ContextMenuEntry]
      : [])
  ];

  return (
    /* DataGrid 行右键菜单：复用公共菜单容器，保留自身动作逻辑。 */
    <ContextMenu x={menuState.x} y={menuState.y} entries={entries} />
  );
}
