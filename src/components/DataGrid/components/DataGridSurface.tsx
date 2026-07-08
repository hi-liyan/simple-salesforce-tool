import React from "react";
import { DataEditor, EditableGridCell, EditListItem, GridCell, GridColumn, GridSelection, Item } from "@glideapps/glide-data-grid";
import { HeaderMetaPopover } from "./HeaderMetaPopover";
import { RowContextMenu } from "./RowContextMenu";
import { stringifyCellValue } from "../utils/value";
import { RowContextMenuState, HoveredHeaderMetaState } from "../types";
import { isHeaderInfoIconHit } from "../renderers/drawHeader";
import { buildDisplayMetadataFromRaw } from "../../../utils/fieldMetadata";
import { resolveRowContextMenuCapabilities } from "../logic/contextMenu";
import { resolveIndexHeaderToggleSelection, resolveIndexRowSelection } from "../logic/selection.ts";
import { resolveSelectedEditableLocations } from "../logic/paste.ts";
import { getDataGridSelectionConfig } from "../logic/surfaceConfig.ts";
import type { DataGridScrollState } from "../../../store/useDataGridScrollStore.ts";

// DataGrid 表头高度：与 DataEditor 的 headerHeight 配置保持一致。
const DATA_GRID_HEADER_HEIGHT = 30;
// DataGrid 数据行高度：与 DataEditor 的 rowHeight 配置保持一致。
const DATA_GRID_ROW_HEIGHT = 30;
// DataGrid 横向滚动条预留高度：在需要时才保留，避免无滚动条时留白。
const DEFAULT_SCROLLBAR_GUTTER = 14;

// 计算滚动条尺寸：用于动态预留滚动条高度（Windows/macOS/自定义滚动条尺寸不同）。
function getScrollbarSize(): number {
  // 通过创建临时元素测量，避免依赖固定值。
  const measure = document.createElement("div");
  measure.style.width = "100px";
  measure.style.height = "100px";
  measure.style.overflow = "scroll";
  measure.style.position = "absolute";
  measure.style.top = "-9999px";
  document.body.appendChild(measure);
  const size = measure.offsetHeight - measure.clientHeight;
  document.body.removeChild(measure);
  return size;
}

type DataGridSurfaceProps = {
  // 当前行数据。
  records: Record<string, unknown>[];
  // 表格列定义。
  columns: GridColumn[];
  // 字段元数据映射。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 当前数据源类型：用于元数据展示适配（如 MySQL 类型显示）。
  selectedSourceType?: string;
  // 已选中记录 Id。
  selectedRecordIds: string[];
  // 是否展示表头元数据 icon。
  showHeaderMetadata: boolean;
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
  // 表头最小列宽：用于约束拖拽缩小，保证表头文本不被“缩放压扁”。
  headerMinWidths: Record<string, number>;
  // 激活单元格 ref：供编辑器分发读取。
  activeEditorCellRef: React.MutableRefObject<Item | null>;
  // 激活单元格状态写入。
  setActiveEditorCell: (cell: Item | null) => void;
  // 是否允许打开 Salesforce 记录页。
  canOpenRecordPage: boolean;
  // 是否显示“打开 Salesforce 记录页”菜单项。
  showOpenRecordPage: boolean;
  // 表头点击回调。
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  // 右键菜单动作：复制。
  onCopyCell: () => void;
  // 右键菜单动作：置空（None/Null）。
  onSetNullish: () => void;
  // 右键菜单动作：恢复默认值。
  onSetDefaultValue: () => void;
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
  // 粘贴回调：用于在特定场景下接管 Glide 默认粘贴行为。
  onPaste: (target: Item, values: readonly (readonly string[])[], selectedLocations: readonly Item[]) => boolean;
  // 编辑器分发回调。
  provideEditor: NonNullable<React.ComponentProps<typeof DataEditor>["provideEditor"]>;
  // 表头绘制回调。
  drawHeader: NonNullable<React.ComponentProps<typeof DataEditor>["drawHeader"]>;
  // 横向滚动偏移：用于在多 tab / 切 panel 后恢复当前表格的滚动位置。
  scrollOffsetX?: number;
  // 纵向滚动偏移：用于在多 tab / 切 panel 后恢复当前表格的滚动位置。
  scrollOffsetY?: number;
  // 运行态滚动位置回调：DataEditor 可见区域变化时回写给上层 store。
  onScrollOffsetChange?: (nextState: DataGridScrollState) => void;
};

