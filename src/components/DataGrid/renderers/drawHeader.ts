import React from "react";
import { DataEditor } from "@glideapps/glide-data-grid";
import type { GridAdapter } from "../../../drivers/types.ts";

type DataEditorDrawHeader = NonNullable<React.ComponentProps<typeof DataEditor>["drawHeader"]>;

// 表头字体常量：绘制与宽度测量共用，避免列宽估算偏差。
export const HEADER_PRIMARY_FONT = "600 12px sans-serif";
export const HEADER_SECONDARY_FONT = "500 10.5px sans-serif";
export const HEADER_COMMENT_FONT = "400 10.5px sans-serif";

// 表头动态高度常量：按实际可见行数自适应。
export const HEADER_HEIGHT_SINGLE_LINE = 28;
export const HEADER_HEIGHT_TWO_LINES = 38;
export const HEADER_HEIGHT_THREE_LINES = 50;

// 表头类型语义分类：用于类型文本语义着色。
export type HeaderTypeVisualKind =
  | "integer"
  | "numeric"
  | "string"
  | "boolean"
  | "temporal"
  | "structured"
  | "identifier"
  | "binary"
  | "spatial"
  | "unknown";

// 表头三行展示文本结构。
export type HeaderDisplayLines = {
  primary: string;
  typeText: string | null;
  commentText: string | null;
};

// 解析表头显示行选项。
export type BuildHeaderDisplayLinesOptions = {
  gridAdapter?: Pick<GridAdapter, "resolveHeaderDisplayLines">;
  runtimeType?: string;
  showTypeLine?: boolean;
  showCommentLine?: boolean;
};

// 表头行高保留结果。
export type HeaderLineReservation = {
  reserveTypeLine: boolean;
  reserveCommentLine: boolean;
  headerHeight: number;
};

type CreateDrawHeaderParams = {
  // 字段元数据映射：用于渲染字段名、类型与注释/标签。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 结果集运行时类型映射：用于无表元数据场景下补充列类型。
  columnTypes?: Record<string, string>;
  // 数据源表格适配器：统一解析多数据源表头展示文本。
  gridAdapter?: Pick<GridAdapter, "resolveHeaderDisplayLines">;
  // 是否展示元数据 info icon。
  showHeaderMetadata: boolean;
  // 是否展示字段类型行。
  showTypeLine?: boolean;
  // 是否展示字段注释/标签行。
  showCommentLine?: boolean;
  // 是否为类型行保留垂直空间（按全量列计算）。
  reserveTypeLine?: boolean;
  // 是否为注释行保留垂直空间（按全量列计算）。
  reserveCommentLine?: boolean;
};

// 类型语义着色表：高对比度浅色画布色板。
const HEADER_TYPE_COLOR_MAP: Record<HeaderTypeVisualKind, string> = {
  integer: "#1d4ed8",
  numeric: "#0e7490",
  string: "#166534",
  boolean: "#c2410c",
  temporal: "#7e22ce",
  structured: "#be185d",
  identifier: "#92400e",
  binary: "#b91c1c",
  spatial: "#047857",
  unknown: "#64748b"
};

const INTEGER_TYPE_BASES = new Set([
  "tinyint",
  "smallint",
  "mediumint",
  "int",
  "integer",
  "bigint",
  "serial",
  "smallserial",
  "bigserial",
  "int1",
  "int2",
  "int4",
  "int8",
  "year",
  "long"
]);

const NUMERIC_TYPE_BASES = new Set([
  "float",
  "double",
  "real",
  "decimal",
  "numeric",
  "newdecimal",
  "dec",
  "fixed",
  "currency",
  "percent",
  "number"
]);

const STRING_TYPE_BASES = new Set([
  "varchar",
  "varchar2",
  "nvarchar",
  "char",
  "nchar",
  "text",
  "tinytext",
  "mediumtext",
  "longtext",
  "string",
  "textarea",
  "picklist",
  "multipicklist",
  "email",
  "phone",
  "url",
  "combobox",
  "enum",
  "set"
]);

