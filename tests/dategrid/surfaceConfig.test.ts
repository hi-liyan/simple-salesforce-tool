import test from "node:test";
import assert from "node:assert/strict";
import { getDataGridSelectionConfig } from "../../src/components/DataGrid/logic/surfaceConfig.ts";

test("getDataGridSelectionConfig: 应启用 multi-rect 以支持 Ctrl/Command 追加离散行选区", () => {
  const config = getDataGridSelectionConfig();

  assert.equal(config.freezeColumns, 1);
  assert.equal(config.rangeSelect, "multi-rect");
});
