import test from "node:test";
import assert from "node:assert/strict";
import { resolveRowContextMenuCapabilities } from "../../src/components/DataGrid/logic/contextMenu.ts";

test("resolveRowContextMenuCapabilities: MySQL 有默认值字段应显示 Set 默认值", () => {
  const capabilities = resolveRowContextMenuCapabilities({
    selectedSourceType: "mysql",
    metadata: {
      nillable: true,
      updateable: true,
      columnDefault: "CURRENT_TIMESTAMP"
    },
    isNewRow: false,
    isDataColumn: true
  });

  assert.equal(capabilities.canSetNullish, true);
  assert.equal(capabilities.nullishActionLabel, "Set Null");
  assert.equal(capabilities.canSetDefaultValue, true);
  assert.equal(capabilities.defaultValueActionLabel, "Set 默认值");
  assert.equal(capabilities.defaultValueMode, "mysql-default");
});

test("resolveRowContextMenuCapabilities: MySQL 新建行有默认值字段应使用 default 展示语义", () => {
  const capabilities = resolveRowContextMenuCapabilities({
    selectedSourceType: "mysql",
    metadata: {
      createable: true,
      columnDefault: "0"
    },
    isNewRow: true,
    isDataColumn: true
  });

  assert.equal(capabilities.canSetDefaultValue, true);
  assert.equal(capabilities.defaultValueMode, "mysql-default");
});