const BOOLEAN_TYPE_BASES = new Set(["bool", "boolean", "bit"]);
const TEMPORAL_TYPE_BASES = new Set(["date", "time", "datetime", "timestamp", "timestamptz", "timetz"]);
const STRUCTURED_TYPE_BASES = new Set(["json", "jsonb", "xml", "array", "map", "struct", "object"]);
const IDENTIFIER_TYPE_BASES = new Set(["id", "reference", "uuid", "uniqueidentifier", "lookup", "master-detail"]);
const BINARY_TYPE_BASES = new Set(["blob", "tinyblob", "mediumblob", "longblob", "binary", "varbinary", "bytea", "base64"]);
const SPATIAL_TYPE_BASES = new Set([
  "geometry",
  "geography",
  "point",
  "linestring",
  "polygon",
  "multipoint",
  "multilinestring",
  "multipolygon",
  "geometrycollection",
  "location",
  "address"
]);

// 提取类型基础名：去除长度参数与 unsigned 修饰，统一转小写。
function normalizeHeaderTypeBase(typeText: string): string {
  const cleaned = typeText
    .trim()
    .toLowerCase()
    .replace(/\s+unsigned\b/g, "")
    .replace(/\s+/g, " ");
  const parenIndex = cleaned.indexOf("(");
  return (parenIndex >= 0 ? cleaned.slice(0, parenIndex) : cleaned).trim();
}

// 解析表头类型文本的语义分类。
export function resolveHeaderTypeVisualKind(typeText: string): HeaderTypeVisualKind {
  const trimmed = typeText.trim();
  if (!trimmed) return "unknown";
  // MySQL tinyint(1) 在语义上通常作为布尔值展示。
  if (/^tinyint\s*\(\s*1\s*\)/i.test(trimmed)) return "boolean";
  const base = normalizeHeaderTypeBase(trimmed);
  if (INTEGER_TYPE_BASES.has(base)) return "integer";
  if (NUMERIC_TYPE_BASES.has(base)) return "numeric";
  if (STRING_TYPE_BASES.has(base)) return "string";
  if (BOOLEAN_TYPE_BASES.has(base)) return "boolean";
  if (TEMPORAL_TYPE_BASES.has(base)) return "temporal";
  if (STRUCTURED_TYPE_BASES.has(base)) return "structured";
  if (IDENTIFIER_TYPE_BASES.has(base)) return "identifier";
  if (BINARY_TYPE_BASES.has(base)) return "binary";
  if (SPATIAL_TYPE_BASES.has(base)) return "spatial";
  return "unknown";
}

// 根据类型文本返回对应的 Canvas 绘制颜色。
export function resolveHeaderTypeColor(typeText: string): string {
  return HEADER_TYPE_COLOR_MAP[resolveHeaderTypeVisualKind(typeText)];
}

// 计算全量结果列下的表头行保留状态与表头高度，避免横向滚动时高度跳动。
export function resolveHeaderLineReservation(params: {
  displayColumns: readonly string[];
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  columnTypes?: Record<string, string>;
  gridAdapter?: Pick<GridAdapter, "resolveHeaderDisplayLines">;
  showTypeLine: boolean;
  showCommentLine: boolean;
}): HeaderLineReservation {
  const { displayColumns, fieldMetadataMap, columnTypes, gridAdapter, showTypeLine, showCommentLine } = params;
  let reserveTypeLine = false;
  let reserveCommentLine = false;

  for (const column of displayColumns) {
    const lines = buildHeaderDisplayLines(column, fieldMetadataMap[column] || {}, {
      gridAdapter,
      runtimeType: columnTypes?.[column],
      showTypeLine,
      showCommentLine
    });
    if (showTypeLine && lines.typeText) {
      reserveTypeLine = true;
    }
    if (showCommentLine && lines.commentText) {
      reserveCommentLine = true;
    }
    if (reserveTypeLine && reserveCommentLine) {
      break;
    }
  }

  const lineCount = 1 + (reserveTypeLine ? 1 : 0) + (reserveCommentLine ? 1 : 0);
  const headerHeight =
    lineCount === 3
      ? HEADER_HEIGHT_THREE_LINES
      : lineCount === 2
        ? HEADER_HEIGHT_TWO_LINES
        : HEADER_HEIGHT_SINGLE_LINE;

  return {
    reserveTypeLine,
    reserveCommentLine,
    headerHeight
  };
}

