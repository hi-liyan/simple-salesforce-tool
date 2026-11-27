import assert from "node:assert/strict";
import test from "node:test";
import { buildSoqlLog } from "../../src/features/main/QueryPanel/logic/consoleQueryUtils.ts";
import { createSoqlExecutorTab } from "../../src/store/useSoqlExecutorStore.ts";

test("createSoqlExecutorTab 按数据源驱动动态生成 SQL / SOQL 标签名称", () => {
  const mysqlTab = createSoqlExecutorTab(1, { sourceId: "s-mysql", sourceType: "mysql" });
  assert.equal(mysqlTab.name, "SQL 1");

  const sfTab = createSoqlExecutorTab(2, { sourceId: "s-sf", sourceType: "salesforce" });
  assert.equal(sfTab.name, "SOQL 2");
});

test("buildSoqlLog 按传入查询语言标记日志 action", () => {
  const mysqlLog = buildSoqlLog(true, "SELECT 1;", "执行成功", undefined, "SQL");
  assert.equal(mysqlLog.action, "SQL");

  const sfLog = buildSoqlLog(true, "SELECT Id FROM Account", "执行成功", undefined, "SOQL");
  assert.equal(sfLog.action, "SOQL");
});
