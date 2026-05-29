import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

test("QueryPanel 删除标记: 右上角提示应使用 warning 类型", () => {
  const runtimeSource = readFileSync(new URL("../../src/features/main/QueryPanel/hooks/useQueryPanelRuntime.ts", import.meta.url), "utf8");
  const paneSource = readFileSync(new URL("../../src/features/main/QueryPanel/components/DataQueryTabPane.tsx", import.meta.url), "utf8");
  const typesSource = readFileSync(new URL("../../src/types/index.ts", import.meta.url), "utf8");

  assert.equal(
    runtimeSource.includes('notice: { type: "warning", message: `已标记 ${activeTab.selectedRecordIds.length} 条记录，执行更新时删除。` }'),
    true
  );
  assert.equal(typesSource.includes('type: "error" | "success" | "warning";'), true);
  assert.equal(
    paneSource.includes('tone={activeTab.notice.type === "error" ? "error" : activeTab.notice.type === "warning" ? "warning" : "success"}'),
    true
  );
});
