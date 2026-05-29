import test from "node:test";
import assert from "node:assert/strict";
import * as queryPagination from "../../src/components/DataGrid/logic/queryPagination.ts";
import { buildQueryStatement } from "../../src/features/main/QueryPanel/logic/queryUtils.ts";

test("buildQueryStatement: 应为 Salesforce 查询拼接 OFFSET", () => {
  const soql = buildQueryStatement("salesforce", "Account", ["Id", "Name"], "", "Name", "ASC", 200, "", 400);
  assert.match(soql, /\nLIMIT 200\nOFFSET 400$/);
});

test("buildQueryStatement: 应为 MySQL 查询拼接 OFFSET", () => {
  const sql = buildQueryStatement("mysql", "users", ["id", "name"], "", "", "DESC", 100, "id DESC", 300);
  assert.match(sql, /\nLIMIT 100\nOFFSET 300$/);
});

test("queryStatementPagination: 自定义执行成功后应从语句同步 limit 与排序状态", () => {
  assert.equal(typeof queryPagination.resolveExecutedQueryStatementState, "function");
  assert.deepEqual(
    queryPagination.resolveExecutedQueryStatementState?.({
      queryText: "SELECT Id, Name FROM Account ORDER BY Name ASC LIMIT 50",
      fallbackLimit: 200,
      fallbackSortField: "CreatedDate",
      fallbackSortDirection: "DESC",
      fallbackSortClause: ""
    }),
    {
      limit: 50,
      sortField: "Name",
      sortDirection: "ASC",
      sortClause: "Name ASC"
    }
  );
});

test("queryStatementPagination: 解析主查询分页状态时不应被子查询中的 ORDER BY 与 LIMIT 污染", () => {
  assert.deepEqual(
    queryPagination.resolveExecutedQueryStatementState?.({
      queryText:
        "SELECT Id, (SELECT LastName FROM Contacts ORDER BY LastName DESC LIMIT 5) FROM Account ORDER BY CreatedDate DESC LIMIT 20",
      fallbackLimit: 200,
      fallbackSortField: "Name",
      fallbackSortDirection: "ASC",
      fallbackSortClause: ""
    }),
    {
      limit: 20,
      sortField: "CreatedDate",
      sortDirection: "DESC",
      sortClause: "CreatedDate DESC"
    }
  );
});
