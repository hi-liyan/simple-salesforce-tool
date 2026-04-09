import { buildHeaderDisplayLines } from "../renderers/drawHeader.ts";

type EstimateAutoColumnWidthInput = {
  // 当前字段名：用于构建表头主标题。
  fieldName: string;
  // 当前字段元数据：用于读取 label 等辅助展示信息。
  metadata: Record<string, unknown>;
  // 当前结果集记录：仅采样前 N 行用于估算默认列宽。
  records: Record<string, unknown>[];
  // 采样行数上限：避免大结果集初始化测量过重。
  sampleRowCount: number;
};

// 列宽测量右侧预留：覆盖单元格左右 padding 与轻微呼吸空间。
const CELL_HORIZONTAL_PADDING = 32;
// 自动列宽上限：避免超长文本把整个表格撑得失控。
const AUTO_COLUMN_WIDTH_MAX = 900;

// 将单元格值转为用于宽度估算的文本，避免引入编辑器运行时依赖。
function stringifyColumnWidthValue(value: unknown): string {
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

// 测量文本宽度：浏览器环境使用 Canvas，测试环境回退字符估算。
function measureTextWidth(text: string, font: string, ctx: CanvasRenderingContext2D | null): number {
  if (ctx) {
    ctx.font = font; // 行内注释：与表头/单元格实际字体尽量保持一致，提升测量可信度。
    return ctx.measureText(text).width;
  }
  return Array.from(text).length * 8;
}

// 估算字段默认列宽：取“表头 + 前 N 行内容”中的最大值。
export function estimateAutoColumnWidth({
  fieldName,
  metadata,
  records,
  sampleRowCount
}: EstimateAutoColumnWidthInput): number {
  const ctx =
    typeof document !== "undefined"
      ? document.createElement("canvas").getContext("2d")
      : null;

  const lines = buildHeaderDisplayLines(fieldName, metadata);
  const headerPrimaryWidth = measureTextWidth(lines.primary, "600 12px sans-serif", ctx);
  const headerSecondaryWidth = lines.secondary
    ? measureTextWidth(lines.secondary, "500 11px sans-serif", ctx)
    : 0;
  let maxWidth = Math.max(headerPrimaryWidth, headerSecondaryWidth);

  records.slice(0, sampleRowCount).forEach((record) => {
    const text = stringifyColumnWidthValue(record[fieldName]);
    const contentWidth = measureTextWidth(text, "400 13px sans-serif", ctx);
    if (contentWidth > maxWidth) {
      maxWidth = contentWidth; // 行内注释：默认列宽随采样内容增长，但只保留最大值避免抖动。
    }
  });

  return Math.min(AUTO_COLUMN_WIDTH_MAX, Math.max(44, Math.ceil(maxWidth + CELL_HORIZONTAL_PADDING)));
}