// 可见区域快照：从 Glide 回调中提取恢复滚动位置所需的最小字段集合。
type VisibleRegionSnapshot = {
  // 当前可见区域起始列索引。
  x: number;
  // 当前可见区域起始行索引。
  y: number;
  // 当前可见区域宽度（按可见列数）。
  width: number;
  // 当前可见区域高度（按可见行数）。
  height: number;
};

// 根据 Glide 的可见区域与平移量，反推出 DataEditor 需要的像素级滚动偏移。
function resolveGridScrollOffsets({
  visibleRegion,
  translateX,
  translateY,
  columns,
  freezeColumns
}: {
  visibleRegion: VisibleRegionSnapshot;
  translateX: number;
  translateY: number;
  columns: GridColumn[];
  freezeColumns: number;
}): DataGridScrollState {
  const firstScrollableColumnIndex = Math.max(freezeColumns, visibleRegion.x);
  const scrolledColumnsWidth = columns
    .slice(freezeColumns, firstScrollableColumnIndex)
    .reduce((sum, column) => {
      const rawWidth = (column as { width?: unknown }).width;
      return sum + (typeof rawWidth === "number" ? rawWidth : 160);
    }, 0);

  return {
    x: Math.max(0, Math.round(scrolledColumnsWidth - translateX)),
    y: Math.max(0, Math.round(visibleRegion.y * DATA_GRID_ROW_HEIGHT - translateY))
  };
}

