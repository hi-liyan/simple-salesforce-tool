import test from "node:test";
import assert from "node:assert/strict";
import * as queryPagination from "../../src/components/DataGrid/logic/queryPagination.ts";

const { buildQueryPaginationState } = queryPagination;

test("queryPagination: 首屏应输出 1-start/end 范围与总数文案", () => {
  assert.deepEqual(
    buildQueryPaginationState({
      totalSize: 765,
      loadedRowCount: 500,
      pageSize: 500,
      currentOffset: 0
    }),
    {
      pageSize: 500,
      currentOffset: 0,
      startRow: 1,
      endRow: 500,
      totalSize: 765,
      rangeLabel: "1-500",
      totalLabel: "of 765",
      canGoFirst: false,
      canGoPrevious: false,
      canGoNext: true,
      canGoLast: true
    }
  );
});

test("queryPagination: 空结果应回退为 0-0 of 0", () => {
  assert.deepEqual(
    buildQueryPaginationState({
      totalSize: 0,
      loadedRowCount: 0,
      pageSize: 100,
      currentOffset: 0
    }),
    {
      pageSize: 100,
      currentOffset: 0,
      startRow: 0,
      endRow: 0,
      totalSize: 0,
      rangeLabel: "0-0",
      totalLabel: "of 0",
      canGoFirst: false,
      canGoPrevious: false,
      canGoNext: false,
      canGoLast: false
    }
  );
});

test("queryPagination: 非首页时应允许前翻，并按 offset 计算范围", () => {
  assert.deepEqual(
    buildQueryPaginationState({
      totalSize: 765,
      loadedRowCount: 100,
      pageSize: 100,
      currentOffset: 200
    }),
    {
      pageSize: 100,
      currentOffset: 200,
      startRow: 201,
      endRow: 300,
      totalSize: 765,
      rangeLabel: "201-300",
      totalLabel: "of 765",
      canGoFirst: true,
      canGoPrevious: true,
      canGoNext: true,
      canGoLast: true
    }
  );
});

test("queryPagination: 当后端 totalSize 仅等于当前满页条数时，仍应允许乐观下一页", () => {
  assert.deepEqual(
    buildQueryPaginationState({
      totalSize: 100,
      loadedRowCount: 100,
      pageSize: 100,
      currentOffset: 0
    }),
    {
      pageSize: 100,
      currentOffset: 0,
      startRow: 1,
      endRow: 100,
      totalSize: 100,
      rangeLabel: "1-100",
      totalLabel: "of 100+",
      canGoFirst: false,
      canGoPrevious: false,
      canGoNext: true,
      canGoLast: false
    }
  );
});

test("queryPagination: 乐观下一页场景应计算到下一页 offset，而不是停留在当前页", () => {
  assert.equal(typeof queryPagination.resolveQueryPageNavigationOffset, "function");
  assert.equal(
    queryPagination.resolveQueryPageNavigationOffset?.({
      action: "next",
      totalSize: 100,
      loadedRowCount: 100,
      pageSize: 100,
      currentOffset: 0
    }),
    100
  );
});

test("queryPagination: 第二页满页且后端 totalSize 仍只返回单页条数时，应继续支持乐观下一页与合理范围文案", () => {
  assert.deepEqual(
    buildQueryPaginationState({
      totalSize: 100,
      loadedRowCount: 100,
      pageSize: 100,
      currentOffset: 100
    }),
    {
      pageSize: 100,
      currentOffset: 100,
      startRow: 101,
      endRow: 200,
      totalSize: 200,
      rangeLabel: "101-200",
      totalLabel: "of 200+",
      canGoFirst: true,
      canGoPrevious: true,
      canGoNext: true,
      canGoLast: false
    }
  );
  assert.equal(
    queryPagination.resolveQueryPageNavigationOffset?.({
      action: "next",
      totalSize: 100,
      loadedRowCount: 100,
      pageSize: 100,
      currentOffset: 100
    }),
    200
  );
});
