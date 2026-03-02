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
  // 行右键菜单状态：记录菜单坐标、目标记录 Id 与当前单元格文本。
  const [rowContextMenu, setRowContextMenu] = useState<{ x: number; y: number; recordId: string; cellText: string } | null>(null);

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
  const activeEditorCellRef = useRef<Item | null>(null);

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
            if (!sourceId || !objectName) return; // 缺少对象上下文时不展示“打开记录页”菜单。
            const [col, row] = cell;
            const record = records[row] || {};
            const recordId = String(record.Id ?? "").trim();
            if (!recordId) return; // 无真实记录 Id（如新建行）时不展示菜单。
            const columnId = String(columns[col]?.id ?? "");
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
              cellText
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
                void copyCellValueFromMenu(); // 复制当前单元格数据并关闭菜单。
              }}
            >
              复制
            </button>
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

// 判断 date 字段类型。
function isDateType(fieldType: string): boolean {
  return fieldType === "date";
}

// 判断 datetime 字段类型。
function isDateTimeType(fieldType: string): boolean {
  return fieldType === "datetime";
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

const PICKLIST_NONE_VALUE = "";
const PICKLIST_NONE_LABEL = "-- None --";

// 判断 picklist 字段是否允许为空。
function isPicklistNullable(metadata: Record<string, unknown>): boolean {
  return metadata.nillable === true;
}

// picklist 编辑器选项：可空字段在首位注入“-- None --”。
function getPicklistEditorOptions(metadata: Record<string, unknown>): { label: string; value: string }[] {
  const options = getPicklistOptions(metadata);
  if (!isPicklistNullable(metadata)) return options;
  return [{ label: PICKLIST_NONE_LABEL, value: PICKLIST_NONE_VALUE }, ...options];
}

// 统一 picklist 单元格值为字符串，null/undefined 视为空值。
function normalizePicklistValue(value: unknown): string {
  if (value === null || value === undefined) return PICKLIST_NONE_VALUE;
  return String(value);
}

// 按 value 找到可读 label；若未匹配则回退显示原值。
function resolvePicklistDisplayText(raw: string, options: { label: string; value: string }[]): string {
  const matched = options.find((item) => item.value === raw);
  if (matched) return matched.label;
  return raw;
}

const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
const SALESFORCE_TIMEZONE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?([+-]\d{4})$/;
const SALESFORCE_DATETIME_OUTPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/;
const SALESFORCE_WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
const SALESFORCE_MONTH_OPTIONS = [
  { value: 0, label: "1月" },
  { value: 1, label: "2月" },
  { value: 2, label: "3月" },
  { value: 3, label: "4月" },
  { value: 4, label: "5月" },
  { value: 5, label: "6月" },
  { value: 6, label: "7月" },
  { value: 7, label: "8月" },
  { value: 8, label: "9月" },
  { value: 9, label: "10月" },
  { value: 10, label: "11月" },
  { value: 11, label: "12月" }
];

// 解析并校验 Salesforce 时区（IANA），无效时返回 null。
function resolveSalesforceTimezone(value?: string | null): string | null {
  if (!value) return null;
  const timezone = value.trim();
  if (!timezone) return null;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(new Date());
    return timezone;
  } catch {
    return null;
  }
}

// Salesforce 风格日历单元格结构。
type SalesforceCalendarCell = {
  key: string;
  day: number;
  dateLiteral: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
};

// date 编辑值规范化：统一输出 YYYY-MM-DD。
function normalizeDateValueForSave(raw: string): string | null {
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const dateLiteral = extractDateLiteral(raw);
  if (dateLiteral) return dateLiteral;
  const parsed = parseDateForInput(raw);
  if (!parsed) return null;
  return formatDateAsUtcYmd(parsed);
}

// datetime 编辑值规范化：统一输出 Salesforce 日期时间格式（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
function normalizeDatetimeValueForSave(raw: string, salesforceTimezone?: string | null): string | null {
  if (SALESFORCE_DATETIME_OUTPUT_PATTERN.test(raw)) return raw;
  const parsed = parseDatetimeForInput(raw, salesforceTimezone);
  if (!parsed) return null;
  return formatDateAsSalesforceDatetime(parsed);
}

