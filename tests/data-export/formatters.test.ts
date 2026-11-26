import assert from "node:assert/strict";
import test from "node:test";
import { formatRecordsToText } from "../../src/features/data-export/formatters.ts";

test("formatRecordsToText: 应正确生成带 BOM 与转义的 CSV", () => {
  const output = formatRecordsToText({
    format: "csv",
    columns: ["id", "name", "note"],
    records: [{ id: 1, name: 'Alice, "Bob"', note: "line1\nline2" }],
    withBom: true
  });
  assert.equal(output.startsWith("\uFEFFid,name,note\n"), true);
  assert.equal(output.includes('1,"Alice, ""Bob""","line1\nline2"'), true);
});

test("formatRecordsToText: 应正确生成 Markdown 表格并转义竖线与换行", () => {
  const output = formatRecordsToText({
    format: "markdown",
    columns: ["col1", "col2"],
    records: [{ col1: "a|b", col2: "x\ny" }]
  });
  assert.equal(output, "| col1 | col2 |\n| --- | --- |\n| a\\|b | x<br/>y |");
});

test("formatRecordsToText: 应按批次生成 SQL INSERT 语句并正确处理 NULL 与单引号", () => {
  const output = formatRecordsToText({
    format: "sqlInsert",
    tableName: "users",
    columns: ["id", "email", "active"],
    records: [
      { id: 1, email: "o'malley@example.com", active: true },
      { id: 2, email: null, active: false }
    ],
    batchSize: 100
  });
  assert.equal(
    output,
    "INSERT INTO `users` (`id`, `email`, `active`) VALUES\n  (1, 'o\\'malley@example.com', 1),\n  (2, NULL, 0);"
  );
});
