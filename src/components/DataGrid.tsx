import { useEffect, useMemo, useRef, useState } from "react";

import {
  CellClickedEventArgs,
  DataEditor,
  EditableGridCell,
  EditListItem,
  GridCell,
  GridCellKind,
  GridColumn,
  Item,
  TextCell
} from "@glideapps/glide-data-grid";
import "@glideapps/glide-data-grid/dist/index.css";
import { api } from "../api";
import { QueryResult } from "../types";
import {
  buildDisplayMetadataFromRaw,
  formatFieldMetadataValue,
  sortFieldMetadataEntries,
  translateFieldMetadataKey
} from "../utils/fieldMetadata";

type Props = {
  result: QueryResult;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  dirtyCellKeys: string[];
  selectedRecordIds: string[];
  // 当前选中的数据源 ID：用于打开 Salesforce 记录页（可选）。
  sourceId?: string;
  // 当前对象 API 名称：用于打开 Salesforce 记录页（可选）。
  objectName?: string;
  // 待删除记录 Id 列表：用于将整行标记为灰色背景。
  pendingDeleteRecordIds: string[];
  onToggleRecord: (recordId: string, checked: boolean) => void;
  onToggleAll: (checked: boolean, recordIds: string[]) => void;
  onEditCell: (rowIndex: number, columnName: string, value: unknown) => void;
  onShowMessage: (message: string) => void;
  // 是否展示表头 info icon 与字段元数据悬浮层。
  showHeaderMetadata?: boolean;
  // 是否启用双击只读单元格时的提示逻辑。
  enableReadonlyCellHint?: boolean;
  // 是否显示勾选列（首列 checkbox）。
  showSelectionColumn?: boolean;
};

