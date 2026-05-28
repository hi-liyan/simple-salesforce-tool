import { useMemo, useState } from "react";
import type { GridColumn } from "@glideapps/glide-data-grid";
import { buildHeaderDisplayLines } from "../renderers/drawHeader.ts";
import { estimateAutoColumnWidth } from "../utils/columnWidth.ts";

// 默认列宽采样行数：按表头 + 前 50 行内容估算，兼顾体验与性能。
const DEFAULT_COLUMN_WIDTH_SAMPLE_ROWS = 50;

type UseDataGridColumnsParams = {
  // 当前可见字段列表。
  visibleColumns: string[];
  // 是否展示表头元数据 icon：影响表头右侧预留空间，从而影响最小列宽计算。
  showHeaderMetadata: boolean;
  // 当前记录列表：用于推导可选记录 Id。
  records: Record<string, unknown>[];
  // 字段元数据映射：MySQL 下用于识别主键列（columnKey=PRI）。
  fieldMetadataMap: Record<string, Record<string, unknown>>;
  // 当前数据源类型：用于按源类型切换记录 Id 提取策略。
  selectedSourceType?: string;
};

type BuildGridColumnsParams = {
  // 业务字段列顺序。
  displayColumns: string[];
  // 表头最小宽度：防止列被拖得过窄。
  headerMinWidths: Record<string, number>;
  // 用户会话内调整后的列宽。
  columnWidths: Record<string, number>;
  // 自动估算列宽。
  autoColumnWidths: Record<string, number>;
};

// 构造 DataGrid 列定义：首列固定为序号列，后续为业务字段列。
export function buildGridColumns({
  displayColumns,
  headerMinWidths,
  columnWidths,
  autoColumnWidths
}: BuildGridColumnsParams): GridColumn[] {
  const dataColumns: GridColumn[] = displayColumns.map((column) => ({
    id: column,
    // 数据列表头由 drawHeader 自定义双行绘制，这里留空避免默认文案覆盖。
    title: "",
    width: Math.max(headerMinWidths[column] ?? 44, columnWidths[column] ?? autoColumnWidths[column] ?? 44)
  }));

  return [
    {
      id: "__index",
      title: "#",
      width: Math.max(headerMinWidths.__index ?? 56, columnWidths.__index ?? 56)
    },
    ...dataColumns
  ];
}

// DataGrid 列配置 Hook：统一管理列顺序、列宽和稳定记录键映射。
export function useDataGridColumns({
  visibleColumns,
  showHeaderMetadata,
  records,
  fieldMetadataMap,
  selectedSourceType
}: UseDataGridColumnsParams) {
  // 列宽状态：支持用户拖拽后即时更新列宽。
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});

  const displayColumns = useMemo(
    () => {
      // 列顺序规范：始终将 Id、Name 提前展示，其余字段保持原有顺序。
      const priority = ["Id", "Name"].filter((column) => visibleColumns.includes(column));
      const rest = visibleColumns.filter((column) => column !== "Id" && column !== "Name");
      return [...priority, ...rest];
    },
    [visibleColumns]
  );

  // 表头最小列宽：使用 Canvas 测量表头文案宽度，保证表头不会因列过窄被“缩放压扁”。
  const headerMinWidths = useMemo(() => {
    const widths: Record<string, number> = {
      // 特殊列：固定最小宽度（与 DataEditor minColumnWidth 保持一致的下限）。
      __index: 56
    };

    // 在浏览器环境下使用 Canvas 精确测量；非浏览器环境（如测试运行时）回退到字符宽度估算。
    const ctx =
      typeof document !== "undefined"
        ? document.createElement("canvas").getContext("2d")
        : null;

    const measureTextWidth = (text: string, font: string): number => {
      if (ctx) {
        ctx.font = font; // 关键：与 drawHeader 中使用的字体保持一致，确保测量可信。
        return ctx.measureText(text).width;
      }
      // 估算：按字符数 * 平均宽度（ASCII/中文混排时取一个保守值）。
      return Array.from(text).length * 8;
    };

    for (const column of displayColumns) {
      const metadata = fieldMetadataMap[column] || {};
      const lines = buildHeaderDisplayLines(column, metadata);
      const primaryWidth = measureTextWidth(lines.primary, "600 12px sans-serif");
      const secondaryWidth = lines.secondary
        ? measureTextWidth(lines.secondary, "500 11px sans-serif")
        : 0;

      // 左侧 8px + 文案最大宽度 + 右侧预留（含 info icon 空间）= 列的最小宽度。
      const rightPadding = showHeaderMetadata ? 24 : 8;
      const minWidth = Math.ceil(8 + Math.max(primaryWidth, secondaryWidth) + rightPadding);

      // 约束边界：与 DataEditor maxColumnWidth 对齐，避免极端长字段名导致不可控布局。
      widths[column] = Math.min(900, Math.max(44, minWidth));
    }

    return widths;
  }, [displayColumns, fieldMetadataMap, showHeaderMetadata]);

  // 内容驱动的默认列宽：按“表头 + 前 N 行采样内容”估算，替代固定 180/280 宽度。
  const autoColumnWidths = useMemo(() => {
    const widths: Record<string, number> = {};
    for (const column of displayColumns) {
      widths[column] = estimateAutoColumnWidth({
        fieldName: column,
        metadata: fieldMetadataMap[column] || {},
        records,
        sampleRowCount: DEFAULT_COLUMN_WIDTH_SAMPLE_ROWS
      });
    }
    return widths;
  }, [displayColumns, fieldMetadataMap, records]);

  const columns = useMemo<GridColumn[]>(
    () =>
      buildGridColumns({
        displayColumns,
        headerMinWidths,
        columnWidths,
        autoColumnWidths
      }),
    [displayColumns, headerMinWidths, columnWidths, autoColumnWidths]
  );

  // MySQL 主键列：用于缺失 Id 时的勾选回退键。
  const mysqlPrimaryKeyField = useMemo(() => {
    if ((selectedSourceType || "salesforce").toLowerCase() !== "mysql") return "";
    const field = Object.entries(fieldMetadataMap).find(
      ([, metadata]) => String(metadata?.columnKey || "").toUpperCase() === "PRI"
    )?.[0];
    return field || "";
  }, [fieldMetadataMap, selectedSourceType]);

  const selectableIds = useMemo(
    () =>
      records.map((item, index) => {
        if (item.__rowStableId !== null && item.__rowStableId !== undefined && String(item.__rowStableId).trim() !== "") {
          return String(item.__rowStableId).trim();
        }
        const fromId = item.Id;
        if (fromId !== null && fromId !== undefined && String(fromId).trim() !== "") {
          return String(fromId);
        }
        if (mysqlPrimaryKeyField) {
          const fromPrimary = item[mysqlPrimaryKeyField];
          if (fromPrimary !== null && fromPrimary !== undefined && String(fromPrimary).trim() !== "") {
            return String(fromPrimary);
          }
        }
        return `row:${index}`;
      }),
    [records, mysqlPrimaryKeyField]
  );

  return {
    columns,
    columnWidths,
    setColumnWidths,
    headerMinWidths,
    selectableIds
  };
}
