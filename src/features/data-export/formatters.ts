import type { ExportFormat } from "../../types";

// 文本快速格式化选项（用于 DataGrid 选中行 / 当前页复制或快速导出）。
export type QuickFormatOptions = {
  // 目标格式（xlsx 仅由后端文件导出处理，此处支持文本格式）。
  format: Exclude<ExportFormat, "xlsx">;
  // 导出的列名列表（按显示顺序）。
  columns: string[];
  // 待导出的记录行。
  records: Record<string, unknown>[];
  // 目标表名（仅 sqlInsert 格式使用）。
  tableName?: string;
  // 是否包含表头（csv / tsv 有效，默认 true）。
  includeHeader?: boolean;
  // SQL INSERT 每条语句合并的最大行数（默认 100）。
  batchSize?: number;
  // CSV 是否附带 UTF-8 BOM（文件保存时建议为 true，剪贴板复制时建议为 false）。
  withBom?: boolean;
};

// 将任意单元格值转换为纯文本。
export function cellValueToPlainText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    try {
      return JSON.stringify(value);
    } catch {
      return String(value);
    }
  }
  return String(value);
}

// 转义 CSV 单元格。
function escapeCsvCell(raw: string): string {
  if (/[",\n\r]/.test(raw)) {
    return `"${raw.replace(/"/g, '""')}"`;
  }
  return raw;
}

// 转义 TSV 单元格（替换制表符与换行符以保持单行）。
function escapeTsvCell(raw: string): string {
  return raw.replace(/[\t\r\n]/g, " ");
}

// 转义 Markdown 表格单元格。
function escapeMarkdownCell(raw: string): string {
  return raw.replace(/\|/g, "\\|").replace(/\r/g, "").replace(/\n/g, "<br/>");
}

// 格式化 SQL 字面量值。
export function formatSqlLiteral(value: unknown): string {
  if (value === null || value === undefined) return "NULL";
  if (typeof value === "boolean") return value ? "1" : "0";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "NULL";
  const text = typeof value === "object" ? JSON.stringify(value) : String(value);
  const escaped = text.replace(/\\/g, "\\\\").replace(/'/g, "\\'");
  return `'${escaped}'`;
}

// 按指定格式将记录集渲染为字符串。
export function formatRecordsToText({
  format,
  columns,
  records,
  tableName = "exported_table",
  includeHeader = true,
  batchSize = 100,
  withBom = false
}: QuickFormatOptions): string {
  if (columns.length === 0) return "";

  if (format === "csv") {
    const lines: string[] = [];
    if (includeHeader) {
      lines.push(columns.map((col) => escapeCsvCell(col)).join(","));
    }
    for (const row of records) {
      lines.push(columns.map((col) => escapeCsvCell(cellValueToPlainText(row[col]))).join(","));
    }
    const content = lines.join("\n");
    return withBom ? `\uFEFF${content}` : content;
  }

  if (format === "tsv") {
    const lines: string[] = [];
    if (includeHeader) {
      lines.push(columns.map((col) => escapeTsvCell(col)).join("\t"));
    }
    for (const row of records) {
      lines.push(columns.map((col) => escapeTsvCell(cellValueToPlainText(row[col]))).join("\t"));
    }
    return lines.join("\n");
  }

  if (format === "markdown") {
    const header = `| ${columns.map((col) => escapeMarkdownCell(col)).join(" | ")} |`;
    const separator = `| ${columns.map(() => "---").join(" | ")} |`;
    const body = records.map(
      (row) => `| ${columns.map((col) => escapeMarkdownCell(cellValueToPlainText(row[col]))).join(" | ")} |`
    );
    return [header, separator, ...body].join("\n");
  }

  if (format === "json") {
    const normalized = records.map((row) => {
      const obj: Record<string, unknown> = {};
      for (const col of columns) {
        obj[col] = row[col] === undefined ? null : row[col];
      }
      return obj;
    });
    return JSON.stringify(normalized, null, 2);
  }

  // sqlInsert：按批次生成多值 INSERT INTO 语句。
  const safeTable = tableName.trim() || "exported_table";
  const escapedTable = safeTable.replace(/`/g, "``");
  const colsSql = columns.map((col) => `\`${col.replace(/`/g, "``")}\``).join(", ");
  const effectiveBatch = Math.max(1, Math.min(2000, batchSize));
  const statements: string[] = [];

  for (let i = 0; i < records.length; i += effectiveBatch) {
    const slice = records.slice(i, i + effectiveBatch);
    const tuples = slice.map((row) => {
      const vals = columns.map((col) => formatSqlLiteral(row[col])).join(", ");
      return `(${vals})`;
    });
    statements.push(`INSERT INTO \`${escapedTable}\` (${colsSql}) VALUES\n  ${tuples.join(",\n  ")};`);
  }
  return statements.join("\n\n");
}

// 复制文本到剪贴板（优先使用现代 Clipboard API，受限时回退 execCommand）。
export async function copyTextToClipboard(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy");
    document.body.removeChild(textarea);
  }
}
