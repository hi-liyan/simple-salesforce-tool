import type { SalesforceSource, SourceUpsertPayload } from "../../../../types/index.ts";

// 颜色值校验：当前仅接受 #RRGGBB / #RGB 形式，避免把任意字符串写入配置。
function isValidHexColor(value: string): boolean {
  return /^#(?:[0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value.trim());
}

// 读取数据源颜色：仅返回用户手动配置的合法颜色，不做默认分配。
export function getSourceColor(source: SalesforceSource): string {
  const rawColor = String(source.configJson?.color || "").trim();
  return isValidHexColor(rawColor) ? rawColor : "";
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
