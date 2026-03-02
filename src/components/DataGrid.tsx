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
import { HeaderMetaPopover } from "./DateGrid/components/HeaderMetaPopover";
import { RowContextMenu } from "./DateGrid/components/RowContextMenu";
import {
  addUtcMonths,
  buildSalesforceCalendarCells,
  buildUtcDate,
  buildUtcDateFromDateLiteral,
  buildYearOptions,
  extractDatePartFromDatetimeLocal,
  extractTimePartFromDatetimeLocal,
  getCurrentTimeHm,
  getTodayDateLiteral,
  getTodayUtcDate,
  normalizeDateDisplayValue,
  normalizeDateInputValue,
  normalizeDateValueForSave,
  normalizeDatetimeDisplayValue,
  normalizeDatetimeLocalInputValue,
  normalizeDatetimeValueForSave,
  normalizeTimeHm,
  resolveSalesforceTimezone,
  SALESFORCE_MONTH_OPTIONS,
  SALESFORCE_WEEKDAY_LABELS,
  SalesforceCalendarCell,
  startOfUtcMonth
} from "./DateGrid/utils/datetime";
import {
  getFieldType,
  isBooleanType,
  isCellEditableByMeta,
  isDateTimeType,
  isDateType,
  isNumberType,
  isPicklistType,
  isRequiredOnCreate
} from "./DateGrid/utils/field";
import {
  getPicklistEditorOptions,
  isPicklistNullable,
  normalizePicklistValue,
  PICKLIST_NONE_VALUE,
  resolvePicklistDisplayText
} from "./DateGrid/utils/picklist";
import {
  coerceNumber,
  extractEditableNumber,
  extractEditableString,
  isEmptyValue,
  normalizeBooleanText,
  normalizeSelectValue,
  stringifyCellValue
} from "./DateGrid/utils/value";
import { HoveredHeaderMetaState, RowContextMenuState } from "./DateGrid/types";
import { QueryResult } from "../types";
import {
  buildDisplayMetadataFromRaw
} from "../utils/fieldMetadata";

