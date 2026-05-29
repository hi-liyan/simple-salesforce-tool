import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("QueryPanel 工具栏: 应将分页工具栏前置到新建记录前，并添加分割线", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");
  const paginationToolbarIndex = source.indexOf("<QueryPaginationToolbar");
  const separatorIndex = source.indexOf("className=\"-my-1 mx-0.5 w-px self-stretch bg-base-300/80\"");
  const createRecordTitleIndex = source.indexOf("title={mysqlResultReadonlyReason || \"新建记录\"}");

  assert.equal(source.includes("QueryPaginationToolbar"), true);
  assert.equal(source.includes("className=\"-my-1 mx-0.5 w-px self-stretch bg-base-300/80\""), true);
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

test("QueryPanel 工具栏: 隐藏查询栏按钮前应改为刷新当前查询按钮，且不再依赖未提交状态禁用", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");
  const refreshTitleIndex = source.indexOf("title=\"刷新当前查询\"");
  const queryBarToggleIndex = source.indexOf("title={activeTab.showQueryBar ? \"隐藏查询栏\" : \"显示查询栏\"}");

  assert.notEqual(refreshTitleIndex, -1);
  assert.notEqual(queryBarToggleIndex, -1);
  assert.equal(refreshTitleIndex < queryBarToggleIndex, true);
  assert.equal(source.includes("disabled={activeTab.loading || !hasPendingChanges}"), false);
});

test("QueryPanel 查询栏: 不应再渲染独立查询按钮，并应提供拖拽分隔条", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("查询\n        </button>"), false);
  assert.equal(source.includes("aria-label=\"拖拽调整 WHERE 与排序输入框宽度\""), true);
});

test("QueryPanel 工具栏: 按钮应改为无边框 hover 背景样式，并整体收紧高度", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("btn btn-sm h-[30px] min-h-[30px] w-[30px] min-w-[30px] rounded-md border-0"), true);
  assert.equal(source.includes("hover:bg-base-200/80"), true);
  assert.equal(source.includes("border-b border-base-300 px-3 py-1 overflow-x-auto"), true);
});

test("QueryPanel 工具栏: 禁用按钮也应通过外层容器显示 title", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("function ToolbarActionButton("), true);
  assert.equal(source.includes("<span className=\"inline-flex\" title={title}>"), true);
  assert.equal(source.includes("pointer-events-none"), true);
});
