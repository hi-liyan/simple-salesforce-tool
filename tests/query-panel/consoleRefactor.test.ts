import test from "node:test";
import assert from "node:assert/strict";
import { splitSqlStatementsWithRanges } from "../../src/components/codemirror/sqlCompletion.ts";
import { resolveWorkingSource } from "../../src/features/main/QueryPanel/logic/activeSourceResolution.ts";
import { isSchemaChangingDdl } from "../../src/features/main/QueryPanel/logic/consoleQueryUtils.ts";
import type { SalesforceSource } from "../../src/types/index.ts";

function makeSource(id: string, name: string): SalesforceSource {
  return {
    id,
    name,
    sortOrder: 0,
    sourceType: "mysql",
    configJson: {},
    instanceUrl: "",
    accessToken: "",
    apiVersion: "mysql",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z"
  };
}

test("splitSqlStatementsWithRanges: 应准确切分多条 SQL 并忽略字符串与注释内分号", () => {
  const doc = [
    "-- 查询司机; 注释分号忽略",
    "SELECT * FROM drivers WHERE note = 'a;b';",
    "/* 块注释; 也忽略 */",
    "SELECT id, name FROM vehicles LIMIT 10;"
  ].join("\n");

  const ranges = splitSqlStatementsWithRanges(doc);
  assert.equal(ranges.length, 2);
  assert.equal(ranges[0]?.sql.endsWith("'a;b'"), true);
  assert.equal(ranges[1]?.sql.includes("FROM vehicles LIMIT 10"), true);
});

test("resolveWorkingSource: 应按激活 Tab -> 树焦点 -> 全局选中 -> 首个数据源优先级解析", () => {
  const s1 = makeSource("s1", "Source 1");
  const s2 = makeSource("s2", "Source 2");
  const s3 = makeSource("s3", "Source 3");

  // 优先级 1：激活工作区 Tab
  const byActiveTab = resolveWorkingSource({
    sources: [s1, s2, s3],
    activeWorkspaceTab: { id: "data:s2:users", kind: "data", title: "users", sourceId: "s2" },
    focusedSourceId: "s3",
    selectedSourceId: "s1"
  });
  assert.equal(byActiveTab?.id, "s2");

  // 优先级 2：树焦点
  const byTreeFocus = resolveWorkingSource({
    sources: [s1, s2, s3],
    activeWorkspaceTab: null,
    focusedSourceId: "s3",
    selectedSourceId: "s1"
  });
  assert.equal(byTreeFocus?.id, "s3");

  // 优先级 4：均为空时回退首个数据源
  const byFallback = resolveWorkingSource({
    sources: [s1, s2],
    activeWorkspaceTab: null,
    focusedSourceId: "",
    selectedSourceId: ""
  });
  assert.equal(byFallback?.id, "s1");
});

test("isSchemaChangingDdl: 应识别 DDL 语句并排除普通查询", () => {
  assert.equal(isSchemaChangingDdl("CREATE TABLE test_t (id INT);"), true);
  assert.equal(isSchemaChangingDdl("-- comment\nALTER TABLE test_t ADD COLUMN name VARCHAR(32);"), true);
  assert.equal(isSchemaChangingDdl("DROP TABLE IF EXISTS test_t;"), true);
  assert.equal(isSchemaChangingDdl("SELECT * FROM test_t;"), false);
});
