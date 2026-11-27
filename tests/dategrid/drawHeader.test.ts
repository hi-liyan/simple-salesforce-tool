import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildHeaderDisplayLines,
  HEADER_HEIGHT_SINGLE_LINE,
  HEADER_HEIGHT_THREE_LINES,
  HEADER_HEIGHT_TWO_LINES,
  resolveHeaderLineReservation,
  resolveHeaderTypeColor,
  resolveHeaderTypeVisualKind
} from "../../src/components/DataGrid/renderers/drawHeader.ts";
import { mysqlDriver } from "../../src/drivers/mysql/index.ts";
import { salesforceDriver } from "../../src/drivers/salesforce/index.ts";
import { resolveFieldMetadataForExecutor } from "../../src/features/main/QueryPanel/logic/consoleQueryUtils.ts";

// 表头文本组装测试：验证 Salesforce 驱动下的字段名、类型与 label 展示规则。
test("buildHeaderDisplayLines: Salesforce 驱动应展示 type 并在 label 不同时展示第三行", () => {
  const sameLabel = buildHeaderDisplayLines(
    "OwnerId",
    { type: "reference", label: "OwnerId" },
    { gridAdapter: salesforceDriver.gridAdapter }
  );
  assert.equal(sameLabel.primary, "OwnerId");
  assert.equal(sameLabel.typeText, "reference");
  assert.equal(sameLabel.commentText, null);

  const diffLabel = buildHeaderDisplayLines(
    "OwnerId",
    { type: "reference", label: "所有者" },
    { gridAdapter: salesforceDriver.gridAdapter }
  );
  assert.equal(diffLabel.primary, "OwnerId");
  assert.equal(diffLabel.typeText, "reference");
  assert.equal(diffLabel.commentText, "所有者");
});

// 表头文本组装测试：验证 MySQL 驱动下的字段名、精确类型与 comment 展示规则。
test("buildHeaderDisplayLines: MySQL 驱动应优先展示 columnType 与 comment", () => {
  const lines = buildHeaderDisplayLines(
    "status",
    { columnType: "enum('active','inactive')", mysqlDataType: "enum", comment: "用户状态" },
    { gridAdapter: mysqlDriver.gridAdapter }
  );
  assert.equal(lines.primary, "status");
  assert.equal(lines.typeText, "enum");
  assert.equal(lines.commentText, "用户状态");
});

// 表头动态行高测试：无类型且无注释时 28px，任一存在时 38px，两者皆存在时 50px。
test("resolveHeaderLineReservation: 应按全量列动态保留行位并计算表头高度", () => {
  const single = resolveHeaderLineReservation({
    displayColumns: ["id", "name"],
    fieldMetadataMap: { id: {}, name: {} },
    gridAdapter: mysqlDriver.gridAdapter,
    showTypeLine: true,
    showCommentLine: true
  });
  assert.equal(single.reserveTypeLine, false);
  assert.equal(single.reserveCommentLine, false);
  assert.equal(single.headerHeight, HEADER_HEIGHT_SINGLE_LINE);

  const twoLines = resolveHeaderLineReservation({
    displayColumns: ["id", "name"],
    fieldMetadataMap: { id: { columnType: "bigint" }, name: {} },
    gridAdapter: mysqlDriver.gridAdapter,
    showTypeLine: true,
    showCommentLine: true
  });
  assert.equal(twoLines.reserveTypeLine, true);
  assert.equal(twoLines.reserveCommentLine, false);
  assert.equal(twoLines.headerHeight, HEADER_HEIGHT_TWO_LINES);

  const threeLines = resolveHeaderLineReservation({
    displayColumns: ["id", "name"],
    fieldMetadataMap: { id: { columnType: "bigint" }, name: { comment: "名称" } },
    gridAdapter: mysqlDriver.gridAdapter,
    showTypeLine: true,
    showCommentLine: true
  });
  assert.equal(threeLines.reserveTypeLine, true);
  assert.equal(threeLines.reserveCommentLine, true);
  assert.equal(threeLines.headerHeight, HEADER_HEIGHT_THREE_LINES);

  // 关闭设置开关后应自动收紧行高。
  const disabledBoth = resolveHeaderLineReservation({
    displayColumns: ["id", "name"],
    fieldMetadataMap: { id: { columnType: "bigint" }, name: { comment: "名称" } },
    gridAdapter: mysqlDriver.gridAdapter,
    showTypeLine: false,
    showCommentLine: false
  });
  assert.equal(disabledBoth.headerHeight, HEADER_HEIGHT_SINGLE_LINE);
});

// 表头类型着色测试：验证常见 MySQL / Salesforce 类型语义分类与颜色区分。
test("resolveHeaderTypeVisualKind: 应正确分类并着色常见数据类型", () => {
  assert.equal(resolveHeaderTypeVisualKind("bigint(20) unsigned"), "integer");
  assert.equal(resolveHeaderTypeVisualKind("decimal(10,2)"), "numeric");
  assert.equal(resolveHeaderTypeVisualKind("varchar(255)"), "string");
  assert.equal(resolveHeaderTypeVisualKind("tinyint(1)"), "boolean");
  assert.equal(resolveHeaderTypeVisualKind("datetime"), "temporal");
  assert.equal(resolveHeaderTypeVisualKind("json"), "structured");
  assert.equal(resolveHeaderTypeVisualKind("reference"), "identifier");
  assert.equal(resolveHeaderTypeVisualKind("longblob"), "binary");
  assert.equal(resolveHeaderTypeVisualKind("geometry"), "spatial");
  assert.notEqual(resolveHeaderTypeColor("int"), resolveHeaderTypeColor("varchar(64)"));
});

// 控制台元数据解析测试：无 describe 时应回退使用结果集 columnTypes。
test("resolveFieldMetadataForExecutor: 无表元数据时应回退到结果集运行时类型", () => {
  const metadata = resolveFieldMetadataForExecutor("total_cnt", "", {}, [{ total_cnt: 42 }], {
    total_cnt: "bigint"
  });
  assert.deepEqual(metadata, {
    type: "bigint",
    columnType: "bigint"
  });
});

test("DataGrid 表头: DataGridSurface 应支持动态传入 headerHeight", () => {
  const surfaceSource = readFileSync(
    new URL("../../src/components/DataGrid/components/DataGridSurface.tsx", import.meta.url),
    "utf8"
  );
  assert.equal(surfaceSource.includes("headerHeight={headerHeight}"), true);
  assert.equal(surfaceSource.includes("top: headerHeight + records.length * DATA_GRID_ROW_HEIGHT"), true);
});
