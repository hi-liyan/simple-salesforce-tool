import type { SalesforceSource, SourceUpsertPayload } from "../../../../types/index.ts";

// 颜色预设：统一提供几组适合数据库来源标记的柔和基色。
export const SOURCE_COLOR_PRESETS = [
  { label: "天空蓝", color: "#60A5FA" },
  { label: "薄荷绿", color: "#34D399" },
  { label: "柠檬黄", color: "#FBBF24" },
  { label: "珊瑚粉", color: "#FB7185" },
  { label: "浅紫", color: "#A78BFA" },
  { label: "湖水青", color: "#22D3EE" }
] as const;

// 数据源表面色板：统一供左树节点、设置页色块和右侧 Tab 复用。
export type SourceSurfacePalette = {
  backgroundColor: string;
  activeBackgroundColor: string;
  borderColor: string;
};

type RgbColor = {
  red: number;
  green: number;
  blue: number;
};

// 颜色值校验：当前仅接受 #RRGGBB / #RGB 形式，避免把任意字符串写入配置。
function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

// 归一化十六进制颜色：统一展开为 #RRGGBB，便于后续做颜色混合。
function normalizeHexColor(value: string): string {
  const normalizedValue = value.trim();
  if (normalizedValue.length !== 4) return normalizedValue.toUpperCase();
  return `#${normalizedValue.slice(1).split("").map((item) => `${item}${item}`).join("")}`.toUpperCase();
}

// 解析十六进制颜色到 RGB：仅在颜色合法时返回数值通道。
function parseHexColor(value: string): RgbColor | null {
  if (!isValidHexColor(value)) return null;
  const normalizedValue = normalizeHexColor(value);
  return {
    red: Number.parseInt(normalizedValue.slice(1, 3), 16),
    green: Number.parseInt(normalizedValue.slice(3, 5), 16),
    blue: Number.parseInt(normalizedValue.slice(5, 7), 16)
  };
}

// 将单个 RGB 通道转换回十六进制片段。
function toHexChannel(value: number): string {
  return Math.max(0, Math.min(255, Math.round(value))).toString(16).padStart(2, "0").toUpperCase();
}

// 混合两种颜色：用于把用户设置色转成统一的浅色表面背景。
function mixHexColor(baseColor: string, targetColor: string, targetWeight: number): string {
  const baseRgb = parseHexColor(baseColor);
  const targetRgb = parseHexColor(targetColor);
  if (!baseRgb || !targetRgb) return "";

  const normalizedWeight = Math.max(0, Math.min(1, targetWeight));
  const baseWeight = 1 - normalizedWeight;
  return `#${toHexChannel(baseRgb.red * baseWeight + targetRgb.red * normalizedWeight)}${toHexChannel(baseRgb.green * baseWeight + targetRgb.green * normalizedWeight)}${toHexChannel(baseRgb.blue * baseWeight + targetRgb.blue * normalizedWeight)}`;
}

// 读取数据源颜色：仅返回用户手动配置的合法颜色，不做默认分配。
export function getSourceColor(source: SalesforceSource): string {
  const rawColor = String(source.configJson?.color || "").trim();
  return isValidHexColor(rawColor) ? normalizeHexColor(rawColor) : "";
}

// 将颜色写回 payload.configJson：空值时移除 color 字段，避免生成默认色。
export function withSourceColor(payload: SourceUpsertPayload, color: string): SourceUpsertPayload {
  const normalizedColor = color.trim();
  const nextConfigJson = { ...(payload.configJson || {}) } as Record<string, unknown>;

  if (isValidHexColor(normalizedColor)) {
    nextConfigJson.color = normalizedColor; // 写入合法颜色值，供后续左树与 Tab 复用。
  } else {
    delete nextConfigJson.color; // 未设置颜色时显式移除，保持中性样式。
  }

  return {
    ...payload,
    configJson: nextConfigJson
  };
}

// 构建浅色表面色板：统一把任意合法来源色映射为适合背景展示的浅色系。
export function buildSourceSurfacePalette(color: string): SourceSurfacePalette | null {
  const normalizedColor = color.trim();
  if (!isValidHexColor(normalizedColor)) return null;

  return {
    backgroundColor: mixHexColor(normalizedColor, "#FFFFFF", 0.84),
    activeBackgroundColor: mixHexColor(normalizedColor, "#FFFFFF", 0.74),
    borderColor: mixHexColor(normalizedColor, "#FFFFFF", 0.66)
  };
}
