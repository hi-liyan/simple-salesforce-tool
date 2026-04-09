import test from "node:test";
import assert from "node:assert/strict";
import { estimateAutoColumnWidth } from "../../src/components/DataGrid/utils/columnWidth.ts";

// DataGrid 自动列宽测试：默认宽度应参考表头与前 50 行内容中的最大值。
test("estimateAutoColumnWidth: 长文本内容应将默认列宽撑大", () => {
  const width = estimateAutoColumnWidth({
    fieldName: "description",
    metadata: { label: "描述" },
    records: [
      { description: "短文本" },
      { description: "这是一段明显长于默认列宽预估的内容，用于验证列宽会按内容自动展开。" }
    ],
    sampleRowCount: 50
  });

  assert.ok(width > 180);
});

// DataGrid 自动列宽测试：只采样前 N 行，避免超大结果集拖慢初始化。
test("estimateAutoColumnWidth: 仅采样前 50 行内容", () => {
  const records = Array.from({ length: 60 }, (_, index) => ({
    code: index === 55 ? "超过采样窗口的超长文本不应影响默认列宽".repeat(4) : "A1"
  }));

  const width = estimateAutoColumnWidth({
    fieldName: "code",
    metadata: { label: "编码" },
    records,
    sampleRowCount: 50
  });

  assert.ok(width < 300);
});
