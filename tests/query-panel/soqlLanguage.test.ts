import test from "node:test";
import assert from "node:assert/strict";
import { extractMainFromObjectName } from "../../src/components/monaco/languages/soqlLanguage.ts";

// 主查询对象提取：基础 FROM 场景应返回对象名。
test("SOQL 主查询对象提取：基础查询", () => {
  assert.equal(extractMainFromObjectName("SELECT Id FROM Account"), "Account");
});

// 主查询对象提取：应忽略子查询中的 FROM，只返回顶层对象。
test("SOQL 主查询对象提取：忽略子查询 FROM", () => {
  assert.equal(
    extractMainFromObjectName("SELECT Id, (SELECT Id FROM Contacts) FROM Account WHERE Name = 'Demo'"),
    "Account"
  );
});

// 主查询对象提取：字符串字面量中的 FROM 不应干扰顶层对象识别。
test("SOQL 主查询对象提取：忽略字符串中的 FROM", () => {
  assert.equal(
    extractMainFromObjectName("SELECT Id FROM Account WHERE Name = 'FROM Contact' ORDER BY CreatedDate DESC"),
    "Account"
  );
});

// 主查询对象提取：没有顶层 FROM 时返回空值，避免误作用域补全。
test("SOQL 主查询对象提取：缺失 FROM 返回空值", () => {
  assert.equal(extractMainFromObjectName("SELECT Id, Name"), null);
});