// DataGrid 渲染层：仅负责 DataEditor 与浮层/菜单的 UI 组装。
export function DataGridSurface({
  records,
  columns,
  fieldMetadataMap,
  selectedSourceType,
  selectedRecordIds,
  showHeaderMetadata,
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
  headerMinWidths,
  activeEditorCellRef,
  setActiveEditorCell,
  canOpenRecordPage,
  showOpenRecordPage,
  onToggleAll,
  onCopyCell,
  onSetNullish,
  onSetDefaultValue,
  onOpenRecordPage,
  getCellContent,
  onCellEdited,
  onCellClicked,
  onCellsEdited,
  onPaste,
  provideEditor,
  drawHeader,
  scrollOffsetX,
  scrollOffsetY,
  onScrollOffsetChange
}: DataGridSurfaceProps) {
  const selectionConfig = React.useMemo(() => getDataGridSelectionConfig(), []);
  // 受控选区状态：用于实现“点击 # 选整行”。
  const [gridSelection, setGridSelection] = React.useState<GridSelection | undefined>(undefined);
  // 最新可粘贴目标单元格：在选区变化时同步写入，避免粘贴时读取到滞后的 React state。
  const selectedPasteLocationsRef = React.useRef<readonly Item[]>([]);
  // 横向滚动条预留高度：仅在需要显示横向滚动条时才保留。
  const [scrollbarGutter, setScrollbarGutter] = React.useState(0);
  // 计算当前总列宽：用于绘制右侧空白区域遮罩（列较少时隐藏空白网格线）。
  const totalColumnsWidth = React.useMemo(
    () => columns.reduce((sum, column) => {
      const rawWidth = (column as { width?: unknown }).width;
      return sum + (typeof rawWidth === "number" ? rawWidth : 160);
    }, 0),
    [columns]
  );

  // 动态判断是否需要横向滚动条，避免无滚动条时出现底部空白区网格线。
  React.useLayoutEffect(() => {
    const container = gridBodyRef.current;
    if (!container) return;

    const updateGutter = () => {
      const containerWidth = container.clientWidth;
      const hasHorizontalOverflow = totalColumnsWidth > containerWidth;
      if (!hasHorizontalOverflow) {
        setScrollbarGutter(0);
        return;
      }
      const measuredSize = getScrollbarSize();
      setScrollbarGutter(Math.max(measuredSize, DEFAULT_SCROLLBAR_GUTTER));
    };

    updateGutter(); // 初始化时先测一次。

    const observer = new ResizeObserver(() => {
      updateGutter(); // 容器尺寸变化时重新计算。
    });
    observer.observe(container);

    return () => {
      observer.disconnect();
    };
  }, [gridBodyRef, totalColumnsWidth]);

  React.useEffect(() => {
    if (selectedRecordIds.length === 0) {
      setGridSelection(undefined); // 外层清空选中记录后，同步清空表格整行高亮。
      selectedPasteLocationsRef.current = []; // 行内注释：整行选区清空后，同步丢弃粘贴目标快照。
    }
  }, [selectedRecordIds]);

  // 统一处理选区变更：命中 # 序号列时，将默认单元格选区改写为整行选区。
  const handleGridSelectionChange = React.useCallback(
    (nextSelection: GridSelection) => {
      const resolvedSelection = resolveIndexRowSelection({
        nextSelection,
        columns,
        selectableIds
      });
      setGridSelection(resolvedSelection.gridSelection);
      selectedPasteLocationsRef.current = resolveSelectedEditableLocations({
        gridSelection: resolvedSelection.gridSelection,
        columns
      });
      if (resolvedSelection.isIndexRowSelection) {
        onToggleAll(resolvedSelection.selectedRecordIds.length > 0, resolvedSelection.selectedRecordIds);
        return;
      }
      if (selectedRecordIds.length > 0) {
        onToggleAll(false, []); // 点击普通单元格时清空行选中，避免删除/批处理命中旧选区。
      }
    },
    [columns, selectableIds, onToggleAll, selectedRecordIds.length]
  );

  // DataEditor 可见区域变化时，把当前像素级滚动位置回写到运行态 store。
  const handleVisibleRegionChanged = React.useCallback((visibleRegion: VisibleRegionSnapshot, translateX: number, translateY: number) => {
    if (!onScrollOffsetChange) return;
    const container = gridBodyRef.current;
    if (!container) return;
    if (container.clientWidth <= 0 || container.clientHeight <= 0) return; // 行内注释：隐藏 panel 时容器尺寸为 0，此时忽略回写，避免把有效滚动状态覆盖成初始值。
    onScrollOffsetChange(
      resolveGridScrollOffsets({
        visibleRegion,
        translateX,
        translateY,
        columns,
        freezeColumns: selectionConfig.freezeColumns
      })
    );
  }, [columns, gridBodyRef, onScrollOffsetChange, selectionConfig.freezeColumns]);

  return (
    // 表格容器：仅承载数据表格主体与浮层。
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 数据表格主体。 */}
      <div ref={gridBodyRef} className="relative min-h-0 flex-1">
        {/* Glide Data Grid 组件：承载行列渲染、编辑、选择、列宽调整等核心交互。 */}
        <DataEditor
          // 列定义：包含冻结序号列和业务字段列。
          columns={columns}
          // 冻结首列序号：横向滚动时始终保留左侧行头。
          freezeColumns={selectionConfig.freezeColumns}
          // 启用多矩形选区：桌面端支持 Ctrl/Command 追加离散选区，是数据库客户端常见交互。
          rangeSelect={selectionConfig.rangeSelect}
          // 受控选区：用于支持自定义的整行选中行为。
          gridSelection={gridSelection}
          onGridSelectionChange={handleGridSelectionChange}
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
          onCellClicked={(cell, event) => {
            const [col] = cell;
            const columnId = String(columns[col]?.id ?? "");
            // # 序号列的整行选区由 onGridSelectionChange 统一改写，这里不做额外处理。
            if (columnId === "__index") return;
            onCellClicked?.(cell, event);
          }}
          // 单元格右键事件：弹出记录级菜单。
          onCellContextMenu={(cell, event) => {
            const [col, row] = cell;
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId) return;
            // 复制行为优先使用“当前选中单元格”，若不存在则回退到右键命中的单元格。
            const selectedCell = gridSelection?.current?.cell;
            const copyCol = selectedCell ? selectedCell[0] : col;
            const copyRow = selectedCell ? selectedCell[1] : row;
            const copyColumnId = String(columns[copyCol]?.id ?? "");
            if (!copyColumnId) return;
            const record = records[row] || {};
            const copyRecord = records[copyRow] || {};
            const recordId = String(record.Id ?? "").trim();
            const isDataColumn = !columnId.startsWith("__");
            const metadata = isDataColumn ? (fieldMetadataMap[columnId] || {}) : {};
            const isNewRow = Boolean(record.__isNew);
            const contextMenuCapabilities = resolveRowContextMenuCapabilities({
              selectedSourceType,
              metadata,
              isNewRow,
              isDataColumn
            });
            // 复制文本：优先复制当前选区（支持多格/整行/多行），无选区时回退单元格。
            const cellText = buildCopyTextBySelection(
              gridSelection,
              columns,
              records,
              getCellContent,
              copyCol,
              copyRow,
              copyColumnId,
              copyRecord
            );

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
              canSetNullish: contextMenuCapabilities.canSetNullish,
              nullishActionLabel: contextMenuCapabilities.nullishActionLabel,
              canSetDefaultValue: contextMenuCapabilities.canSetDefaultValue,
              defaultValueActionLabel: contextMenuCapabilities.defaultValueActionLabel,
              defaultValueMode: contextMenuCapabilities.defaultValueMode
            });
          }}
          // 粘贴/批量编辑时的批处理入口。
          onCellsEdited={onCellsEdited}
          // 使用 Glide 内置 overlay 机制渲染字段专属编辑器。
          provideEditor={provideEditor}
          // 自定义字段表头双行绘制与元数据图标。
          drawHeader={drawHeader}
          onHeaderClicked={(col, event) => {
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId) {
              return;
            }

            if (columnId === "__index") {
              const nextSelection = resolveIndexHeaderToggleSelection({
                selectableIds,
                selectedRecordIds
              });
              onToggleAll(nextSelection.checked, nextSelection.recordIds);
              return;
            }

            if (columnId.startsWith("__")) {
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
              metadata: buildDisplayMetadataFromRaw(metadata, selectedSourceType),
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
            const minWidth = headerMinWidths[id] ?? 44; // 关键：至少要容纳表头文案宽度，避免 Canvas fillText 缩放导致压缩。
            setColumnWidths((current) => ({ ...current, [id]: Math.max(minWidth, Math.floor(newSize)) }));
          }}
          // 列宽边界：约束最小/最大宽度，避免布局极端变形。
          minColumnWidth={44}
          maxColumnWidth={900}
          // 行高与表头高度：表头提高到双行，支持 Field Name/Label 分行显示。
          rowHeight={DATA_GRID_ROW_HEIGHT}
          headerHeight={DATA_GRID_HEADER_HEIGHT}
          // 平滑滚动：提升大数据量横向/纵向浏览体验。
          smoothScrollX
          smoothScrollY
          // 受控滚动偏移：用于切换 panel / tab 后恢复到之前的横纵滚动位置。
          scrollOffsetX={scrollOffsetX}
          scrollOffsetY={scrollOffsetY}
          // 可见区域变化时回写滚动位置，供当前会话内的多 tab 独立记忆。
          onVisibleRegionChanged={handleVisibleRegionChanged}
          // 容器尺寸：铺满父容器区域。
          width="100%"
          height="100%"
          // 支持区域选择时读取选区单元格。
          getCellsForSelection
          // 粘贴回调：默认沿用 Glide 的矩形粘贴，仅在特定多选场景下由上层接管。
          onPaste={(target, values) => onPaste(target, values, selectedPasteLocationsRef.current)}
        />
        {/* 空白区遮罩：仅保留“有数据区域”的网格线，隐藏数据末行以下的网格背景。 */}
        {records.length > 0 && (
          <div
            className="pointer-events-none absolute inset-x-0 z-[1] border-t border-base-300 bg-base-100"
            style={{
              top: DATA_GRID_HEADER_HEIGHT + records.length * DATA_GRID_ROW_HEIGHT,
              bottom: scrollbarGutter
            }}
          />
        )}
        {/* 右侧空白遮罩：当列总宽不足容器宽度时，隐藏右侧空白网格线。 */}
        {records.length > 0 && (
          <div
            className="pointer-events-none absolute right-0 z-[1] bg-base-100"
            style={{
              top: DATA_GRID_HEADER_HEIGHT,
              left: totalColumnsWidth,
              bottom: scrollbarGutter
            }}
          />
        )}
        {/* 表头右侧空白遮罩：复用同样的覆盖方式，隐藏无数据区域的表头背景与分隔线。 */}
        {records.length > 0 && (
          <div
            className="pointer-events-none absolute right-0 top-0 z-[1] bg-base-100"
            style={{ left: totalColumnsWidth, height: DATA_GRID_HEADER_HEIGHT }}
          />
        )}
        {/* 数据区右边界线：向上延伸覆盖表头，保留数据区与空白区之间的分界线。 */}
        {records.length > 0 && (
          <div
            className="pointer-events-none absolute z-[2] w-0 border-l border-base-300"
            style={{
              top: 0,
              left: totalColumnsWidth,
              height: DATA_GRID_HEADER_HEIGHT + records.length * DATA_GRID_ROW_HEIGHT
            }}
          />
        )}

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
            onSetNullish={onSetNullish}
            onSetDefaultValue={onSetDefaultValue}
            onOpenRecordPage={onOpenRecordPage}
            canOpenRecordPage={canOpenRecordPage}
            showOpenRecordPage={showOpenRecordPage}
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

