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
  assert.equal(source.includes("btn btn-sm h-[30px] min-h-[30px] w-[30px] min-w-[30px] rounded-md border-0"), true);
  assert.equal(source.includes("hover:bg-base-200/80 hover:text-neutral disabled:bg-transparent disabled:text-neutral/35"), true);
  assert.equal(source.includes("w-[76px]"), true);
  assert.equal(source.includes("min-w-[72px]"), true);
  assert.equal(source.includes("<span className=\"inline-flex\" title={title}>"), true);
  assert.equal(source.includes("pointer-events-none"), true);
});

test("QueryPanel 工具栏: MySQL DDL 与字段按钮应使用 DDL/FIELD 文本标识", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes(">DDL<"), true);
  assert.equal(source.includes(">FIELD<"), true);
});

test("QueryPanel 工具栏: 隐藏查询栏按钮前应改为刷新当前查询按钮，且不再依赖未提交状态禁用", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");
  const refreshTitleIndex = source.indexOf("title=\"刷新当前查询\"");
  const separatorAfterRefreshIndex = source.indexOf("{/* 分组分隔线：将刷新动作与后续面板切换动作分开。 */}");
  const queryBarToggleIndex = source.indexOf("title={activeTab.showQueryBar ? \"隐藏查询栏\" : \"显示查询栏\"}");

  assert.notEqual(refreshTitleIndex, -1);
  assert.notEqual(separatorAfterRefreshIndex, -1);
  assert.notEqual(queryBarToggleIndex, -1);
  assert.equal(refreshTitleIndex < separatorAfterRefreshIndex, true);
  assert.equal(separatorAfterRefreshIndex < queryBarToggleIndex, true);
  assert.equal(source.includes("disabled={activeTab.loading || !hasPendingChanges}"), false);
});

test("QueryPanel 工具栏: 刷新前遇到未提交修改时应弹出确认模态框", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false);"), true);
  assert.equal(source.includes("if (hasPendingChanges) {\n      setRefreshConfirmOpen(true);"), true);
  assert.equal(source.includes("存在未提交修改"), true);
  assert.equal(source.includes("刷新后，本地尚未提交的修改不会保留。请确认是否继续？"), true);
});

test("QueryPanel 刷新确认弹窗: 应提供仅撤销修改按钮", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("function handleDiscardPendingChangesOnly()"), true);
  assert.equal(source.includes("onDiscardPendingChanges(); // 行内注释：只撤回当前未提交修改，不触发重新查询。"), true);
  assert.equal(source.includes(">仅撤销修改<"), true);
  assert.equal(source.includes("className=\"btn btn-ghost btn-sm\""), true);
  assert.equal(source.includes("className=\"btn btn-outline btn-sm\""), true);
  assert.equal(source.includes("className=\"btn btn-warning btn-sm\""), true);
});

test("QueryPanel 工作区弹窗: 应通过页面级 portal 避免被左侧搜索层级盖住", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("import { createPortal } from \"react-dom\";"), true);
  assert.equal(source.includes("const modalPortalRoot = typeof document !== \"undefined\" ? document.getElementById(\"portal\") || document.body : null;"), true);
  assert.equal(source.includes("createPortal(refreshConfirmModal, modalPortalRoot)"), true);
  assert.equal(source.includes("createPortal(mysqlMutationPreviewModal, modalPortalRoot)"), true);
});

test("QueryPanel 弹窗遮罩: 应取消 DaisyUI 根节点滚动条预留空间", () => {
  const source = readFileSync(new URL("../../src/styles/index.css", import.meta.url), "utf8");

  assert.equal(source.includes(":root:has(:is(.modal-open, .modal:target, .modal-toggle:checked + .modal, .modal[open]))"), true);
  assert.equal(source.includes("scrollbar-gutter: auto;"), true);
});

test("QueryPanel 查询栏: 不应再渲染独立查询按钮，并应提供拖拽分隔条", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("查询\n        </button>"), false);
  assert.equal(source.includes("aria-label=\"拖拽调整 WHERE 与排序输入框宽度\""), true);
  assert.equal(source.includes("className=\"self-stretch w-px bg-base-300\""), true);
  assert.equal(source.includes("className=\"h-5 w-px bg-base-300\""), false);
});

test("QueryPanel 查询栏: WHERE/ORDER BY 输入行应收紧到与工具栏控件同高", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("className=\"flex min-w-0 shrink-0 items-center gap-2 px-3 py-0\""), true);
  assert.equal(
    source.includes('inputClassName="h-[30px] min-h-[30px] border-0 bg-transparent px-0 pr-8 text-[13px] shadow-none focus:border-0 focus:outline-none focus:ring-0"'),
    true
  );
  assert.equal(source.includes('inputClassName="h-[28px] min-h-[28px] border-0 bg-transparent px-0 pr-8 text-[13px] shadow-none focus:border-0 focus:outline-none focus:ring-0"'), false);
});

test("QueryPanel 工具栏: 按钮应改为无边框 hover 背景样式，并整体收紧高度", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("btn btn-sm h-[30px] min-h-[30px] w-[30px] min-w-[30px] rounded-md border-0"), true);
  assert.equal(source.includes("hover:bg-base-200/80"), true);
  assert.equal(source.includes("border-b border-base-300 px-3 py-1 overflow-x-auto"), true);
});

test("QueryPanel 工具栏: 激活态按钮应保留白色背景强调", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("const toolbarActiveButtonClassName = `${toolbarIconButtonClassName} bg-white`;"), true);
});

test("QueryPanel 工具栏: 禁用按钮也应通过外层容器显示 title", () => {
  const source = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");

  assert.equal(source.includes("function ToolbarActionButton("), true);
  assert.equal(source.includes("<span className=\"inline-flex\" title={title}>"), true);
  assert.equal(source.includes("pointer-events-none"), true);
});