type Props = {
  result: QueryResult;
  visibleColumns: string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  dirtyCellKeys: string[];
  selectedRecordIds: string[];
  // Salesforce 当前用户时区（IANA），用于 datetime 与 Salesforce Web 行为对齐。
  salesforceTimezone?: string | null;
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
  salesforceTimezone,
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
  // 仅在时区字符串合法时启用 Salesforce 用户时区；非法值自动回退浏览器本地时区。
  const effectiveSalesforceTimezone = useMemo(
    () => resolveSalesforceTimezone(salesforceTimezone),
    [salesforceTimezone]
  );

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
  // 行右键菜单状态：记录菜单坐标、目标记录信息与可执行动作能力。
  const [rowContextMenu, setRowContextMenu] = useState<RowContextMenuState | null>(null);

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
  const [hoveredHeaderMeta, setHoveredHeaderMeta] = useState<HoveredHeaderMetaState | null>(null);
  // 鼠标是否位于元数据浮层内：用于支持从表头移动到浮层并滚动。
  const [metaPanelHovering, setMetaPanelHovering] = useState(false);
  // 当前激活单元格：用于 provideEditor 判断是否为 picklist 编辑。
  const [activeEditorCell, setActiveEditorCell] = useState<Item | null>(null);
  const activeEditorCellRef = useRef<Item | null>(null);

  const columns = useMemo<GridColumn[]>(() => {
    const dataColumns: GridColumn[] = displayColumns.map((column) => ({
      id: column,
      // 数据列标题由 drawHeader 自定义双行绘制，这里留空避免默认文案覆盖。
      title: "",
      width: columnWidths[column] ?? (column === "Id" ? 280 : 180)
    }));

    return [
      ...(showSelectionColumn ? [{ id: "__select", title: "", width: columnWidths.__select ?? 44 }] : []),
      { id: "__index", title: "#", width: columnWidths.__index ?? 56 },
      ...dataColumns
    ];
  }, [displayColumns, fieldMetadataMap, columnWidths, showSelectionColumn]);

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

    if (isDateType(fieldType)) {
      const text = normalizeDateDisplayValue(raw);
      return {
        kind: GridCellKind.Text,
        // date 单元格展示与提交统一为 Salesforce 日期格式（YYYY-MM-DD）。
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (isDateTimeType(fieldType)) {
      const text = normalizeDatetimeDisplayValue(raw, effectiveSalesforceTimezone);
      return {
        kind: GridCellKind.Text,
        // datetime 单元格展示为 Salesforce 日期时间格式（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
        data: text,
        displayData: text,
        allowOverlay: editable,
        readonly: !editable,
        themeOverride: commonTheme
      };
    }

    if (isPicklistType(fieldType)) {
      const options = getPicklistEditorOptions(metadata);
      const value = normalizePicklistValue(raw);
      const displayText = resolvePicklistDisplayText(value, options);
      return {
        kind: GridCellKind.Text,
        // picklist 单元格保留 value 作为真实值，提交时按 value/null 写回后端。
        data: value,
        // 单元格显示统一改为 label，满足数据库工具预期阅读体验。
        displayData: displayText,
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
      const options = getPicklistEditorOptions(metadata);
      const nextText = extractEditableString(newValue);
      if (!options.some((item) => item.value === nextText)) {
        onShowMessage(`${columnId} 字段只能选择预设选项。`);
        return;
      }
      if (nextText === PICKLIST_NONE_VALUE && isPicklistNullable(metadata)) {
        onEditCell(row, columnId, null);
        return;
      }
      onEditCell(row, columnId, nextText);
      return;
    }

    if (isDateType(fieldType)) {
      const nextText = extractEditableString(newValue).trim();
      if (!nextText) {
        if (metadata.nillable === true) {
          onEditCell(row, columnId, null);
          return;
        }
        onShowMessage(`${columnId} 字段不允许为空。`);
        return;
      }

      const normalizedDate = normalizeDateValueForSave(nextText);
      if (!normalizedDate) {
        onShowMessage(`${columnId} 字段仅支持日期格式（YYYY-MM-DD）。`);
        return;
      }

      onEditCell(row, columnId, normalizedDate);
      return;
    }

    if (isDateTimeType(fieldType)) {
      const nextText = extractEditableString(newValue).trim();
      if (!nextText) {
        if (metadata.nillable === true) {
          onEditCell(row, columnId, null);
          return;
        }
        onShowMessage(`${columnId} 字段不允许为空。`);
        return;
      }

      const normalizedDatetime = normalizeDatetimeValueForSave(nextText, effectiveSalesforceTimezone);
      if (!normalizedDatetime) {
        onShowMessage(`${columnId} 字段仅支持日期时间格式。`);
        return;
      }

      onEditCell(row, columnId, normalizedDatetime);
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
      const options = getPicklistEditorOptions(metadata);
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

  // 打开 Salesforce 记录页：后端校验 token 后直接打开系统浏览器。
  async function openRecordPageFromMenu() {
    if (!rowContextMenu) return;
    const { recordId } = rowContextMenu;
    setRowContextMenu(null); // 立即关闭菜单，避免等待后端响应期间 UI 无反馈。
    if (!sourceId || !objectName) {
      onShowMessage("当前上下文缺少 sourceId/objectName，无法打开 Salesforce 记录页。");
      return;
    }
    if (!recordId) {
      onShowMessage("当前行没有可用的记录 Id。");
      return;
    }
    try {
      await api.openRecordPage(sourceId, objectName, recordId);
    } catch (error) {
      onShowMessage(`打开 Salesforce 记录页失败：${String(error)}`);
    }
  }

  // 复制当前右键单元格数据：优先使用现代剪贴板 API，失败时回退 execCommand。
  async function copyCellValueFromMenu() {
    if (!rowContextMenu) return;
    const text = rowContextMenu.cellText;
    try {
      await navigator.clipboard.writeText(text); // 优先使用现代剪贴板 API。
    } catch {
      // 回退方案：兼容剪贴板权限受限场景。
      const textarea = document.createElement("textarea");
      textarea.value = text;
      textarea.style.position = "fixed";
      textarea.style.opacity = "0";
      document.body.appendChild(textarea);
      textarea.focus();
      textarea.select();
      document.execCommand("copy");
      document.body.removeChild(textarea);
    } finally {
      setRowContextMenu(null); // 执行后关闭菜单。
    }
  }

  // 右键菜单动作：将可空字段设置为 null（UI 文案显示为 None）。
  function setCellNoneFromMenu() {
    if (!rowContextMenu) return;
    if (!rowContextMenu.canSetNone) return;
    onEditCell(rowContextMenu.rowIndex, rowContextMenu.columnId, null);
    setRowContextMenu(null); // 执行后关闭菜单，避免重复点击。
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
          onCellActivated={(cell) => {
            activeEditorCellRef.current = cell; // ref 同步写入，避免 setState 异步导致 provideEditor 读到旧值。
            setActiveEditorCell(cell);
          }}
          // 单元格提交编辑时的单点更新处理。
          onCellEdited={handleCellEdited}
          // 单元格点击事件：用于双击编辑提示等交互。
          onCellClicked={handleCellClicked}
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
          onCellsEdited={handleCellsEdited}
          // 使用 Glide 内置 overlay 机制渲染 picklist 编辑器，避免手工定位。
          provideEditor={(cell) => {
            const editorCell = activeEditorCellRef.current || activeEditorCell;
            if (!editorCell) return undefined;
            if (cell.kind !== GridCellKind.Text) return undefined;

            const [col] = editorCell;
            const columnId = String(columns[col]?.id ?? "");
            if (!columnId || columnId.startsWith("__")) return undefined;

            const metadata = fieldMetadataMap[columnId] || {};
            const fieldType = getFieldType(metadata);

            // picklist/boolean 使用下拉；date/datetime 使用 Salesforce 风格日历面板。
            let editorKind: "select" | "date" | "datetime-local" | null = null;
            let options: { label: string; value: string }[] = [];
            if (isPicklistType(fieldType)) {
              editorKind = "select";
              options = getPicklistEditorOptions(metadata);
            } else if (isBooleanType(fieldType)) {
              editorKind = "select";
              options = [
                { label: "true", value: "true" },
                { label: "false", value: "false" }
              ];
            } else if (isDateType(fieldType)) {
              editorKind = "date";
            } else if (isDateTimeType(fieldType)) {
              editorKind = "datetime-local";
            } else {
              return undefined;
            }

            return (props) => {
              const textValue = props.value as TextCell;
              const currentText = String(textValue.data ?? "");
              const nillable = metadata.nillable === true;
              const initialDatetimeLocal = normalizeDatetimeLocalInputValue(currentText, effectiveSalesforceTimezone);
              const initialDate = editorKind === "date"
                ? normalizeDateInputValue(currentText)
                : extractDatePartFromDatetimeLocal(initialDatetimeLocal);
              const [draftDate, setDraftDate] = useState(initialDate);
              const [draftTime, setDraftTime] = useState(extractTimePartFromDatetimeLocal(initialDatetimeLocal));
              const [viewMonthStart, setViewMonthStart] = useState(() => {
                const selected = buildUtcDateFromDateLiteral(initialDate);
                return startOfUtcMonth(selected || getTodayUtcDate(effectiveSalesforceTimezone));
              });
              const viewMonthYear = viewMonthStart.getUTCFullYear();
              const viewMonth = viewMonthStart.getUTCMonth();
              const yearOptions = useMemo(() => buildYearOptions(viewMonthYear, 8), [viewMonthYear]);
              const calendarCells = useMemo(
                () => buildSalesforceCalendarCells(viewMonthStart, draftDate, getTodayDateLiteral(effectiveSalesforceTimezone)),
                [viewMonthStart, draftDate, effectiveSalesforceTimezone]
              );

              const commitEditorValue = (next: string) => {
                const nextCell: TextCell = {
                  ...textValue,
                  data: next,
                  displayData: next
                };
                props.onChange(nextCell);
                props.onFinishedEditing(nextCell, [0, 0]);
              };

              const confirmDateEditor = () => {
                if (!draftDate && !nillable) {
                  onShowMessage(`${columnId} 字段不允许为空。`);
                  return;
                }
                if (!draftDate && nillable) {
                  commitEditorValue("");
                  return;
                }
                if (editorKind === "date") {
                  commitEditorValue(draftDate);
                  return;
                }
                const normalizedTime = normalizeTimeHm(draftTime);
                commitEditorValue(`${draftDate}T${normalizedTime}`);
              };

              const handlePickDate = (dateLiteral: string) => {
                setDraftDate(dateLiteral); // 点击日期仅更新草稿，不立即提交。
                const selectedDate = buildUtcDateFromDateLiteral(dateLiteral);
                if (!selectedDate) return;
                if (selectedDate.getUTCMonth() !== viewMonth || selectedDate.getUTCFullYear() !== viewMonthYear) {
                  setViewMonthStart(startOfUtcMonth(selectedDate)); // 跨月点击时同步翻页，保持视觉连续。
                }
              };

              const handlePickToday = () => {
                const todayLiteral = getTodayDateLiteral(effectiveSalesforceTimezone);
                handlePickDate(todayLiteral);
                if (editorKind === "datetime-local" && !draftTime) {
                  setDraftTime(getCurrentTimeHm(effectiveSalesforceTimezone)); // datetime 默认补齐当前时分，减少手动输入。
                }
              };

              const handleClearDraft = () => {
                setDraftDate("");
                if (editorKind === "datetime-local") {
                  setDraftTime("00:00");
                }
              };

              return editorKind === "select" ? (
                <select
                  autoFocus
                  className="select select-bordered select-sm w-full bg-base-100"
                  style={{ minWidth: Math.max(props.target.width, 180) }}
                  value={normalizeSelectValue(currentText, options)}
                  onBlur={() => props.onFinishedEditing(undefined, [0, 0])}
                  onChange={(event) => {
                    const next = String(event.target.value);
                    const displayText = resolvePicklistDisplayText(next, options);
                    const nextCell: TextCell = {
                      ...textValue,
                      data: next,
                      displayData: displayText
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
              ) : (
                <div
                  className="rounded-[6px] border border-base-300 bg-base-100 p-2 shadow-xl"
                  style={{ width: Math.max(props.target.width, 280) }}
                  onMouseDown={(event) => event.stopPropagation()}
                >
                      {/* 头部月份导航：仿 Salesforce DatePicker 的前后切换与年月选择。 */}
                      <div className="mb-2 flex items-center justify-between gap-1">
                        <button
                          className="btn btn-ghost btn-xs h-7 min-h-7 w-7 p-0 text-[16px] leading-none"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setViewMonthStart((current) => addUtcMonths(current, -1))}
                          aria-label="上个月"
                        >
                          &lsaquo;
                        </button>
                        <div className="flex items-center gap-1">
                          <select
                            className="select select-bordered select-xs h-7 min-h-7 w-[78px]"
                            value={String(viewMonthYear)}
                            onChange={(event) => {
                              const nextYear = Number(event.target.value);
                              if (!Number.isInteger(nextYear)) return;
                              setViewMonthStart(buildUtcDate(nextYear, viewMonth, 1));
                            }}
                          >
                            {yearOptions.map((year) => (
                              <option key={year} value={year}>
                                {year}
                              </option>
                            ))}
                          </select>
                          <select
                            className="select select-bordered select-xs h-7 min-h-7"
                            value={String(viewMonth)}
                            onChange={(event) => {
                              const nextMonth = Number(event.target.value);
                              if (!Number.isInteger(nextMonth)) return;
                              setViewMonthStart(buildUtcDate(viewMonthYear, nextMonth, 1));
                            }}
                          >
                            {SALESFORCE_MONTH_OPTIONS.map((item) => (
                              <option key={item.value} value={item.value}>
                                {item.label}
                              </option>
                            ))}
                          </select>
                        </div>
                        <button
                          className="btn btn-ghost btn-xs h-7 min-h-7 w-7 p-0 text-[16px] leading-none"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={() => setViewMonthStart((current) => addUtcMonths(current, 1))}
                          aria-label="下个月"
                        >
                          &rsaquo;
                        </button>
                      </div>

                      {/* 星期标题行：保持 Salesforce 常见紧凑排布。 */}
                      <div className="mb-1 grid grid-cols-7 gap-y-0.5 px-1">
                        {SALESFORCE_WEEKDAY_LABELS.map((label) => (
                          <div key={label} className="text-center text-[11px] font-semibold text-neutral/60">
                            {label}
                          </div>
                        ))}
                      </div>

                      {/* 日期网格：点击仅选择日期，不会立即提交。 */}
                      <div className="grid grid-cols-7 gap-y-0.5 px-1">
                        {calendarCells.map((cellItem) => (
                          <button
                            key={cellItem.key}
                            className={buildSalesforceDayButtonClassName(cellItem)}
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => handlePickDate(cellItem.dateLiteral)}
                          >
                            {cellItem.day}
                          </button>
                        ))}
                      </div>

                      {/* datetime 模式补充时间输入，贴近 Salesforce 的“先选日期再选时间”行为。 */}
                      {editorKind === "datetime-local" && (
                        <div className="mt-2">
                          <label className="mb-1 block text-[11px] font-semibold text-neutral/70">Time</label>
                          <input
                            autoFocus
                            type="time"
                            step={60}
                            className="input input-bordered input-sm h-8 min-h-8 w-full bg-base-100"
                            value={normalizeTimeHm(draftTime)}
                            onChange={(event) => {
                              setDraftTime(String(event.target.value ?? ""));
                            }}
                          />
                        </div>
                      )}

                      {/* 底部动作区：显式确认/取消，避免“点一天即提交”。 */}
                      <div className="mt-2 flex items-center justify-between gap-1.5 border-t border-base-300 pt-2">
                        <button
                          className="btn btn-link btn-xs px-1 text-primary"
                          onMouseDown={(event) => event.preventDefault()}
                          onClick={handlePickToday}
                        >
                          Today
                        </button>
                        {nillable && (
                          <button
                            className="btn btn-ghost btn-xs"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={handleClearDraft}
                          >
                            清空
                          </button>
                        )}
                        <div className="ml-auto flex items-center gap-1.5">
                          <button
                            className="btn btn-ghost btn-xs"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={() => props.onFinishedEditing(undefined, [0, 0])}
                          >
                            取消
                          </button>
                          <button
                            className="btn btn-primary btn-xs"
                            onMouseDown={(event) => event.preventDefault()}
                            onClick={confirmDateEditor}
                          >
                            确认
                          </button>
                        </div>
                      </div>
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
              // 业务字段表头：第一行显示 Field Name，第二行显示 Label（小字浅色）。
              drawFieldHeaderText(args.ctx, args.rect, columnId, fieldMetadataMap[columnId] || {}, showHeaderMetadata);
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
            onCopyCell={() => {
              void copyCellValueFromMenu();
            }}
            onSetNone={() => {
              setCellNoneFromMenu();
            }}
            onOpenRecordPage={() => {
              void openRecordPageFromMenu();
            }}
            canOpenRecordPage={Boolean(sourceId && objectName && rowContextMenu.recordId)}
          />
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

// 日历日期按钮样式：贴近 Salesforce 轻量化视觉（当前月、今天、选中态）。
function buildSalesforceDayButtonClassName(cellItem: SalesforceCalendarCell): string {
  const base = "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[12px] leading-none transition-colors";
  if (cellItem.isSelected) {
    return `${base} bg-primary text-primary-content shadow-sm`;
  }
  if (cellItem.isToday) {
    return `${base} border border-primary/70 text-primary`;
  }
  if (!cellItem.inCurrentMonth) {
    return `${base} text-neutral/30 hover:bg-base-200`;
  }
  return `${base} text-neutral hover:bg-base-200`;
}

// 绘制字段表头双行文案：第一行 Field Name，第二行 Label（小字浅色）。
function drawFieldHeaderText(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  fieldName: string,
  metadata: Record<string, unknown>,
  showHeaderMetadata: boolean
) {
  const labelRaw = metadata.label;
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const hasSecondLine = Boolean(label) && label !== fieldName;
  const textLeft = rect.x + 8;
  const textRightPadding = showHeaderMetadata ? 24 : 8; // 预留 info icon 空间，避免文本重叠。
  const maxWidth = Math.max(16, rect.width - textRightPadding - 8);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
  ctx.clip();

  if (hasSecondLine) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f3a4a";
    ctx.font = "600 12px sans-serif";
    ctx.fillText(fieldName, textLeft, rect.y + 14, maxWidth);

    ctx.fillStyle = "#8b97a6";
    ctx.font = "500 11px sans-serif";
    ctx.fillText(label, textLeft, rect.y + 30, maxWidth);
  } else {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f3a4a";
    ctx.font = "600 12px sans-serif";
    ctx.fillText(fieldName, textLeft, rect.y + rect.height / 2, maxWidth);
  }

  ctx.restore();
}
