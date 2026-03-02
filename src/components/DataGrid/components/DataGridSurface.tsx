import React from "react";
import { DataEditor, EditableGridCell, EditListItem, GridCell, GridColumn, Item } from "@glideapps/glide-data-grid";
import { HeaderMetaPopover } from "./HeaderMetaPopover";
import { RowContextMenu } from "./RowContextMenu";
import { isCellEditableByMeta } from "../utils/field";
import { stringifyCellValue } from "../utils/value";
import { RowContextMenuState, HoveredHeaderMetaState } from "../types";
import { isHeaderInfoIconHit } from "../renderers/drawHeader";
import { buildDisplayMetadataFromRaw } from "../../../utils/fieldMetadata";

type DataGridSurfaceProps = {
  // 查询总数（展示在工具栏）。
  totalSize: number;
  // 当前行数据。
  records: Record<string, unknown>[];
  // 表格列定义。
  columns: GridColumn[];
  // 字段元数据映射。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 已选中记录 Id。
  selectedRecordIds: string[];
  // 是否展示表头元数据 icon。
  showHeaderMetadata: boolean;
  // 全选态。
  allChecked: boolean;
  // 半选态。
  hasAnyChecked: boolean;
  // 可选中记录 Id 列表。
  selectableIds: string[];
  // 表格主体容器 ref。
  gridBodyRef: React.MutableRefObject<HTMLDivElement | null>;
  // 当前右键菜单状态。
  rowContextMenu: RowContextMenuState | null;
  // 当前表头浮层状态。
  hoveredHeaderMeta: HoveredHeaderMetaState | null;
  // 浮层 hover 态。
  metaPanelHovering: boolean;
  // 取消延迟关闭浮层。
  cancelMetaClose: () => void;
  // 延迟关闭浮层。
  scheduleMetaClose: () => void;
  // 设置浮层 hover 态。
  setMetaPanelHovering: (next: boolean) => void;
  // 设置右键菜单状态。
  setRowContextMenu: (next: RowContextMenuState | null) => void;
  // 设置表头浮层状态。
  setHoveredHeaderMeta: (next: HoveredHeaderMetaState | null) => void;
  // 列宽写入函数。
  setColumnWidths: React.Dispatch<React.SetStateAction<Record<string, number>>>;
  // 激活单元格 ref：供编辑器分发读取。
  activeEditorCellRef: React.MutableRefObject<Item | null>;
  // 激活单元格状态写入。
  setActiveEditorCell: (cell: Item | null) => void;
  // 是否允许打开 Salesforce 记录页。
  canOpenRecordPage: boolean;
  // 表头点击回调。
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  // 右键菜单动作：复制。
  onCopyCell: () => void;
  // 右键菜单动作：置空。
  onSetNone: () => void;
  // 右键菜单动作：打开记录页。
  onOpenRecordPage: () => void;
  // 单元格读取函数。
  getCellContent: (cell: Item) => GridCell;
  // 单元格编辑回调。
  onCellEdited: (location: Item, value: EditableGridCell) => void;
  // 单元格点击回调。
  onCellClicked: React.ComponentProps<typeof DataEditor>["onCellClicked"];
  // 批量编辑回调。
  onCellsEdited: (newValues: readonly EditListItem[]) => void;
  // 编辑器分发回调。
  provideEditor: NonNullable<React.ComponentProps<typeof DataEditor>["provideEditor"]>;
  // 表头绘制回调。
  drawHeader: NonNullable<React.ComponentProps<typeof DataEditor>["drawHeader"]>;
};