// date 输入框值规范化：无法识别时回退空字符串，避免浏览器控件报错。
function normalizeDateInputValue(raw: string): string {
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const dateLiteral = extractDateLiteral(raw);
  if (dateLiteral) return dateLiteral;
  const parsed = parseDateForInput(raw);
  if (!parsed) return "";
  return formatDateAsUtcYmd(parsed);
}

// date 单元格显示值规范化：优先固定为 Salesforce 日期格式（YYYY-MM-DD）。
function normalizeDateDisplayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).trim();
  if (!text) return "";
  const normalized = normalizeDateInputValue(text);
  return normalized || text;
}

// datetime 单元格显示值规范化：按 Salesforce 用户时区输出。
function normalizeDatetimeDisplayValue(raw: unknown, salesforceTimezone?: string | null): string {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).trim();
  if (!text) return "";
  const parsed = parseDatetimeForInput(text, salesforceTimezone);
  if (!parsed) return text;
  const timezone = resolveSalesforceTimezone(salesforceTimezone);
  // 展示层优先按 Salesforce 用户时区输出；不可用时回退浏览器本地时区。
  if (timezone) {
    return formatDateAsTimeZoneOffsetDatetime(parsed, timezone);
  }
  return formatDateAsLocalOffsetDatetime(parsed);
}

// datetime-local 输入框值规范化：统一为 YYYY-MM-DDTHH:mm。
function normalizeDatetimeLocalInputValue(raw: string, salesforceTimezone?: string | null): string {
  const parsed = parseDatetimeForInput(raw, salesforceTimezone);
  if (!parsed) return "";
  const timezone = resolveSalesforceTimezone(salesforceTimezone);
  if (timezone) {
    return formatDateAsTimeZoneDatetimeMinute(parsed, timezone);
  }
  return formatDateAsLocalDatetimeMinute(parsed);
}

// 从 datetime-local 文本中提取日期部分（YYYY-MM-DD）。
function extractDatePartFromDatetimeLocal(raw: string): string {
  const splitIndex = raw.indexOf("T");
  if (splitIndex <= 0) return "";
  return raw.slice(0, splitIndex);
}

// 从 datetime-local 文本中提取时间部分（HH:mm），默认回退 00:00。
function extractTimePartFromDatetimeLocal(raw: string): string {
  const splitIndex = raw.indexOf("T");
  if (splitIndex < 0) return "00:00";
  const rawTime = raw.slice(splitIndex + 1).trim();
  if (!rawTime) return "00:00";
  return normalizeTimeHm(rawTime);
}

// 解析 date 文本：优先原生 Date，失败时尝试从 datetime 字符串提取日期。
function parseDateForInput(raw: string): Date | null {
  if (!raw) return null;
  const dateLiteral = extractDateLiteral(raw);
  if (dateLiteral) {
    return buildUtcDateFromDateLiteral(dateLiteral);
  }
  const direct = new Date(raw);
  if (Number.isFinite(direct.getTime())) return direct;
  const parsedDatetime = parseDatetimeForInput(raw);
  return parsedDatetime;
}

