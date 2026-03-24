import test from "node:test";
import assert from "node:assert/strict";
import { beginRefreshingSource, finishRefreshingSource, focusSourceNode, toggleExpandedNode } from "../../src/features/main/QueryPanel/logic/sourceTreeState.ts";
import type { SourceTreeState } from "../../src/features/main/QueryPanel/types/tree.ts";

// 创建最小树状态：仅保留纯函数测试需要的字段。
function createState(): SourceTreeState {
  return {
    selectedNodeId: "",
    focusedSourceId: "",
    expandedNodeIds: [],
    sourceObjectsById: {},
    sourceTreeChildrenById: {},
    sourceLoadingById: {},
    sourceRefreshingById: {},
    sourceErrorById: {},
    sourceAuthPendingById: {}
  };
}

test("focusSourceNode: 应仅更新当前聚焦的数据源", () => {
  const next = focusSourceNode(createState(), "sf-1");
  assert.equal(next.focusedSourceId, "sf-1");
});

test("toggleExpandedNode: 应支持展开与折叠同一节点", () => {
  const expanded = toggleExpandedNode([], "source:sf-1");
  assert.deepEqual(expanded, ["source:sf-1"]);
  assert.deepEqual(toggleExpandedNode(expanded, "source:sf-1"), []);
});

test("beginRefreshingSource/finishRefreshingSource: 应仅更新目标数据源的刷新态与错误", () => {
  const refreshing = beginRefreshingSource(createState(), "sf-1");
  assert.equal(refreshing.sourceRefreshingById["sf-1"], true);
  assert.equal(refreshing.sourceErrorById["sf-1"], "");

  const finished = finishRefreshingSource(refreshing, "sf-1", "认证失败");
  assert.equal(finished.sourceRefreshingById["sf-1"], false);
  assert.equal(finished.sourceErrorById["sf-1"], "认证失败");
});
