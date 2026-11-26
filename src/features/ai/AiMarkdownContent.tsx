import type { ReactNode } from "react";

type AiMarkdownContentProps = {
  // 待渲染的 Markdown 文本（不含已拆分的围栏代码块）。
  content: string;
};

// 渲染行内 Markdown 语法：支持行内代码、加粗、斜体与安全链接。
function renderInlineMarkdown(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const tokenRegex = /(`[^`]+`|\*\*[^*]+\*\*|\*[^*]+\*|\[([^\]]+)\]\((https?:\/\/[^)]+)\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;
  let seq = 0;

  while ((match = tokenRegex.exec(text)) !== null) {
    if (match.index > lastIndex) {
      nodes.push(text.slice(lastIndex, match.index));
    }
    const token = match[0];
    const key = `${keyPrefix}-${seq++}`;
    if (token.startsWith("`") && token.endsWith("`")) {
      nodes.push(
        <code
          key={key}
          className="rounded bg-base-300/65 px-1 py-0.5 font-mono text-[11px] text-base-content"
        >
          {token.slice(1, -1)}
        </code>
      );
    } else if (token.startsWith("**") && token.endsWith("**")) {
      nodes.push(
        <strong key={key} className="font-semibold text-base-content">
          {token.slice(2, -2)}
        </strong>
      );
    } else if (token.startsWith("*") && token.endsWith("*")) {
      nodes.push(
        <em key={key} className="italic">
          {token.slice(1, -1)}
        </em>
      );
    } else if (match[2] && match[3]) {
      nodes.push(
        <a
          key={key}
          href={match[3]}
          target="_blank"
          rel="noreferrer"
          className="text-primary underline hover:opacity-80"
        >
          {match[2]}
        </a>
      );
    }
    lastIndex = match.index + token.length;
  }

  if (lastIndex < text.length) {
    nodes.push(text.slice(lastIndex));
  }
  return nodes;
}

// 解析单行表格单元格。
function parseTableRow(line: string): string[] {
  return line
    .trim()
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());
}

// 判断是否为 GFM 表格分隔行（例如 |---|---|）。
function isTableSeparatorLine(line: string): boolean {
  const trimmed = line.trim();
  if (!trimmed.includes("|") && !trimmed.includes("-")) return false;
  return /^\|?(\s*:?-{2,}:?\s*\|)+\s*:?-{2,}:?\s*\|?$/.test(trimmed);
}

// 轻量安全 Markdown 渲染器：纯 React 节点输出（零 XSS 风险），支持 GFM 表格、标题、列表、引用与行内格式。
export function AiMarkdownContent({ content }: AiMarkdownContentProps) {
  const lines = content.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let blockKey = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    if (!trimmed) {
      i += 1;
      continue;
    }

    // 1. GFM 表格块：表头行 + 分隔行 + 数据行。
    if (
      trimmed.includes("|") &&
      i + 1 < lines.length &&
      isTableSeparatorLine(lines[i + 1])
    ) {
      const headers = parseTableRow(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|") && !isTableSeparatorLine(lines[i])) {
        rows.push(parseTableRow(lines[i]));
        i += 1;
      }
      const key = `tbl-${blockKey++}`;
      blocks.push(
        <div key={key} className="my-1.5 overflow-x-auto rounded-lg border border-base-300 bg-base-100">
          <table className="w-full border-collapse text-left text-[11px]">
            <thead className="bg-base-200/70">
              <tr>
                {headers.map((h, idx) => (
                  <th
                    key={`${key}-h-${idx}`}
                    className="whitespace-nowrap border-b border-base-300 px-2.5 py-1.5 font-semibold text-base-content"
                  >
                    {renderInlineMarkdown(h, `${key}-h-${idx}`)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, rIdx) => (
                <tr key={`${key}-r-${rIdx}`} className="border-b border-base-300/60 last:border-b-0 hover:bg-base-200/35">
                  {headers.map((_, cIdx) => (
                    <td key={`${key}-c-${rIdx}-${cIdx}`} className="px-2.5 py-1.5 align-top text-base-content/90">
                      {renderInlineMarkdown(row[cIdx] ?? "", `${key}-c-${rIdx}-${cIdx}`)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    // 2. 标题（# ~ ####）。
    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const sizeClass =
        level === 1
          ? "text-[14px] font-bold"
          : level === 2
            ? "text-[13px] font-semibold"
            : "text-[12px] font-semibold";
      const key = `hd-${blockKey++}`;
      blocks.push(
        <div key={key} className={`mt-1 text-base-content ${sizeClass}`}>
          {renderInlineMarkdown(headingMatch[2], key)}
        </div>
      );
      i += 1;
      continue;
    }

    // 3. 分割线。
    if (/^(-{3,}|\*{3,})$/.test(trimmed)) {
      blocks.push(<hr key={`hr-${blockKey++}`} className="my-2 border-base-300" />);
      i += 1;
      continue;
    }

    // 4. 引用块（> ...）。
    if (trimmed.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      const key = `bq-${blockKey++}`;
      blocks.push(
        <blockquote
          key={key}
          className="border-l-2 border-primary/50 bg-base-100/70 pl-2.5 py-1 text-neutral/80"
        >
          {renderInlineMarkdown(quoteLines.join(" "), key)}
        </blockquote>
      );
      continue;
    }

    // 5. 无序列表（- / *）或有序列表（1.）。
    if (/^([-*]|\d+\.)\s+/.test(trimmed)) {
      const isOrdered = /^\d+\.\s+/.test(trimmed);
      const items: string[] = [];
      while (
        i < lines.length &&
        (isOrdered
          ? /^\d+\.\s+/.test(lines[i].trim())
          : /^[-*]\s+/.test(lines[i].trim()))
      ) {
        items.push(lines[i].trim().replace(/^([-*]|\d+\.)\s+/, ""));
        i += 1;
      }
      const key = `lst-${blockKey++}`;
      const ListTag = isOrdered ? "ol" : "ul";
      blocks.push(
        <ListTag
          key={key}
          className={`space-y-0.5 pl-4 ${isOrdered ? "list-decimal" : "list-disc"}`}
        >
          {items.map((item, idx) => (
            <li key={`${key}-${idx}`} className="leading-relaxed">
              {renderInlineMarkdown(item, `${key}-${idx}`)}
            </li>
          ))}
        </ListTag>
      );
      continue;
    }

    // 6. 普通段落（合并连续普通文本行）。
    const paraLines: string[] = [];
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4}\s+|>\s?|[-*]\s+|\d+\.\s+|---|\*\*\*)/.test(lines[i].trim()) &&
      !(lines[i].trim().includes("|") && i + 1 < lines.length && isTableSeparatorLine(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i += 1;
    }
    const key = `p-${blockKey++}`;
    blocks.push(
      <p key={key} className="whitespace-pre-wrap break-words leading-relaxed">
        {renderInlineMarkdown(paraLines.join("\n"), key)}
      </p>
    );
  }

  return <div className="space-y-1.5">{blocks}</div>;
}
