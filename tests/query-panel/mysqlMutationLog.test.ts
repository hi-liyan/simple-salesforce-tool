import test from "node:test";
import assert from "node:assert/strict";
import { buildMysqlMutationTabLogRequest } from "../../src/features/main/QueryPanel/logic/mysqlMutationLog.ts";

// MySQL 操作日志请求体测试：确保增删改日志会输出具体 SQL，而不是仅保留数量摘要。
test("buildMysqlMutationTabLogRequest: 应按操作顺序拼接具体 SQL 文本", () => {
  const request = buildMysqlMutationTabLogRequest([
    {
      op: "create",
      operationIndex: 0,
      previewSql: "INSERT INTO users (`name`) VALUES ('Alice');"
    },
    {
      op: "update",
      operationIndex: 1,
      previewSql: "UPDATE users SET `name` = 'Bob' WHERE `id` = 1;"
    },
    {
      op: "delete",
      operationIndex: 2,
      previewSql: "DELETE FROM users WHERE `id` = 2;"
    }
  ]);

  assert.equal(
    request,
    [
      "[create#0] INSERT INTO users (`name`) VALUES ('Alice');",
      "[update#1] UPDATE users SET `name` = 'Bob' WHERE `id` = 1;",
      "[delete#2] DELETE FROM users WHERE `id` = 2;"
    ].join("\n")
  );
});

// 预览 SQL 为空时应自动跳过，避免日志中出现空白占位行。
test("buildMysqlMutationTabLogRequest: 应跳过空 SQL 条目", () => {
  const request = buildMysqlMutationTabLogRequest([
    {
      op: "create",
      operationIndex: 0,
      previewSql: ""
    },
    {
      op: "update",
      operationIndex: 1,
      previewSql: "UPDATE users SET `name` = 'Bob' WHERE `id` = 1;"
    }
  ]);

  assert.equal(request, "[update#1] UPDATE users SET `name` = 'Bob' WHERE `id` = 1;");
});
