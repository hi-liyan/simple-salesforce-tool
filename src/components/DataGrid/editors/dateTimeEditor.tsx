import { useMemo, useState } from "react";
import { GridCell, TextCell } from "@glideapps/glide-data-grid";
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
  normalizeDateInputValue,
  normalizeDatetimeLocalInputValue,
  normalizeTimeHm,
  SALESFORCE_MONTH_OPTIONS,
  SALESFORCE_WEEKDAY_LABELS,
  startOfUtcMonth
} from "../utils/datetime";

type DateTimeEditorProps = {
  // Glide 提供的编辑器上下文参数。
  editorProps: {
    value: GridCell;
    target: { width: number };
    onChange: (newValue: GridCell) => void;
    onFinishedEditing: (
      newValue?: GridCell,
      movement?: readonly [-1 | 0 | 1, -1 | 0 | 1]
    ) => void;
  };
  // 字段名：用于错误提示文案。
  columnId: string;
  // 编辑器类型：date 或 datetime-local。
  editorKind: "date" | "datetime-local";
  // 字段是否可空。
  nillable: boolean;
  // Salesforce 用户时区。
  effectiveSalesforceTimezone: string | null;
  // 用户提示回调。
  onShowMessage: (message: string) => void;
};

// Salesforce 风格日期/日期时间编辑器。
export function DateTimeEditor({
  editorProps,
  columnId,
  editorKind,
  nillable,
  effectiveSalesforceTimezone,
  onShowMessage
}: DateTimeEditorProps) {
  const textValue = editorProps.value as TextCell;
  const currentText = String(textValue.data ?? "");
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
    editorProps.onChange(nextCell); // 同步更新 Glide overlay 内的草稿值。
    editorProps.onFinishedEditing(nextCell, [0, 0]); // 立即提交并关闭编辑器。
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

  return (
    <div
      className="rounded-[6px] border border-base-300 bg-base-100 p-2 shadow-xl"
      style={{ width: Math.max(editorProps.target.width, 280) }}
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
            className={buildSalesforceDayButtonClassName(cellItem.isSelected, cellItem.isToday, cellItem.inCurrentMonth)}
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
              setDraftTime(String(event.target.value ?? "")); // 时间输入仅更新草稿。
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
            onClick={() => editorProps.onFinishedEditing(undefined, [0, 0])}
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
}

// 日历日期按钮样式：贴近 Salesforce 轻量化视觉（当前月、今天、选中态）。
function buildSalesforceDayButtonClassName(
  isSelected: boolean,
  isToday: boolean,
  inCurrentMonth: boolean
): string {
  const base = "mx-auto flex h-8 w-8 items-center justify-center rounded-full text-[12px] leading-none transition-colors";
  if (isSelected) {
    return `${base} bg-primary text-primary-content shadow-sm`;
  }
  if (isToday) {
    return `${base} border border-primary/70 text-primary`;
  }
  if (!inCurrentMonth) {
    return `${base} text-neutral/30 hover:bg-base-200`;
  }
  return `${base} text-neutral hover:bg-base-200`;
}