// 解析 datetime 文本：兼容 datetime-local 与 Salesforce 返回格式（+0800 时区）。
function parseDatetimeForInput(raw: string, salesforceTimezone?: string | null): Date | null {
  if (!raw) return null;
  const timezone = resolveSalesforceTimezone(salesforceTimezone);

  if (DATETIME_LOCAL_PATTERN.test(raw)) {
    if (timezone) {
      const localDatetime = splitDatetimeLocal(raw);
      if (localDatetime) {
        const timezoneDate = buildDateFromTimeZoneLocal(localDatetime.dateLiteral, localDatetime.timeHm, timezone);
        if (timezoneDate) return timezoneDate;
      }
    }
    const browserLocalDate = new Date(raw);
    if (Number.isFinite(browserLocalDate.getTime())) return browserLocalDate;
  }

  const nativeParsed = new Date(raw);
  if (Number.isFinite(nativeParsed.getTime())) return nativeParsed;

  const sfMatch = raw.match(SALESFORCE_TIMEZONE_PATTERN);
  if (!sfMatch) return null;
  const [, datePart, timePart, msPart = "", timezonePart] = sfMatch;
  const timezoneWithColon = `${timezonePart.slice(0, 3)}:${timezonePart.slice(3)}`;
  const normalized = `${datePart}T${timePart}${msPart}${timezoneWithColon}`;
  const parsed = new Date(normalized);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

// 从输入字符串中提取日期字面量（YYYY-MM-DD）。
function extractDateLiteral(raw: string): string | null {
  const match = raw.match(/^(\d{4}-\d{2}-\d{2})/);
  if (!match) return null;
  const dateLiteral = match[1];
  return DATE_ONLY_PATTERN.test(dateLiteral) ? dateLiteral : null;
}

// 使用日期字面量构建 UTC Date，避免时区换日导致的日期漂移。
function buildUtcDateFromDateLiteral(dateLiteral: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(dateLiteral)) return null;
  const [yearText, monthText, dayText] = dateLiteral.split("-");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  const parsed = new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed;
}

// UTC 日期格式化（YYYY-MM-DD）。
function formatDateAsUtcYmd(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 本地日期时间格式化（YYYY-MM-DDTHH:mm）。
function formatDateAsLocalDatetimeMinute(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}`;
}

// Salesforce 日期时间格式化（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
function formatDateAsSalesforceDatetime(value: Date): string {
  const year = value.getUTCFullYear();
  const month = String(value.getUTCMonth() + 1).padStart(2, "0");
  const day = String(value.getUTCDate()).padStart(2, "0");
  const hour = String(value.getUTCHours()).padStart(2, "0");
  const minute = String(value.getUTCMinutes()).padStart(2, "0");
  const second = String(value.getUTCSeconds()).padStart(2, "0");
  const millisecond = String(value.getUTCMilliseconds()).padStart(3, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}+0000`;
}

// 本地时区日期时间格式化（YYYY-MM-DDTHH:mm:ss.SSS+0800），用于单元格展示。
function formatDateAsLocalOffsetDatetime(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  const hour = String(value.getHours()).padStart(2, "0");
  const minute = String(value.getMinutes()).padStart(2, "0");
  const second = String(value.getSeconds()).padStart(2, "0");
  const millisecond = String(value.getMilliseconds()).padStart(3, "0");
  const timezoneOffsetMinutes = -value.getTimezoneOffset();
  const sign = timezoneOffsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(timezoneOffsetMinutes);
  const offsetHour = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const offsetMinute = String(absoluteMinutes % 60).padStart(2, "0");
  return `${year}-${month}-${day}T${hour}:${minute}:${second}.${millisecond}${sign}${offsetHour}${offsetMinute}`;
}