// 查询结果表：使用 Glide Data Grid 提供更接近数据库客户端的表格体验。
export function DataGrid({
  result,
  visibleColumns,
  fieldMetadataMap,
  dirtyCellKeys,
  selectedRecordIds,
  sourceId,
  objectName,
  pendingDeleteRecordIds,
  onToggleRecord,
  onToggleAll,
  onEditCell,
  onShowMessage,
  showHeaderMetadata = true,
  enableReadonlyCellHint = true,
  showSelectionColumn = true
}: Props) {
  const records = result.records;

  const displayColumns = useMemo(
    () => {
      // 列顺序规范：始终将 Id、Name 提前展示，其余字段保持原有顺序。
      const priority = ["Id", "Name"].filter((column) => visibleColumns.includes(column));
      const rest = visibleColumns.filter((column) => column !== "Id" && column !== "Name");
      return [...priority, ...rest];
    },
    [visibleColumns]
  );

  const selectableIds = useMemo(
    () =>
      records
        .map((item, index) => String(item.Id || `row-${index}`))
        .filter((id) => !id.startsWith("row-")),
    [records]
  );

  const allChecked = selectableIds.length > 0 && selectableIds.every((id) => selectedRecordIds.includes(id));
  const hasAnyChecked = selectedRecordIds.some((id) => selectableIds.includes(id));
  const dirtyCellSet = useMemo(() => new Set(dirtyCellKeys), [dirtyCellKeys]);
  const pendingDeleteRecordSet = useMemo(() => new Set(pendingDeleteRecordIds), [pendingDeleteRecordIds]);
  const gridBodyRef = useRef<HTMLDivElement | null>(null);
  const closeMetaTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // 行右键菜单状态：记录菜单坐标与目标记录 Id。
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; recordId: string } | null>(null);

  useEffect(() => {
    return () => {
      if (!closeMetaTimerRef.current) return;
      clearTimeout(closeMetaTimerRef.current);
      closeMetaTimerRef.current = null;
    };
  }, []);

  // 全局关闭行右键菜单：点击空白、滚动、按下 ESC 时关闭。
  useEffect(() => {
    if (!rowContextMenu) return;

    const closeMenu = () => {
      setRowContextMenu(null); // 统一关闭菜单，避免浮层残留。
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      closeMenu(); // ESC 快捷关闭菜单。
    };

    window.addEventListener("click", closeMenu);
    window.addEventListener("scroll", closeMenu, true);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("click", closeMenu);
      window.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [rowContextMenu]);

  // 列宽状态：支持用户拖拽后即时更新列宽。
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  // 表头元数据提示：鼠标经过 info icon 时展示。
  const [hoveredHeaderMeta, setHoveredHeaderMeta] = useState<{
    fieldName: string;
    metadata: Record<string, unknown>;
    anchorClientX: number;
    anchorClientY: number;
  } | null>(null);
  // 鼠标是否位于元数据浮层内：用于支持从表头移动到浮层并滚动。
  const [metaPanelHovering, setMetaPanelHovering] = useState(false);
  // 当前激活单元格：用于 provideEditor 判断是否为 picklist 编辑。
  const [activeEditorCell, setActiveEditorCell] = useState<Item | null>(null);

  const columns = useMemo<GridColumn[]>(() => {
    const dataColumns: GridColumn[] = displayColumns.map((column) => ({
      id: column,
      title: column,
      width: columnWidths[column] ?? (column === "Id" ? 280 : 180)
    }));

    return [
      ...(showSelectionColumn ? [{ id: "__select", title: "", width: columnWidths.__select ?? 44 }] : []),
      { id: "__index", title: "#", width: columnWidths.__index ?? 56 },
      ...dataColumns
    ];
  }, [displayColumns, columnWidths, showSelectionColumn]);

  if (records.length === 0) {
    return (
      // 空状态容器。
      <div className="p-2">
        {/* 空状态提示。 */}
        <span className="text-[12px] text-neutral/70">
          暂无查询结果。
        </span>
      </div>
    );
  }

  const getRecordKey = (rowIndex: number): string => {
    const record = records[rowIndex] || {};
    if (record.__localId) return String(record.__localId);
    if (record.Id) return String(record.Id);
    return `row-${rowIndex}`;
  };

  const getCellContent = ([col, row]: Item): GridCell => {
    const columnId = String(columns[col]?.id ?? "");
    const record = records[row] || {};
    const recordId = getRecordKey(row);
    const isNewRow = Boolean(record.__isNew);
    // 待删除行统一灰色高亮，便于用户识别“尚未提交删除”的记录。
    const isPendingDeleteRow = pendingDeleteRecordSet.has(recordId);
    // 新建行统一浅绿色高亮，便于用户识别“待提交新增”的记录。
    const isNewRowHighlight = isNewRow;
    // 行级样式：用于选择列/序号列等非业务字段单元格。
    const rowThemeOverride = buildRowThemeOverride(isPendingDeleteRow, isNewRowHighlight);

    if (columnId === "__select") {
      return {
        kind: GridCellKind.Boolean,
        data: selectedRecordIds.includes(recordId),
        allowOverlay: false,
        readonly: recordId.startsWith("row-"),
        // 行级高亮：确保选择列与数据列颜色一致。
        themeOverride: rowThemeOverride
      };
    }

    if (columnId === "__index") {
      const text = String(row + 1);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: false,
        readonly: true,
        // 行级高亮：确保序号列与数据列颜色一致。
        themeOverride: rowThemeOverride
      };
    }

    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);
    const editable = isCellEditableByMeta(metadata, isNewRow);
    const requiredNewField = isRequiredOnCreate(metadata, isNewRow);
    const raw = record[columnId];
    const isDirty = dirtyCellSet.has(`${recordId}:${columnId}`);
    const isRequiredEmpty = requiredNewField && isEmptyValue(raw);

    const commonTheme = buildCellThemeOverride(isDirty, isRequiredEmpty, isPendingDeleteRow, isNewRowHighlight);

    if (isBooleanType(fieldType)) {
      const text = normalizeBooleanText(raw);
      return {
        kind: GridCellKind.Text,
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (isNumberType(fieldType)) {
      const num = coerceNumber(raw);
      return {
        kind: GridCellKind.Number,
        data: num,
        displayData: raw === null || raw === undefined ? "" : String(raw),
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    const text = stringifyCellValue(raw);
    return {
      kind: GridCellKind.Text,
      data: text,
      displayData: text,
      allowOverlay: editable,
      readonly: !editable,
      themeOverride: commonTheme
    };
  };

  const handleCellEdited = ([col, row]: Item, newValue: EditableGridCell) => {
    const columnId = String(columns[col]?.id ?? "");

    if (columnId === "__select" && newValue.kind === GridCellKind.Boolean) {
      const recordId = getRecordKey(row);
      if (!recordId.startsWith("row-")) {
        onToggleRecord(recordId, Boolean(newValue.data));
      }
      return;
    }

    if (columnId === "__index" || columnId.startsWith("__")) {
      return;
    }

    const record = records[row] || {};
    const isNewRow = Boolean(record.__isNew);
    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (isPicklistType(fieldType)) {
      const options = getPicklistOptions(metadata);
      const nextText = extractEditableString(newValue);
      if (!options.some((item) => item.value === nextText)) {
        onShowMessage(`${columnId} 字段只能选择预设选项。`);
        return;
      }
      onEditCell(row, columnId, nextText);
      return;
    }

    if (isBooleanType(fieldType)) {
      const text = extractEditableString(newValue).trim().toLowerCase();
      if (text !== "true" && text !== "false") {
        onShowMessage(`${columnId} 字段仅支持 true/false。`);
        return;
      }
      onEditCell(row, columnId, text === "true");
      return;
    }

    if (isNumberType(fieldType)) {
      const num = extractEditableNumber(newValue);
      if (num === undefined && extractEditableString(newValue).trim() !== "") {
        onShowMessage(`${columnId} 字段仅支持数字。`);
        return;
      }
      onEditCell(row, columnId, num);
      return;
    }

    onEditCell(row, columnId, extractEditableString(newValue));
  };

  const handleCellClicked = (cell: Item, event: CellClickedEventArgs) => {
    if (!enableReadonlyCellHint) return;
    const [col, row] = cell;
    const columnId = String(columns[col]?.id ?? "");
    if (!event.isDoubleClick) return;
    if (!columnId || columnId.startsWith("__")) return;

    const record = records[row] || {};
    const isNewRow = Boolean(record.__isNew);
    const metadata = fieldMetadataMap[columnId] || {};
    const fieldType = getFieldType(metadata);

    if (!isCellEditableByMeta(metadata, isNewRow)) {
      const action = isNewRow ? "创建" : "更新";
      onShowMessage(`${columnId} 字段不可${action}，无法编辑。`);
      return;
    }

    if (isPicklistType(fieldType)) {
      const options = getPicklistOptions(metadata);
      if (options.length === 0) {
        onShowMessage(`${columnId} 字段未配置可选值。`);
      }
    }
  };

  const handleCellsEdited = (newValues: readonly EditListItem[]) => {
    newValues.forEach((item) => handleCellEdited(item.location, item.value));
  };

  const cancelMetaClose = () => {
    if (!closeMetaTimerRef.current) return;
    clearTimeout(closeMetaTimerRef.current);
    closeMetaTimerRef.current = null;
  };

  const scheduleMetaClose = () => {
    cancelMetaClose();
    closeMetaTimerRef.current = setTimeout(() => {
      setHoveredHeaderMeta(null);
    }, 180);
  };

  // 打开 Salesforce 记录页：调用后端混合模式（CLI 优先，失败回退 frontdoor）。
  async function openRecordPageFromMenu() {
    if (!rowContextMenu) return;
    if (!sourceId || !objectName) {
      onShowMessage("当前上下文缺少 sourceId/objectName，无法打开 Salesforce 记录页。");
      setRowContextMenu(null);
      return;
    }
    if (!rowContextMenu.recordId) {
      onShowMessage("当前行没有可用的记录 Id。");
      setRowContextMenu(null);
      return;
    }

    try {
      const openUrl = await api.openRecordPage(sourceId, objectName, rowContextMenu.recordId);
      if (openUrl) {
        window.open(openUrl, "_blank", "noopener,noreferrer"); // 非 CLI 回退场景：在浏览器打开 frontdoor URL。
      }
    } catch (error) {
      onShowMessage(`打开 Salesforce 记录页失败：${String(error)}`);
    } finally {
      setRowContextMenu(null); // 执行后关闭菜单。
    }
  }

  return (
    // 表格容器：顶部统计栏 + 数据表格。
    <div className="relative flex h-full min-h-0 flex-col">
      {/* 顶部工具栏：仅显示统计。 */}
      <div className="flex items-center gap-1.5 border-b border-base-300 px-3 py-1">
        {/* 统计信息。 */}
        <span className="text-[12px] text-neutral/70">
          Rows: {result.totalSize}
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
          onCellActivated={(cell) => setActiveEditorCell(cell)}
          // 单元格提交编辑时的单点更新处理。
          onCellEdited={handleCellEdited}
          // 单元格点击事件：用于双击编辑提示等交互。
          onCellClicked={handleCellClicked}
          // 单元格右键事件：弹出记录级菜单。
          onCellContextMenu={(cell, event) => {
            if (!sourceId || !objectName) return; // 缺少对象上下文时不展示“打开记录页”菜单。
            const [, row] = cell;
            const record = records[row] || {};
            const recordId = String(record.Id ?? "").trim();
            if (!recordId) return; // 无真实记录 Id（如新建行）时不展示菜单。

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
              recordId
            });
          }}
          // 粘贴/批量编辑时的批处理入口。
          onCellsEdited={handleCellsEdited}
          // 使用 Glide 内置 overlay 机制渲染 picklist 编辑器，避免手工定位。
          provideEditor={(cell) => {
            if (!activeEditorCell) return undefined;
            if (cell.kind !== GridCellKind.Text) return undefined;

            const [col] = activeEditorCell;
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId || columnId.startsWith("__")) return undefined;

            const metadata = fieldMetadataMap[columnId] || {};
            const fieldType = getFieldType(metadata);
            let options: { label: string; value: string }[] = [];
            if (isPicklistType(fieldType)) {
              options = getPicklistOptions(metadata);
            } else if (isBooleanType(fieldType)) {
              options = [
                { label: "true", value: "true" },
                { label: "false", value: "false" }
              ];
            } else {
              return undefined;
            }
            if (options.length === 0) return undefined;

            return (props) => {
              const textValue = props.value as TextCell;
              return (
                <div
                  className="absolute"
                  style={{
                    left: props.target.x,
                    top: props.target.y,
                    width: Math.max(props.target.width, 180)
                  }}
                >
                  <select
                    autoFocus
                    className="select select-bordered select-sm w-full bg-base-100"
                    value={normalizeSelectValue(textValue.data, options)}
                    onBlur={() => props.onFinishedEditing(undefined, [0, 0])}
                    onChange={(event) => {
                      const next = String(event.target.value);
                      const nextCell: TextCell = {
                        ...textValue,
                        data: next,
                        displayData: next
                      };
                      props.onChange(nextCell);
                      props.onFinishedEditing(nextCell, [0, 0]);
                    }}
                  >
                    {options.map((item) => (
                      <option key={item.value} value={item.value}>
                        {item.label}
                      </option>
                    ))}
                  </select>
                </div>
              );
            };
          }}
          // 自定义首列表头复选框样式，使其与行内复选框视觉一致。
          drawHeader={(args, drawContent) => {
          drawContent();
            const columnId = String(args.column.id ?? "");
            if (columnId !== "__select") {
              if (columnId.startsWith("__")) return;
              if (showHeaderMetadata) {
                drawHeaderInfoIcon(args.ctx, args.rect);
              }
              return;
            }

            const { ctx, rect } = args;
            const size = 14;
            const x = rect.x + Math.floor((rect.width - size) / 2);
            const y = rect.y + Math.floor((rect.height - size) / 2);
            const radius = 2;

            ctx.save();
            ctx.beginPath();
            ctx.moveTo(x + radius, y);
            ctx.lineTo(x + size - radius, y);
            ctx.quadraticCurveTo(x + size, y, x + size, y + radius);
            ctx.lineTo(x + size, y + size - radius);
            ctx.quadraticCurveTo(x + size, y + size, x + size - radius, y + size);
            ctx.lineTo(x + radius, y + size);
            ctx.quadraticCurveTo(x, y + size, x, y + size - radius);
            ctx.lineTo(x, y + radius);
            ctx.quadraticCurveTo(x, y, x + radius, y);
            ctx.closePath();
            ctx.fillStyle = allChecked || hasAnyChecked ? "#0176d3" : "#ffffff";
            ctx.fill();
            ctx.lineWidth = 1;
            ctx.strokeStyle = allChecked || hasAnyChecked ? "#0176d3" : "#98a4b4";
            ctx.stroke();

            if (allChecked) {
              ctx.beginPath();
              ctx.moveTo(x + 3, y + 7);
              ctx.lineTo(x + 6, y + 10);
              ctx.lineTo(x + 11, y + 4);
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.lineCap = "round";
              ctx.lineJoin = "round";
              ctx.stroke();
            } else if (hasAnyChecked) {
              ctx.beginPath();
              ctx.moveTo(x + 3, y + 7);
              ctx.lineTo(x + 11, y + 7);
              ctx.lineWidth = 2;
              ctx.strokeStyle = "#ffffff";
              ctx.lineCap = "round";
              ctx.stroke();
            }

            ctx.restore();
          }}
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
          // 行高与表头高度：统一网格密度，贴近数据库工具风格。
          rowHeight={30}
          headerHeight={30}
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
          <div
            className="fixed z-20 max-h-[320px] w-[420px] overflow-auto rounded border p-1.5"
            style={{
              // 使用 fixed + viewport 坐标，避免父容器偏移导致的错位问题。
              left: Math.min(
                Math.max(8, hoveredHeaderMeta.anchorClientX - 210),
                Math.max(8, window.innerWidth - 420 - 8)
              ),
              top: Math.min(
                Math.max(8, hoveredHeaderMeta.anchorClientY + 8),
                Math.max(8, window.innerHeight - 320 - 8)
              ),
              backgroundColor: "#223047",
              borderColor: "#3a557f",
              boxShadow: "0 10px 28px rgba(15, 23, 42, 0.35)",
              pointerEvents: "auto"
            }}
            onMouseEnter={() => {
              cancelMetaClose();
              setMetaPanelHovering(true);
            }}
            onMouseLeave={() => {
              setMetaPanelHovering(false);
              scheduleMetaClose();
            }}
          >
            {/* 元数据标题：展示当前字段名。 */}
            <p className="mb-1 block text-[12px] font-bold text-white">
              {hoveredHeaderMeta.fieldName} 字段元数据
            </p>
            {/* 元数据明细：逐条输出字段属性键值，便于核对权限与类型。 */}
            <div className="pr-0.5">
              {sortFieldMetadataEntries(hoveredHeaderMeta.metadata).map(([key, value]) => (
                <p
                  key={key}
                  className="block text-[12px] leading-[1.5]"
                  style={{ color: "#dbe7ff", fontFamily: "'Cascadia Mono', Consolas, 'Courier New', monospace" }}
                >
                  {translateFieldMetadataKey(key)}: {formatFieldMetadataValue(value)}
                </p>
              ))}
            </div>
          </div>
        )}

        {/* 行右键菜单：提供“打开 Salesforce 记录页”操作。 */}
        {rowContextMenu && (
          <div
            className="fixed z-[80] min-w-[164px] rounded border border-base-300 bg-base-100 p-1 shadow-xl"
            style={{ left: rowContextMenu.x, top: rowContextMenu.y }}
            onClick={(event) => event.stopPropagation()}
          >
            <button
              className="btn btn-ghost btn-xs w-full justify-start"
              onClick={() => {
                void openRecordPageFromMenu(); // 触发菜单动作并关闭菜单。
              }}
            >
              打开 Salesforce 记录页
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// 表头绘制 info 图标。
function drawHeaderInfoIcon(ctx: CanvasRenderingContext2D, rect: { x: number; y: number; width: number; height: number }) {
  const size = 11;
  const x = rect.x + rect.width - size - 9;
  const y = rect.y + Math.floor((rect.height - size) / 2);
  const cx = x + size / 2;
  const cy = y + size / 2;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
  // 使用低对比度描边样式，降低所有字段都展示 icon 时的视觉干扰。
  ctx.strokeStyle = "#9aa4b2";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = "#8b97a6";
  ctx.font = "600 8px sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText("i", cx, cy + 0.4);
  ctx.restore();
}

// 判断表头点击是否命中 info icon。
function isHeaderInfoIconHit(
  localX: number,
  localY: number,
  bounds: { x: number; y: number; width: number; height: number }
): boolean {
  const size = 11;
  // localEventX/localEventY 是相对当前表头单元格左上角的坐标，不能叠加 bounds.x/bounds.y。
  const left = bounds.width - size - 9;
  const right = left + size;
  const top = Math.floor((bounds.height - size) / 2);
  const bottom = top + size;
  return localX >= left && localX <= right && localY >= top && localY <= bottom;
}

// 将 Glide 坐标转换为 viewport 坐标：兼容不同事件坐标系（已含容器偏移或未含偏移）。
function resolveViewportAxis(value: number, containerStart: number, containerEnd: number): number {
  if (value >= containerStart && value <= containerEnd) {
    return value;
  }
  return containerStart + value;
}

// 根据元数据计算单元格样式（脏数据高亮 + 必填缺失红色提示）。
function buildCellThemeOverride(
  isDirty: boolean,
  requiredMissing: boolean,
  pendingDelete: boolean,
  isNewRow: boolean
): GridCell["themeOverride"] | undefined {
  if (pendingDelete) {
    return {
      bgCell: "#eceff3",
      bgCellMedium: "#dfe4ea"
    };
  }
  if (requiredMissing) {
    return {
      bgCell: "#ffeaea",
      bgCellMedium: "#ffd3d3"
    };
  }
  if (isNewRow) {
    return {
      bgCell: "#ebfaef",
      bgCellMedium: "#d5f3dc"
    };
  }
  if (isDirty) {
    return {
      bgCell: "#fff6d9",
      bgCellMedium: "#ffe9a8"
    };
  }
  return undefined;
}

// 行级样式：用于选择列与序号列的统一高亮。
function buildRowThemeOverride(
  pendingDelete: boolean,
  isNewRow: boolean
): GridCell["themeOverride"] | undefined {
  if (pendingDelete) {
    return {
      bgCell: "#eceff3",
      bgCellMedium: "#dfe4ea"
    };
  }
  if (isNewRow) {
    return {
      bgCell: "#ebfaef",
      bgCellMedium: "#d5f3dc"
    };
  }
  return undefined;
}

// 元数据类型提取。
function getFieldType(metadata: Record<string, unknown>): string {
  const raw = metadata.type;
  return typeof raw === "string" ? raw.toLowerCase() : "";
}

// 判断布尔字段类型。
function isBooleanType(fieldType: string): boolean {
  return fieldType === "boolean";
}

// 判断数字字段类型。
function isNumberType(fieldType: string): boolean {
  return ["int", "double", "currency", "percent", "long"].includes(fieldType);
}

// 判断 picklist 字段类型。
function isPicklistType(fieldType: string): boolean {
  return fieldType === "picklist";
}

// 判断字段是否可编辑。
function isCellEditableByMeta(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  const createable = metadata.createable;
  const updateable = metadata.updateable;
  if (isNewRow) {
    return createable !== false;
  }
  return updateable !== false;
}

// 判断新建记录时是否必填。
function isRequiredOnCreate(metadata: Record<string, unknown>, isNewRow: boolean): boolean {
  if (!isNewRow) return false;
  if (metadata.createable === false) return false;
  // 创建时后端会自动填默认值的字段，不应再按“必填缺失”标红。
  if (metadata.defaultedOnCreate === true) return false;
  return metadata.nillable === false;
}

// picklist 可选值提取。
function getPicklistOptions(metadata: Record<string, unknown>): { label: string; value: string }[] {
  const raw = metadata.picklistValues;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((item) => item && typeof item === "object")
    .map((item) => {
      const obj = item as Record<string, unknown>;
      const active = obj.active;
      if (active === false) return null;
      const value = String(obj.value ?? "");
      const label = String(obj.label ?? value);
      if (!value) return null;
      return { label, value };
    })
    .filter((item): item is { label: string; value: string } => Boolean(item));
}

// 布尔值统一转换为编辑器可识别文本。
function normalizeBooleanText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") return normalized;
  }
  return "false";
}

// 归一化 Select 当前值，防止值不在选项里导致空白。
function normalizeSelectValue(raw: string, options: { label: string; value: string }[]): string {
  if (options.some((item) => item.value === raw)) return raw;
  return options[0]?.value ?? "";
}

// 将值转换为数字。
function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// 判断值是否为空。
function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

// 将单元格值转为显示字符串。
function stringifyCellValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return "[Object]";
    }
  }
  return String(value);
}

// 抽取文本编辑值。
function extractEditableString(value: EditableGridCell): string {
  if (value.kind === GridCellKind.Text) return String(value.data ?? "");
  if (value.kind === GridCellKind.Number) return String(value.data ?? "");
  if (value.kind === GridCellKind.Boolean) return String(value.data ?? "");
  return String(value.data ?? "");
}

// 抽取数字编辑值。
function extractEditableNumber(value: EditableGridCell): number | undefined {
  if (value.kind === GridCellKind.Number) {
    return typeof value.data === "number" && Number.isFinite(value.data) ? value.data : undefined;
  }
  const text = extractEditableString(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
