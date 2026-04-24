import { GridCellKind } from "@glideapps/glide-data-grid";
import type { EditableGridCell } from "@glideapps/glide-data-grid";

// 布尔值统一转换为编辑器可识别文本。
export function normalizeBooleanText(value: unknown): string {
  if (typeof value === "boolean") return value ? "true" : "false";
  if (typeof value === "number") return value === 1 ? "true" : "false";
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "false") return normalized;
    if (normalized === "1") return "true";
    if (normalized === "0") return "false";
  }
  return "false";
}

// 归一化 Select 当前值，防止值不在选项里导致空白。
export function normalizeSelectValue(raw: string, options: { label: string; value: string }[]): string {
  if (options.some((item) => item.value === raw)) return raw;
  return options[0]?.value ?? "";
}

// 将值转换为数字。
export function coerceNumber(value: unknown): number | undefined {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  // 兼容后端布尔回退值：统一映射到 0/1，避免数值列显示 true/false。
  if (typeof value === "boolean") return value ? 1 : 0;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
}

// 判断值是否为空。
export function isEmptyValue(value: unknown): boolean {
  return value === null || value === undefined || (typeof value === "string" && value.trim() === "");
}

// 将单元格值转为显示字符串。
export function stringifyCellValue(value: unknown): string {
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

// 空值占位文案：按数据源区分 None/Null，避免与空字符串视觉混淆。
export function getNullPlaceholderBySourceType(sourceType?: string): "None" | "Null" {
  return (sourceType || "salesforce").toLowerCase() === "mysql" ? "Null" : "None";
}

// 抽取文本编辑值。
export function extractEditableString(value: EditableGridCell): string {
  if (value.kind === GridCellKind.Text) return String(value.data ?? "");
  if (value.kind === GridCellKind.Number) return String(value.data ?? "");
  if (value.kind === GridCellKind.Boolean) return String(value.data ?? "");
  return String(value.data ?? "");
}

// 抽取数字编辑值。
export function extractEditableNumber(value: EditableGridCell): number | undefined {
  if (value.kind === GridCellKind.Number) {
    return typeof value.data === "number" && Number.isFinite(value.data) ? value.data : undefined;
  }
  const text = extractEditableString(value).trim();
  if (!text) return undefined;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : undefined;
}
