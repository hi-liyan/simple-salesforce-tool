import test from "node:test";
import assert from "node:assert/strict";
import {
  extractSystemLogStructuredFailureText,
  getSystemLogPreviewSqlItems,
  parseSystemLogDetail,
  SYSTEM_LOG_COLLAPSE_CHAR_LIMIT,
  buildSystemLogContent,
  shouldCollapseSystemLogContent
} from "../../src/features/main/SettingsPanel/systemLogContent.ts";

test("buildSystemLogContent: 应在存在 detail 时输出统一的可读内容块", () => {
  assert.equal(buildSystemLogContent("请求失败", "stack line 1"), "请求失败\n\n详情:\nstack line 1");
  assert.equal(buildSystemLogContent("请求成功"), "请求成功");
});

test("parseSystemLogDetail: 应识别 MySQL 结构化日志详情", () => {
  const parsed = parseSystemLogDetail(
    JSON.stringify({
      schema: "mysql-mutation-log/v1",
      result: "failed",
      executionMode: "transaction",
      operationType: "save_records_with_deletes",
      operationIndex: 1,
      recordLocator: "id=42",
      rowsAffected: 0,
      previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
      error: "业务错误: 0 rows affected",
      items: [
        {
          operationType: "update",
          operationIndex: 1,
          recordLocator: "id=42",
          rowsAffected: 0,
          previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
          error: "业务错误: 0 rows affected",
          success: false
        }
      ]
    })
  );

  assert.equal(parsed?.schema, "mysql-mutation-log/v1");
  assert.equal(parsed?.result, "failed");
  assert.equal(parsed?.items[0]?.operationType, "update");
});

test("buildSystemLogContent: 结构化 MySQL 日志应输出执行预览 SQL 语义", () => {
  const content = buildSystemLogContent(
    "批量保存失败。",
    JSON.stringify({
      schema: "mysql-mutation-log/v1",
      result: "failed",
      executionMode: "transaction",
      operationType: "save_records_with_deletes",
      operationIndex: 1,
      recordLocator: "id=42",
      rowsAffected: 0,
      previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
      error: "业务错误: 0 rows affected",
      items: []
    })
  );

  assert.match(content, /执行预览 SQL/);
  assert.match(content, /失败定位/);
  assert.doesNotMatch(content, /原始 SQL/);
});

test("getSystemLogPreviewSqlItems: 应返回结构化日志中的预览 SQL 条目", () => {
  const items = getSystemLogPreviewSqlItems(
    JSON.stringify({
      schema: "mysql-mutation-log/v1",
      result: "success",
      executionMode: "transaction",
      previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
      items: [
        {
          operationType: "update",
          operationIndex: 1,
          recordLocator: "id=42",
          rowsAffected: 1,
          previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
          error: "",
          success: true
        }
      ]
    })
  );

  assert.equal(items.length, 1);
  assert.equal(items[0]?.operationType, "update");
  assert.match(items[0]?.previewSql || "", /UPDATE users/);
});

test("extractSystemLogStructuredFailureText: 应优先返回结构化失败定位信息", () => {
  const failureText = extractSystemLogStructuredFailureText(
    JSON.stringify({
      schema: "mysql-mutation-log/v1",
      result: "failed",
      executionMode: "transaction",
      operationType: "update",
      operationIndex: 1,
      recordLocator: "id=42",
      rowsAffected: 0,
      previewSql: "UPDATE users SET name = 'A' WHERE id = '42';",
      error: "业务错误: 0 rows affected",
      items: []
    })
  );

  assert.equal(failureText, "update#1 | record_locator=id=42 | 业务错误: 0 rows affected");
});

test("shouldCollapseSystemLogContent: 短日志内容不应默认折叠", () => {
  assert.equal(shouldCollapseSystemLogContent("同步完成", "耗时 120ms"), false);
});

test("shouldCollapseSystemLogContent: 超过字符阈值的日志内容应默认折叠", () => {
  const longMessage = "A".repeat(SYSTEM_LOG_COLLAPSE_CHAR_LIMIT + 1);
  assert.equal(shouldCollapseSystemLogContent(longMessage), true);
});

test("shouldCollapseSystemLogContent: 超过行数阈值的日志内容应默认折叠", () => {
  const multiLineDetail = ["line1", "line2", "line3", "line4", "line5"].join("\n");
  assert.equal(shouldCollapseSystemLogContent("执行异常", multiLineDetail), true);
});
