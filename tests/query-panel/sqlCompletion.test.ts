import test from "node:test";
import assert from "node:assert/strict";
import {
  computeSqlCompletions,
  extractLocalCreateTables,
  extractStatementAliases,
  extractStatementAtCursor
} from "../../src/components/codemirror/sqlCompletion.ts";

test("extractStatementAtCursor: 多语句下仅扫描光标所在的当前语句", () => {
  const doc = "SELECT 'a;b' FROM orders; SELECT u. FROM users u;";
  const cursor = doc.indexOf("u.") + 2;
  const scoped = extractStatementAtCursor(doc, cursor);

  assert.equal(scoped.statement.trim(), "SELECT u. FROM users u");
});

test("extractLocalCreateTables: 应解析文档中未执行的 CREATE TABLE 列定义", () => {
  const doc = `
    CREATE TABLE IF NOT EXISTS temp_metrics (
      id BIGINT PRIMARY KEY,
      metric_name VARCHAR(64),
      score DECIMAL(10, 2)
    );
    SELECT tm. FROM temp_metrics tm;
  `;
  const localTables = extractLocalCreateTables(doc);
  assert.deepEqual(localTables.temp_metrics, ["id", "metric_name", "score"]);

  const completion = computeSqlCompletions(doc, doc.indexOf("tm.") + 3, false, {
    language: "mysql",
    objects: ["users"],
    fields: [],
    objectFields: { users: ["id", "email"] }
  });

  assert.ok(completion);
  const labels = completion.options.map((item) => item.label);
  assert.deepEqual(labels, ["id", "metric_name", "score"]);
});

test("computeSqlCompletions: 支持 CTE、JOIN 别名点号提示与 FROM 表名提示", () => {
  const sql = "WITH active_users AS (SELECT id FROM users) SELECT u. FROM users u JOIN orders o ON o.user_id = u.id";
  const dotCompletion = computeSqlCompletions(sql, sql.indexOf("u.") + 2, false, {
    language: "mysql",
    objects: ["users", "orders"],
    fields: [],
    objectFields: {
      users: ["id", "name", "email"],
      orders: ["id", "user_id", "amount"]
    }
  });
  assert.ok(dotCompletion);
  assert.deepEqual(
    dotCompletion.options.map((o) => o.label),
    ["id", "name", "email"]
  );

  const aliases = extractStatementAliases(sql);
  assert.equal(aliases.active_users, "active_users");
  assert.equal(aliases.u, "users");
  assert.equal(aliases.o, "orders");

  const fromSql = "SELECT * FROM ";
  const fromCompletion = computeSqlCompletions(fromSql, fromSql.length, false, {
    language: "mysql",
    objects: ["users", "orders"],
    fields: [],
    objectFields: {}
  });
  assert.ok(fromCompletion);
  assert.ok(fromCompletion.options.some((o) => o.label === "users"));
  assert.ok(fromCompletion.options.some((o) => o.label === "orders"));
});
