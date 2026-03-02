import test from "node:test";
import assert from "node:assert/strict";
import {
  normalizeDatetimeValueForSave,
  normalizeDateValueForSave,
  resolveSalesforceTimezone
} from "../../src/components/DataGrid/utils/datetime.ts";

// datetime 工具函数测试：验证时区解析与保存值规范化行为。
test("resolveSalesforceTimezone: 非法时区应返回 null，合法时区应保留", () => {
  assert.equal(resolveSalesforceTimezone("Asia/Shanghai"), "Asia/Shanghai");
  assert.equal(resolveSalesforceTimezone("Invalid/Timezone"), null);
  assert.equal(resolveSalesforceTimezone("   "), null);
});

test("normalizeDatetimeValueForSave: 应将 datetime-local 规范为 Salesforce 格式", () => {
  const normalized = normalizeDatetimeValueForSave("2025-01-15T09:30", "Asia/Shanghai");
  assert.ok(typeof normalized === "string");
  assert.match(normalized!, /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}[+-]\d{4}$/);
});

test("normalizeDateValueForSave: 应输出 YYYY-MM-DD", () => {
  assert.equal(normalizeDateValueForSave("2025-03-02"), "2025-03-02");
  assert.equal(normalizeDateValueForSave("2025-03-02T00:00"), "2025-03-02");
});