// 复制文本构建：优先按当前选区导出 TSV（支持多格/整行/多行），否则回退单元格文本。
function buildCopyTextBySelection(
  gridSelection: GridSelection | undefined,
  columns: GridColumn[],
  records: Record<string, unknown>[],
  getCellContent: (cell: Item) => GridCell,
  fallbackCol: number,
  fallbackRow: number,
  fallbackColumnId: string,
  fallbackRecord: Record<string, unknown>
): string {
  const currentSelection = gridSelection?.current;
  if (currentSelection) {
    // 支持多选区：Glide 会把历史选区放在 rangeStack，当前选区在 range。
    const selectionRanges = [...currentSelection.rangeStack, currentSelection.range];
    const blocks = selectionRanges
      .map((range) => buildTsvByRange(range, columns, records, getCellContent))
      .filter((text) => text !== "");
    if (blocks.length > 0) {
      return blocks.join("\n");
    }
  }

  const selectedRows = gridSelection?.rows;
  if (selectedRows && selectedRows.length > 0) {
    // 仅存在行选区时，按整行导出所有可见列（同样输出 TSV）。
    const lines: string[] = [];
    const sortedRows = [...selectedRows].sort((left, right) => left - right);
    for (const row of sortedRows) {
      if (row < 0 || row >= records.length) continue;
      const cells: string[] = [];
      for (let col = 0; col < columns.length; col += 1) {
        const cell = getCellContent([col, row]);
        cells.push(gridCellToText(cell));
      }
      lines.push(cells.join("\t"));
    }
    if (lines.length > 0) {
      return lines.join("\n");
    }
  }

  const fallbackCell = getCellContent([fallbackCol, fallbackRow]);
  const fallbackByGrid = gridCellToText(fallbackCell);
  if (fallbackByGrid !== "") return fallbackByGrid;
  if (fallbackColumnId === "__index") return String(fallbackRow + 1);
  return stringifyCellValue(fallbackRecord[fallbackColumnId]);
}