// 指定时区日期时间格式化（YYYY-MM-DDTHH:mm:ss.SSS+0800），用于模拟 Salesforce Web 展示。
function formatDateAsTimeZoneOffsetDatetime(value: Date, timeZone: string): string {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  if (!parts) return formatDateAsLocalOffsetDatetime(value);
  const millisecond = String(value.getUTCMilliseconds()).padStart(3, "0");
  const offsetText = getTimeZoneOffsetText(value, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}.${millisecond}${offsetText}`;
}

// 指定时区日期时间格式化（YYYY-MM-DDTHH:mm），用于编辑器初始值。
function formatDateAsTimeZoneDatetimeMinute(value: Date, timeZone: string): string {
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  if (!parts) return formatDateAsLocalDatetimeMinute(value);
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

// 拆分 datetime-local 字符串（YYYY-MM-DDTHH:mm）。
function splitDatetimeLocal(raw: string): { dateLiteral: string; timeHm: string } | null {
  const splitIndex = raw.indexOf("T");
  if (splitIndex <= 0) return null;
  const dateLiteral = raw.slice(0, splitIndex);
  const timeHm = normalizeTimeHm(raw.slice(splitIndex + 1));
  if (!DATE_ONLY_PATTERN.test(dateLiteral)) return null;
  return { dateLiteral, timeHm };
}

// 解析指定时区下的“本地日期时间”并转换为 UTC Date。
function buildDateFromTimeZoneLocal(dateLiteral: string, timeHm: string, timeZone: string): Date | null {
  if (!DATE_ONLY_PATTERN.test(dateLiteral)) return null;
  const [yearText, monthText, dayText] = dateLiteral.split("-");
  const [hourText, minuteText] = normalizeTimeHm(timeHm).split(":");
  const year = Number(yearText);
  const month = Number(monthText);
  const day = Number(dayText);
  const hour = Number(hourText);
  const minute = Number(minuteText);
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(month) ||
    !Number.isInteger(day) ||
    !Number.isInteger(hour) ||
    !Number.isInteger(minute)
  ) {
    return null;
  }

  // 使用迭代法将“目标时区下的本地时间”映射到唯一 UTC 时刻（覆盖夏令时场景）。
  let utcMs = Date.UTC(year, month - 1, day, hour, minute, 0, 0);
  const targetUtcMs = utcMs;
  for (let index = 0; index < 4; index += 1) {
    const parts = getDateTimePartsInTimeZone(new Date(utcMs), timeZone);
    if (!parts) break;
    const projectedUtcMs = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      0,
      0
    );
    const delta = targetUtcMs - projectedUtcMs;
    if (delta === 0) break;
    utcMs += delta;
  }
  const resolved = new Date(utcMs);
  if (!Number.isFinite(resolved.getTime())) return null;
  return resolved;
}

// 获取指定时区下的日期时间分量（全部补零字符串）。
function getDateTimePartsInTimeZone(
  value: Date,
  timeZone: string
): { year: string; month: string; day: string; hour: string; minute: string; second: string } | null {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
    const parts = formatter.formatToParts(value);
    const year = parts.find((item) => item.type === "year")?.value ?? "";
    const month = parts.find((item) => item.type === "month")?.value ?? "";
    const day = parts.find((item) => item.type === "day")?.value ?? "";
    const hour = parts.find((item) => item.type === "hour")?.value ?? "";
    const minute = parts.find((item) => item.type === "minute")?.value ?? "";
    const second = parts.find((item) => item.type === "second")?.value ?? "";
    if (!year || !month || !day || !hour || !minute || !second) return null;
    return {
      year: year.padStart(4, "0"),
      month: month.padStart(2, "0"),
      day: day.padStart(2, "0"),
      hour: hour.padStart(2, "0"),
      minute: minute.padStart(2, "0"),
      second: second.padStart(2, "0")
    };
  } catch {
    return null;
  }
}

// 获取指定时区相对于 UTC 的偏移文本（+0800 / -0700）。
function getTimeZoneOffsetText(value: Date, timeZone: string): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZoneName: "shortOffset"
    });
    const offsetPart = formatter
      .formatToParts(value)
      .find((item) => item.type === "timeZoneName")
      ?.value;
    if (offsetPart) {
      const matched = offsetPart.match(/^GMT([+-])(\d{1,2})(?::?(\d{2}))?$/i);
      if (matched) {
        const sign = matched[1];
        const hour = String(Number(matched[2] || "0")).padStart(2, "0");
        const minute = String(Number(matched[3] || "0")).padStart(2, "0");
        return `${sign}${hour}${minute}`;
      }
      if (/^GMT|^UTC$/i.test(offsetPart)) {
        return "+0000";
      }
    }
  } catch {
    // ignored
  }

  // 兜底：使用时区分量反推偏移分钟数。
  const parts = getDateTimePartsInTimeZone(value, timeZone);
  if (!parts) {
    const timezoneOffsetMinutes = -value.getTimezoneOffset();
    return formatOffsetFromMinutes(timezoneOffsetMinutes);
  }
  const projectedUtcMs = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
    value.getUTCMilliseconds()
  );
  const offsetMinutes = Math.round((projectedUtcMs - value.getTime()) / 60000);
  return formatOffsetFromMinutes(offsetMinutes);
}

// 偏移分钟转 Salesforce 偏移文本。
function formatOffsetFromMinutes(offsetMinutes: number): string {
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absoluteMinutes = Math.abs(offsetMinutes);
  const hour = String(Math.floor(absoluteMinutes / 60)).padStart(2, "0");
  const minute = String(absoluteMinutes % 60).padStart(2, "0");
  return `${sign}${hour}${minute}`;
}

// 构建 UTC 日期对象（month 为 0-11），用于稳定计算日历视图。
function buildUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

// 获取给定日期所在月份的 UTC 月初。
function startOfUtcMonth(value: Date): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth(), 1);
}

// UTC 月份偏移计算（例如 -1 上个月，+1 下个月）。
function addUtcMonths(value: Date, months: number): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, 1);
}

// UTC 天数偏移计算。
function addUtcDays(value: Date, days: number): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days);
}

// 生成年份选项（中心年左右各 spread 年）。
function buildYearOptions(centerYear: number, spread: number): number[] {
  return Array.from({ length: spread * 2 + 1 }, (_, index) => centerYear - spread + index);
}

// 构建 Salesforce 风格月视图网格（6 周 x 7 天）。
function buildSalesforceCalendarCells(
  monthStart: Date,
  selectedDateLiteral: string,
  todayDateLiteral: string
): SalesforceCalendarCell[] {
  const month = monthStart.getUTCMonth();
  const firstWeekday = monthStart.getUTCDay();
  const gridStart = addUtcDays(monthStart, -firstWeekday);
  return Array.from({ length: 42 }, (_, index) => {
    const date = addUtcDays(gridStart, index);
    const dateLiteral = formatDateAsUtcYmd(date);
    return {
      key: `${dateLiteral}:${index}`,
      day: date.getUTCDate(),
      dateLiteral,
      inCurrentMonth: date.getUTCMonth() === month,
      isToday: dateLiteral === todayDateLiteral,
      isSelected: dateLiteral === selectedDateLiteral
    };
  });
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

// 获取今天日期字面量（优先按 Salesforce 用户时区）。
function getTodayDateLiteral(salesforceTimezone?: string | null): string {
  const timezone = resolveSalesforceTimezone(salesforceTimezone);
  const now = new Date();
  if (timezone) {
    const parts = getDateTimePartsInTimeZone(now, timezone);
    if (parts) {
      return `${parts.year}-${parts.month}-${parts.day}`;
    }
  }
  return formatDateAsLocalYmd(now);
}

// 获取今天 UTC 日期对象（便于作为日历初始化兜底值）。
function getTodayUtcDate(salesforceTimezone?: string | null): Date {
  const localToday = getTodayDateLiteral(salesforceTimezone);
  return buildUtcDateFromDateLiteral(localToday) || new Date();
}

// 本地日期格式化（YYYY-MM-DD），用于界面“今天”语义。
function formatDateAsLocalYmd(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

// 标准化时分文本（HH:mm），不合法时回退 00:00。
function normalizeTimeHm(raw: string): string {
  const value = raw.trim();
  const matched = value.match(/^(\d{1,2}):(\d{1,2})/);
  if (!matched) return "00:00";
  const hour = Number(matched[1]);
  const minute = Number(matched[2]);
  if (!Number.isInteger(hour) || !Number.isInteger(minute)) return "00:00";
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return "00:00";
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

// 获取当前时分（HH:mm），优先按 Salesforce 用户时区。
function getCurrentTimeHm(salesforceTimezone?: string | null): string {
  const now = new Date();
  const timezone = resolveSalesforceTimezone(salesforceTimezone);
  if (timezone) {
    const parts = getDateTimePartsInTimeZone(now, timezone);
    if (parts) {
      return `${parts.hour}:${parts.minute}`;
    }
  }
  return `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
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
