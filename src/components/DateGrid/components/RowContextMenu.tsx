import { RowContextMenuState } from "../types";

type RowContextMenuProps = {
  // 当前右键菜单状态。
  menuState: RowContextMenuState;
  // 复制单元格值。
  onCopyCell: () => void;
  // 设置单元格为空（None）。
  onSetNone: () => void;
  // 打开 Salesforce 记录页。
  onOpenRecordPage: () => void;
  // 当前上下文是否允许打开 Salesforce 记录页。
  canOpenRecordPage: boolean;
};

// 行右键菜单：统一封装复制、置空、打开记录页动作。
export function RowContextMenu({
  menuState,
  onCopyCell,
  onSetNone,
  onOpenRecordPage,
  canOpenRecordPage
}: RowContextMenuProps) {
  return (
    <div
      className="fixed z-[80] min-w-[164px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
      style={{ left: menuState.x, top: menuState.y }}
      onClick={(event) => event.stopPropagation()}
    >
      <button
        className="btn btn-ghost btn-xs w-full justify-start"
        onClick={() => {
          onCopyCell(); // 复制当前单元格数据并关闭菜单。
        }}
      >
        复制
      </button>
      {menuState.canSetNone && (
        <button
          className="btn btn-ghost btn-xs w-full justify-start"
          onClick={() => {
            onSetNone(); // 可空字段支持“一键置空”。
          }}
        >
          设置为 None
        </button>
      )}
      <button
        className="btn btn-ghost btn-xs w-full justify-start"
        disabled={!canOpenRecordPage}
        onClick={() => {
          onOpenRecordPage(); // 触发菜单动作并关闭菜单。
        }}
      >
        打开 Salesforce 记录页
      </button>
    </div>
  );
}