// 构建表头绘制器：支持字段名、数据类型（语义着色）与注释/标签三行自适应绘制。
export function createDrawHeader({
  fieldMetadataMap,
  columnTypes,
  gridAdapter,
  showHeaderMetadata,
  showTypeLine = true,
  showCommentLine = true,
  reserveTypeLine = false,
  reserveCommentLine = false
}: CreateDrawHeaderParams): DataEditorDrawHeader {
  return (args, drawContent) => {
    drawContent();
    const columnId = String(args.column.id ?? "");
    if (columnId.startsWith("__")) return;

    const lines = buildHeaderDisplayLines(columnId, fieldMetadataMap[columnId] || {}, {
      gridAdapter,
      runtimeType: columnTypes?.[columnId],
      showTypeLine,
      showCommentLine
    });
    drawFieldHeaderText(
      args.ctx,
      args.rect,
      lines,
      showHeaderMetadata,
      reserveTypeLine,
      reserveCommentLine
    );
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

// 绘制字段表头多行文案：按全量列保留行位，确保不同列基线对齐。
function drawFieldHeaderText(
  ctx: CanvasRenderingContext2D,
  rect: { x: number; y: number; width: number; height: number },
  headerLines: HeaderDisplayLines,
  showHeaderMetadata: boolean,
  reserveTypeLine: boolean,
  reserveCommentLine: boolean
) {
  const textLeft = rect.x + 8;
  const textRightPadding = showHeaderMetadata ? 24 : 8; // 预留 info icon 空间，避免文本重叠。
  const clipWidth = Math.max(1, rect.width - textRightPadding);
  const lineCount = 1 + (reserveTypeLine ? 1 : 0) + (reserveCommentLine ? 1 : 0);

  ctx.save();
  ctx.beginPath();
  ctx.rect(rect.x + 1, rect.y + 1, clipWidth, Math.max(1, rect.height - 2));
  ctx.clip();

  ctx.textAlign = "left";
  ctx.textBaseline = "middle";

  // 第一行：字段名。
  ctx.fillStyle = "#2f3a4a";
  ctx.font = HEADER_PRIMARY_FONT;
  const primaryY = lineCount === 1 ? rect.y + rect.height / 2 : rect.y + 11;
  // 不传 maxWidth：避免 Canvas 为适配窄列而横向缩放文本，超宽由 clip 裁剪。
  ctx.fillText(headerLines.primary, textLeft, primaryY);

  // 第二行：数据类型（语义着色）。
  if (reserveTypeLine && headerLines.typeText) {
    ctx.fillStyle = resolveHeaderTypeColor(headerLines.typeText);
    ctx.font = HEADER_SECONDARY_FONT;
    ctx.fillText(headerLines.typeText, textLeft, rect.y + 25);
  }

  // 第三行：字段注释或业务标签。
  if (reserveCommentLine && headerLines.commentText) {
    ctx.fillStyle = "#7b8794";
    ctx.font = HEADER_COMMENT_FONT;
    const commentY = reserveTypeLine ? rect.y + 39 : rect.y + 25;
    ctx.fillText(headerLines.commentText, textLeft, commentY);
  }

  ctx.restore();
}

// 组装字段表头显示文本：优先委托给数据源驱动适配器，未提供时使用通用元数据回退。
export function buildHeaderDisplayLines(
  fieldName: string,
  metadata: Record<string, unknown>,
  options?: BuildHeaderDisplayLinesOptions
): HeaderDisplayLines {
  const showTypeLine = options?.showTypeLine !== false;
  const showCommentLine = options?.showCommentLine !== false;

  if (options?.gridAdapter?.resolveHeaderDisplayLines) {
    const resolved = options.gridAdapter.resolveHeaderDisplayLines(
      fieldName,
      metadata,
      options.runtimeType
    );
    return {
      primary: resolved.primary,
      typeText: showTypeLine ? resolved.typeText : null,
      commentText: showCommentLine ? resolved.commentText : null
    };
  }

  const rawType = [metadata.columnType, metadata.mysqlDataType, metadata.type, metadata.dataType, options?.runtimeType]
    .find((item) => typeof item === "string" && item.trim().length > 0);
  const trimmedType = typeof rawType === "string" ? rawType.trim() : "";
  const typeText = showTypeLine && trimmedType
    ? (/^enum\s*\(/i.test(trimmedType) ? "enum" : trimmedType)
    : null;

  const rawComment = typeof metadata.comment === "string" ? metadata.comment.trim() : "";
  const rawLabel = typeof metadata.label === "string" ? metadata.label.trim() : "";
  const fallbackComment = rawComment || (rawLabel && rawLabel !== fieldName ? rawLabel : "");

  return {
    primary: fieldName,
    typeText,
    commentText: showCommentLine && fallbackComment ? fallbackComment : null
  };
}
