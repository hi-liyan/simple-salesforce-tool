export type PicklistOption = { label: string; value: string };

export const PICKLIST_NONE_VALUE = "";
export const PICKLIST_NONE_LABEL = "-- None --";

// picklist 可选值提取。
export function getPicklistOptions(metadata: Record<string, unknown>): PicklistOption[] {
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
    .filter((item): item is PicklistOption => Boolean(item));
}

// 判断 picklist 字段是否允许为空。
export function isPicklistNullable(metadata: Record<string, unknown>): boolean {
  return metadata.nillable === true;
}

// picklist 编辑器选项：可空字段在首位注入“-- None --”。
export function getPicklistEditorOptions(metadata: Record<string, unknown>): PicklistOption[] {
  const options = getPicklistOptions(metadata);
  if (!isPicklistNullable(metadata)) return options;
  return [{ label: PICKLIST_NONE_LABEL, value: PICKLIST_NONE_VALUE }, ...options];
}

// 统一 picklist 单元格值为字符串，null/undefined 视为空值。
export function normalizePicklistValue(value: unknown): string {
  if (value === null || value === undefined) return PICKLIST_NONE_VALUE;
  return String(value);
}

// 按 value 找到可读 label；若未匹配则回退显示原值。
export function resolvePicklistDisplayText(raw: string, options: PicklistOption[]): string {
  const matched = options.find((item) => item.value === raw);
  if (matched) return matched.label;
  return raw;
}
