import test from "node:test";
import assert from "node:assert/strict";
import { GridCellKind } from "@glideapps/glide-data-grid";
import { createCellEditedHandler } from "../../src/components/DataGrid/logic/cellEditHandler.ts";
import {
  createMysqlDraftNullValue,
  createMysqlDraftOmitValue,
  createMysqlDraftValue
} from "../../src/features/main/QueryPanel/logic/mysqlValueSemantics.ts";

// 构造最小化的 DataGrid 编辑处理器，专注验证 MySQL 编辑值语义。
function createMysqlHandler(params?: {
  records?: Record<string, unknown>[];
  metadata?: Record<string, unknown>;
}) {
  const edited: Array<{ rowIndex: number; columnName: string; value: unknown }> = [];
  const messages: string[] = [];
  const handler = createCellEditedHandler({
    columns: [{ id: "price", title: "price" }],
    records: params?.records || [{}],
    fieldMetadataMap: {
      price: params?.metadata || { mysqlDataType: "int", type: "int", nillable: true }
    },
    effectiveSalesforceTimezone: null,
    selectedSourceType: "mysql",
    onEditCell: (rowIndex, columnName, value) => {
      edited.push({ rowIndex, columnName, value });
    },
    onShowMessage: (message) => {
      messages.push(message);
    }
  });

  return {
    handler,
    edited,
    messages
  };
}

test("createCellEditedHandler: MySQL 新增行清空数字字段时应回退为 omit 语义", () => {
  const { handler, edited, messages } = createMysqlHandler({
    records: [{ __isNew: true }],
    metadata: { mysqlDataType: "int", type: "int", nillable: true }
  });

  handler([0, 0], { kind: GridCellKind.Number, data: undefined, displayData: "" });

  assert.deepEqual(messages, []);
  assert.deepEqual(edited, [{ rowIndex: 0, columnName: "price", value: createMysqlDraftOmitValue() }]);
});

test("createCellEditedHandler: MySQL 旧行清空数字字段时应写入 null 语义", () => {
  const { handler, edited, messages } = createMysqlHandler({
    records: [{ id: 1 }],
    metadata: { mysqlDataType: "int", type: "int", nillable: true }
  });

  handler([0, 0], { kind: GridCellKind.Number, data: undefined, displayData: "" });

  assert.deepEqual(messages, []);
  assert.deepEqual(edited, [{ rowIndex: 0, columnName: "price", value: createMysqlDraftNullValue() }]);
});

test("createCellEditedHandler: MySQL 文本空字符串应保留为显式 value 语义", () => {
  const { handler, edited } = createMysqlHandler({
    records: [{ __isNew: true }],
    metadata: { mysqlDataType: "varchar", type: "string", nillable: true }
  });

  handler([0, 0], { kind: GridCellKind.Text, data: "", displayData: "" });

  assert.deepEqual(edited, [{ rowIndex: 0, columnName: "price", value: createMysqlDraftValue("") }]);
});
