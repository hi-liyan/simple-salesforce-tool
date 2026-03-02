// 日期格式匹配：YYYY-MM-DD。
const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
// datetime-local 格式匹配：YYYY-MM-DDTHH:mm(:ss 可选)。
const DATETIME_LOCAL_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/;
// Salesforce datetime 格式匹配：YYYY-MM-DDTHH:mm:ss(.SSS)?+0800。
const SALESFORCE_TIMEZONE_PATTERN = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(\.\d{1,3})?([+-]\d{4})$/;
// Salesforce datetime 标准输出匹配：YYYY-MM-DDTHH:mm:ss.SSS+0000。
const SALESFORCE_DATETIME_OUTPUT_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/;

// 日期面板星期标题。
export const SALESFORCE_WEEKDAY_LABELS = ["Su", "Mo", "Tu", "We", "Th", "Fr", "Sa"];
// 日期面板月份选项（中文）。
export const SALESFORCE_MONTH_OPTIONS = [
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

// Salesforce 风格日历单元格结构。
export type SalesforceCalendarCell = {
  key: string;
  day: number;
  dateLiteral: string;
  inCurrentMonth: boolean;
  isToday: boolean;
  isSelected: boolean;
};

// 解析并校验 Salesforce 时区（IANA），无效时返回 null。
export function resolveSalesforceTimezone(value?: string | null): string | null {
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

// date 编辑值规范化：统一输出 YYYY-MM-DD。
export function normalizeDateValueForSave(raw: string): string | null {
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const dateLiteral = extractDateLiteral(raw);
  if (dateLiteral) return dateLiteral;
  const parsed = parseDateForInput(raw);
  if (!parsed) return null;
  return formatDateAsUtcYmd(parsed);
}

// datetime 编辑值规范化：统一输出 Salesforce 日期时间格式（YYYY-MM-DDTHH:mm:ss.SSS+0000）。
export function normalizeDatetimeValueForSave(raw: string, salesforceTimezone?: string | null): string | null {
  if (SALESFORCE_DATETIME_OUTPUT_PATTERN.test(raw)) return raw;
  const parsed = parseDatetimeForInput(raw, salesforceTimezone);
  if (!parsed) return null;
  return formatDateAsSalesforceDatetime(parsed);
}

// date 输入框值规范化：无法识别时回退空字符串，避免浏览器控件报错。
export function normalizeDateInputValue(raw: string): string {
  if (DATE_ONLY_PATTERN.test(raw)) return raw;
  const dateLiteral = extractDateLiteral(raw);
  if (dateLiteral) return dateLiteral;
  const parsed = parseDateForInput(raw);
  if (!parsed) return "";
  return formatDateAsUtcYmd(parsed);
}

// date 单元格显示值规范化：优先固定为 Salesforce 日期格式（YYYY-MM-DD）。
export function normalizeDateDisplayValue(raw: unknown): string {
  if (raw === null || raw === undefined) return "";
  const text = String(raw).trim();
  if (!text) return "";
  const normalized = normalizeDateInputValue(text);
  return normalized || text;
}

// datetime 单元格显示值规范化：按 Salesforce 用户时区输出。
export function normalizeDatetimeDisplayValue(raw: unknown, salesforceTimezone?: string | null): string {
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
export function normalizeDatetimeLocalInputValue(raw: string, salesforceTimezone?: string | null): string {
  const parsed = parseDatetimeForInput(raw, salesforceTimezone);
  if (!parsed) return "";
  const timezone = resolveSalesforceTimezone(salesforceTimezone);
  if (timezone) {
    return formatDateAsTimeZoneDatetimeMinute(parsed, timezone);
  }
  return formatDateAsLocalDatetimeMinute(parsed);
}

// 从 datetime-local 文本中提取日期部分（YYYY-MM-DD）。
export function extractDatePartFromDatetimeLocal(raw: string): string {
  const splitIndex = raw.indexOf("T");
  if (splitIndex <= 0) return "";
  return raw.slice(0, splitIndex);
}

// 从 datetime-local 文本中提取时间部分（HH:mm），默认回退 00:00。
export function extractTimePartFromDatetimeLocal(raw: string): string {
  const splitIndex = raw.indexOf("T");
  if (splitIndex < 0) return "00:00";
  const rawTime = raw.slice(splitIndex + 1).trim();
  if (!rawTime) return "00:00";
  return normalizeTimeHm(rawTime);
}

// 使用日期字面量构建 UTC Date，避免时区换日导致的日期漂移。
export function buildUtcDateFromDateLiteral(dateLiteral: string): Date | null {
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

// 构建 UTC 日期对象（month 为 0-11），用于稳定计算日历视图。
export function buildUtcDate(year: number, month: number, day: number): Date {
  return new Date(Date.UTC(year, month, day, 0, 0, 0, 0));
}

// 获取给定日期所在月份的 UTC 月初。
export function startOfUtcMonth(value: Date): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth(), 1);
}

// UTC 月份偏移计算（例如 -1 上个月，+1 下个月）。
export function addUtcMonths(value: Date, months: number): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth() + months, 1);
}

// 生成年份选项（中心年左右各 spread 年）。
export function buildYearOptions(centerYear: number, spread: number): number[] {
  return Array.from({ length: spread * 2 + 1 }, (_, index) => centerYear - spread + index);
}

// 构建 Salesforce 风格月视图网格（6 周 x 7 天）。
export function buildSalesforceCalendarCells(
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

// 获取今天日期字面量（优先按 Salesforce 用户时区）。
export function getTodayDateLiteral(salesforceTimezone?: string | null): string {
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
export function getTodayUtcDate(salesforceTimezone?: string | null): Date {
  const localToday = getTodayDateLiteral(salesforceTimezone);
  return buildUtcDateFromDateLiteral(localToday) || new Date();
}

// 标准化时分文本（HH:mm），不合法时回退 00:00。
export function normalizeTimeHm(raw: string): string {
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
export function getCurrentTimeHm(salesforceTimezone?: string | null): string {
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

// UTC 天数偏移计算。
function addUtcDays(value: Date, days: number): Date {
  return buildUtcDate(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate() + days);
}

// 本地日期格式化（YYYY-MM-DD），用于界面“今天”语义。
function formatDateAsLocalYmd(value: Date): string {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}
