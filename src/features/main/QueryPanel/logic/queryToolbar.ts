// Page Size 预设：参考常见数据库客户端的分档，覆盖小样本到中等批量浏览。
export const PAGE_SIZE_PRESET_VALUES = [10, 100, 250, 500, 1000] as const;

// Page Size 最大值：与当前 Query 执行链路中的 limit 上限保持一致。
export const PAGE_SIZE_MAX = 2000;

type QueryPageSizeOption = {
  // 当前条数归属：预设值或自定义值。
  kind: "preset" | "custom";
  // 归一化后的实际条数。
  value: number;
  // 菜单显示文案。
  label: string;
};

// 归一化 Page Size：统一收敛到 1-2000 的整数，避免非法值写入查询状态。
export function normalizeQueryPageSize(value: number, fallback = 200): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(1, Math.min(PAGE_SIZE_MAX, Math.floor(value)));
}

// 识别当前条数是预设值还是自定义值：供工具栏文案与菜单高亮复用。
export function resolveQueryPageSizeOption(value: number): QueryPageSizeOption {
  const normalizedValue = normalizeQueryPageSize(value);
  const isPreset = PAGE_SIZE_PRESET_VALUES.includes(normalizedValue as (typeof PAGE_SIZE_PRESET_VALUES)[number]);
  return {
    kind: isPreset ? "preset" : "custom",
    value: normalizedValue,
    label: String(normalizedValue)
  };
}
