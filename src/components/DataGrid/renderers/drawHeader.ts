import React from "react";
import { DataEditor } from "@glideapps/glide-data-grid";

type DataEditorDrawHeader = NonNullable<React.ComponentProps<typeof DataEditor>["drawHeader"]>;

type CreateDrawHeaderParams = {
  // 字段元数据映射：用于渲染 Field Name / Label。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 是否展示元数据 info icon。
  showHeaderMetadata: boolean;
};

// 构建表头绘制器：仅负责字段双行标题与元数据信息图标。
export function createDrawHeader({
  fieldMetadataMap,
  showHeaderMetadata
}: CreateDrawHeaderParams): DataEditorDrawHeader {
  return (args, drawContent) => {
    drawContent();
    const columnId = String(args.column.id ?? "");
    if (columnId.startsWith("__")) return;
    // 业务字段表头：第一行显示 Field Name，第二行显示 Label（小字浅色）。
    drawFieldHeaderText(args.ctx, args.rect, columnId, fieldMetadataMap[columnId] || {}, showHeaderMetadata);
    if (showHeaderMetadata) {
      drawHeaderInfoIcon(args.ctx, args.rect);
    }
  };
}

// 表头绘制 info 图标。
export function drawHeaderInfoIcon(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number }
) {
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
export function isHeaderInfoIconHit(
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

// 绘制字段表头双行文案：第一行 Field Name，第二行 Label（小字浅色）。
function drawFieldHeaderText(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  fieldName: string,
  metadata: Record<string, unknown>,
  showHeaderMetadata: boolean
) {
  const headerLines = buildHeaderDisplayLines(fieldName, metadata);
  const hasSecondLine = Boolean(headerLines.secondary);
  const textLeft = rect.x + 8;
  const textRightPadding = showHeaderMetadata ? 24 : 8; // 预留 info icon 空间，避免文本重叠。

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 1, rect.y + 1, Math.max(1, rect.width - 2), Math.max(1, rect.height - 2));
  ctx.clip();

  if (hasSecondLine) {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f3a4a";
    ctx.font = "600 12px sans-serif";
    // 不传 maxWidth：避免 Canvas 为适配窄列而“横向缩放文本”，导致表头出现压缩效果。
    ctx.fillText(headerLines.primary, textLeft, rect.y + 10);

    ctx.fillStyle = "#8b97a6";
    ctx.font = "500 11px sans-serif";
    ctx.fillText(headerLines.secondary || "", textLeft, rect.y + 21);
  } else {
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "#2f3a4a";
    ctx.font = "600 12px sans-serif";
    ctx.fillText(headerLines.primary, textLeft, rect.y + rect.height / 2);
  }

  ctx.restore();
}

// 组装字段表头显示文本：第一行 fieldName，第二行仅在 label 有效且不同于 fieldName 时展示。
export function buildHeaderDisplayLines(
  fieldName: string,
  metadata: Record<string, unknown>
): { primary: string; secondary: string | null } {
  const labelRaw = metadata.label;
  const label = typeof labelRaw === "string" ? labelRaw.trim() : "";
  const secondary = label && label !== fieldName ? label : null;
  return {
    primary: fieldName,
    secondary
  };
}
