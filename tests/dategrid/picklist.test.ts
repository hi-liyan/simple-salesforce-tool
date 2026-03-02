import test from "node:test";
import assert from "node:assert/strict";
import {
  getPicklistEditorOptions,
  normalizePicklistValue,
  PICKLIST_NONE_VALUE,
  resolvePicklistDisplayText
} from "../../src/components/DataGrid/utils/picklist.ts";

// picklist 工具函数测试：验证 None 注入与值/显示文本映射。
test("getPicklistEditorOptions: 可空字段首项应为 None", () => {
  const metadata = {
    nillable: true,
    picklistValues: [
      { value: "A", label: "Alpha", active: true },
      { value: "B", label: "Beta", active: true }
    ]
  } as Record<string, unknown>;
  const options = getPicklistEditorOptions(metadata);
  assert.equal(options[0]?.value, PICKLIST_NONE_VALUE);
});

test("normalizePicklistValue: null/undefined 应归一化为空值", () => {
  assert.equal(normalizePicklistValue(null), PICKLIST_NONE_VALUE);
  assert.equal(normalizePicklistValue(undefined), PICKLIST_NONE_VALUE);
  assert.equal(normalizePicklistValue("A"), "A");
});

test("resolvePicklistDisplayText: 应优先返回匹配项 label", () => {
  const options = [
    { label: "Alpha", value: "A" },
    { label: "Beta", value: "B" }
  ];
  assert.equal(resolvePicklistDisplayText("A", options), "Alpha");
  assert.equal(resolvePicklistDisplayText("Z", options), "Z");
});
