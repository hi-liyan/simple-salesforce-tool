import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("QueryPanel 工具栏: 应将分页工具栏前置到新建记录前，并添加分割线", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");
  const paginationToolbarIndex = source.indexOf("<QueryPaginationToolbar");
  const separatorIndex = source.indexOf("className=\"-my-1.5 mx-0.5 w-px self-stretch bg-base-300/80\"");
  const createRecordTitleIndex = source.indexOf("title={mysqlResultReadonlyReason || \"新建记录\"}");

  assert.equal(source.includes("QueryPaginationToolbar"), true);
  assert.equal(source.includes("className=\"-my-1.5 mx-0.5 w-px self-stretch bg-base-300/80\""), true);
  assert.notEqual(paginationToolbarIndex, -1);
  assert.notEqual(separatorIndex, -1);
  assert.notEqual(createRecordTitleIndex, -1);
  assert.equal(paginationToolbarIndex < separatorIndex, true);
  assert.equal(separatorIndex < createRecordTitleIndex, true);
});

test("DataGridSurface: 不应再渲染 Rows 统计与顶部分页条", () => {
  const source = readFileSync(new URL("../../src/components/DataGrid/components/DataGridSurface.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("Rows:"), false);
  assert.equal(source.includes("buildQueryPaginationState"), false);
  assert.equal(source.includes("resolveQueryPageSizeOption"), false);
  assert.equal(source.includes("顶部工具栏：仅显示统计"), false);
});

test("QueryPaginationToolbar: 应使用更紧凑的按钮与元素间距", () => {
  const source = readFileSync(new URL("../../src/components/DataGrid/components/QueryPaginationToolbar.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("gap-0.5"), true);
  assert.equal(source.includes("h-5 min-h-[20px] w-5 min-w-[20px]"), true);
  assert.equal(source.includes("w-[76px]"), true);
  assert.equal(source.includes("min-w-[72px]"), true);
});

test("QueryPanel 工具栏: MySQL DDL 与字段按钮应使用 DDL/FIELD 文本标识", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes(">DDL<"), true);
  assert.equal(source.includes(">FIELD<"), true);
});