// 将矩形选区导出为 TSV 文本。
function buildTsvByRange(
  range: { x: number; y: number; width: number; height: number },
  columns: GridColumn[],
  records: Record<string, unknown>[],
  getCellContent: (cell: Item) => GridCell
): string {
  if (range.width <= 0 || range.height <= 0 || columns.length === 0 || records.length === 0) {
    return "";
  }
  const startCol = Math.max(0, range.x);
  const endCol = Math.min(columns.length - 1, range.x + range.width - 1);
  const startRow = Math.max(0, range.y);
  const endRow = Math.min(records.length - 1, range.y + range.height - 1);
  if (startCol > endCol || startRow > endRow) {
    return "";
  }

  const lines: string[] = [];
  for (let row = startRow; row <= endRow; row += 1) {
    const cells: string[] = [];
    for (let col = startCol; col <= endCol; col += 1) {
      const cell = getCellContent([col, row]);
      cells.push(gridCellToText(cell));
    }
    lines.push(cells.join("\t"));
  }
  return lines.join("\n");
}

// GridCell 转文本：优先 displayData，回退 data，统一用于复制输出。
function gridCellToText(cell: GridCell): string {
  const displayData = (cell as { displayData?: unknown }).displayData;
  const data = (cell as { data?: unknown }).data;
  // None/Null 为展示占位文案，复制时应回退为空文本，避免把占位词当真实值写入外部系统。
  if (typeof displayData === "string" && (displayData === "None" || displayData === "Null")) {
    if (data === null || data === undefined || (typeof data === "string" && data === "")) {
      return "";
    }
  }
  if (typeof displayData === "string") return displayData;
  if (data === null || data === undefined) return "";
  if (typeof data === "string" || typeof data === "number" || typeof data === "boolean") {
    return String(data);
  }
  try {
    return JSON.stringify(data);
  } catch {
    return String(data);
  }
}