// DataGrid 渲染层：仅负责 DataEditor 与浮层/菜单的 UI 组装。
export function DataGridSurface({
  totalSize,
  records,
  columns,
  fieldMetadataMap,
  selectedRecordIds,
  showHeaderMetadata,
  allChecked,
  hasAnyChecked,
  selectableIds,
  gridBodyRef,
  rowContextMenu,
  hoveredHeaderMeta,
  metaPanelHovering,
  cancelMetaClose,
  scheduleMetaClose,
  setMetaPanelHovering,
  setRowContextMenu,
  setHoveredHeaderMeta,
  setColumnWidths,
  activeEditorCellRef,
  setActiveEditorCell,
  canOpenRecordPage,
  onToggleAll,
  onCopyCell,
  onSetNone,
  onOpenRecordPage,
  getCellContent,
  onCellEdited,
  onCellClicked,
  onCellsEdited,
  provideEditor,
  drawHeader
}: DataGridSurfaceProps) {
  return (
    // 表格容器：顶部统计栏 + 数据表格。
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 顶部工具栏：仅显示统计。 */}
      <div className="flex items-center gap-1.5 border-b border-base-300 px-3 py-1">
        {/* 统计信息。 */}
        <span className="text-[12px] text-neutral/70">
          Rows: {totalSize}
        </span>
      </div>

      {/* 数据表格主体。 */}
      <div ref={gridBodyRef} className="relative min-h-0 flex-1">
        {/* Glide Data Grid 组件：承载行列渲染、编辑、选择、列宽调整等核心交互。 */}
        <DataEditor
          // 列定义：包含选择列、序号列和业务字段列。
          columns={columns}
          // 行总数：与当前查询结果 records 对齐。
          rows={records.length}
          // 单元格数据读取函数：按坐标返回对应的 GridCell。
          getCellContent={getCellContent}
          // 单元格激活时记录位置，供自定义编辑器判断当前列类型。
          onCellActivated={(cell) => {
            activeEditorCellRef.current = cell; // ref 同步写入，避免 setState 异步导致 provideEditor 读到旧值。
            setActiveEditorCell(cell);
          }}
          // 单元格提交编辑时的单点更新处理。
          onCellEdited={(location, value) => {
            onCellEdited(location, value);
          }}
          // 单元格点击事件：用于双击编辑提示等交互。
          onCellClicked={onCellClicked}
          // 单元格右键事件：弹出记录级菜单。
          onCellContextMenu={(cell, event) => {
            const [col, row] = cell;
            const record = records[row] || {};
            const recordId = String(record.Id ?? "").trim();
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId) return;
            const isDataColumn = !columnId.startsWith("__");
            const metadata = isDataColumn ? (fieldMetadataMap[columnId] || {}) : {};
            const isNewRow = Boolean(record.__isNew);
            const canSetNone =
              isDataColumn &&
              metadata.nillable === true &&
              isCellEditableByMeta(metadata, isNewRow);
            // 右键命中单元格文本：用于“复制”菜单项。
            const cellText =
              columnId === "__select"
                ? String(selectedRecordIds.includes(recordId))
                : columnId === "__index"
                  ? String(row + 1)
                  : stringifyCellValue(record[columnId]);

            const gridRect = gridBodyRef.current?.getBoundingClientRect();
            if (!gridRect) return;

            const localClickX = event.bounds.x + event.localEventX;
            const localClickY = event.bounds.y + event.localEventY;
            const anchorClientX = resolveViewportAxis(localClickX, gridRect.left, gridRect.right);
            const anchorClientY = resolveViewportAxis(localClickY, gridRect.top, gridRect.bottom);

            event.preventDefault(); // 阻止默认右键行为，交由自定义菜单处理。
            setRowContextMenu({
              x: anchorClientX,
              y: anchorClientY,
              recordId,
              cellText,
              rowIndex: row,
              columnId,
              canSetNone
            });
          }}
          // 粘贴/批量编辑时的批处理入口。
          onCellsEdited={onCellsEdited}
          // 使用 Glide 内置 overlay 机制渲染字段专属编辑器。
          provideEditor={provideEditor}
          // 自定义首列表头复选框样式，使其与行内复选框视觉一致。
          drawHeader={drawHeader}
          // 点击首列表头可切换全选状态。
          onHeaderClicked={(col, event) => {
            const columnId = String(columns[col]?.id ?? "");
            if (columnId === "__select") {
              onToggleAll(!allChecked, selectableIds);
              return;
            }

            if (!columnId || columnId.startsWith("__")) {
              return;
            }

            // 命中 info icon 时阻止默认行为，避免触发整列选中。
            if (showHeaderMetadata && isHeaderInfoIconHit(event.localEventX, event.localEventY, event.bounds)) {
              event.preventDefault();
            }
          }}
          // 鼠标经过 info icon 时展示字段元数据，离开时隐藏。
          onMouseMove={(args) => {
            if (!showHeaderMetadata) {
              if (!metaPanelHovering) {
                scheduleMetaClose();
              }
              return;
            }
            if (args.kind !== "header") {
              if (!metaPanelHovering) {
                scheduleMetaClose();
              }
              return;
            }

            const columnId = String(columns[args.location[0]]?.id ?? "");
            if (!columnId || columnId.startsWith("__")) {
              if (!metaPanelHovering) {
                scheduleMetaClose();
              }
              return;
            }

            if (!isHeaderInfoIconHit(args.localEventX, args.localEventY, args.bounds)) {
              if (!metaPanelHovering) {
                scheduleMetaClose();
              }
              return;
            }

            const metadata = fieldMetadataMap[columnId];
            if (!metadata) {
              if (!metaPanelHovering) {
                scheduleMetaClose();
              }
              return;
            }

            cancelMetaClose();
            const gridRect = gridBodyRef.current?.getBoundingClientRect();
            if (!gridRect) return;
            const iconSize = 11;
            // 以 info icon 中心点下方作为锚点，转换到 viewport 坐标。
            const iconCenterX = args.bounds.x + args.bounds.width - 9 - iconSize / 2;
            const iconBottomY = args.bounds.y + Math.floor((args.bounds.height - iconSize) / 2) + iconSize;
            const anchorClientX = resolveViewportAxis(iconCenterX, gridRect.left, gridRect.right);
            const anchorClientY = resolveViewportAxis(iconBottomY, gridRect.top, gridRect.bottom);

            setHoveredHeaderMeta({
              fieldName: columnId,
              // 元数据展示统一走共享格式化逻辑，确保与 SOQL 执行器字段展开完全一致。
              metadata: buildDisplayMetadataFromRaw(metadata),
              anchorClientX,
              anchorClientY
            });
          }}
          // 双击才激活编辑，避免单击误操作。
          cellActivationBehavior="double-click"
          // 列宽拖拽后写入本地状态，保持用户当前会话下的列宽偏好。
          onColumnResize={(column, newSize) => {
            const id = String(column.id ?? "");
            if (!id) return;
            setColumnWidths((current) => ({ ...current, [id]: Math.max(44, Math.floor(newSize)) }));
          }}
          // 列宽边界：约束最小/最大宽度，避免布局极端变形。
          minColumnWidth={44}
          maxColumnWidth={900}
          // 行高与表头高度：表头提高到双行，支持 Field Name/Label 分行显示。
          rowHeight={30}
          headerHeight={42}
          // 平滑滚动：提升大数据量横向/纵向浏览体验。
          smoothScrollX
          smoothScrollY
          // 容器尺寸：铺满父容器区域。
          width="100%"
          height="100%"
          // 支持区域选择时读取选区单元格。
          getCellsForSelection
          // 启用二维粘贴（按行列拆分），行为与 Excel 类似。
          onPaste
        />

        {/* 表头字段元数据悬浮提示：仅在 hover 到 info icon 时显示。 */}
        {showHeaderMetadata && hoveredHeaderMeta && (
          <HeaderMetaPopover
            hoveredHeaderMeta={hoveredHeaderMeta}
            onMouseEnter={() => {
              cancelMetaClose();
              setMetaPanelHovering(true);
            }}
            onMouseLeave={() => {
              setMetaPanelHovering(false);
              scheduleMetaClose();
            }}
          />
        )}

        {/* 行右键菜单：提供“打开 Salesforce 记录页”操作。 */}
        {rowContextMenu && (
          <RowContextMenu
            menuState={rowContextMenu}
            onCopyCell={onCopyCell}
            onSetNone={onSetNone}
            onOpenRecordPage={onOpenRecordPage}
            canOpenRecordPage={canOpenRecordPage}
          />
        )}
      </div>
    </div>
  );
}

// 将 Glide 坐标转换为 viewport 坐标：兼容不同事件坐标系（已含容器偏移或未含偏移）。
function resolveViewportAxis(value: number, containerStart: number, containerEnd: number): number {
  if (value >= containerStart && value <= containerEnd) {
    return value;
  }
  return containerStart + value;
}
