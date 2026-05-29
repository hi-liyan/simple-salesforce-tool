import test from "node:test";
import assert from "node:assert/strict";
import {
  createUnicodeConverterHistoryEntry,
  dedupeAndCapUnicodeConverterHistory,
  deleteUnicodeConverterHistoryEntry,
  normalizeUnicodeConverterToolPersistedState,
  convertAsciiToUnicode,
  convertChineseToUnicode,
  convertUnicodeToAscii,
  convertUnicodeToChinese,
  type UnicodeConverterHistoryEntry,
  type UnicodeConverterToolPersistedState
} from "../../src/features/main/ToolsPanel/logic/unicodeConverter.ts";

// 构造最小持久化状态：供历史记录与归一化测试复用。
function createPersistedState(): UnicodeConverterToolPersistedState {
  return {
    inputText: "\\u0041\\u0042",
    outputText: "AB",
    outputFormat: "js-unicode",
    history: []
  };
}

test("convertUnicodeToChinese: 应同时支持 JS Unicode 与 HTML 实体解码", () => {
  assert.equal(convertUnicodeToChinese("\\u4F60\\u597D"), "你好");
  assert.equal(convertUnicodeToChinese("&#20320;&#22909;"), "你好");
  assert.equal(convertUnicodeToChinese("\\u4F60 and &#22909;"), "你 and 好");
});

test("convertChineseToUnicode: 应统一输出 JS Unicode 格式", () => {
  assert.equal(convertChineseToUnicode("你好A"), "\\u4F60\\u597DA");
  assert.equal(convertChineseToUnicode("你好", "html-entity"), "&#20320;&#22909;");
});

test("convertAsciiToUnicode 与 convertUnicodeToAscii: 应只处理 ASCII 范围", () => {
  assert.equal(convertAsciiToUnicode("Az!"), "\\u0041\\u007A\\u0021");
  assert.equal(convertAsciiToUnicode("Az!", "html-entity"), "&#65;&#122;&#33;");
  assert.equal(convertUnicodeToAscii("\\u0041\\u007A\\u0021"), "Az!");
  assert.throws(() => convertAsciiToUnicode("你好"), /ASCII/u);
  assert.throws(() => convertUnicodeToAscii("\\u4F60"), /ASCII/u);
});

test("normalizeUnicodeConverterToolPersistedState: 应回退缺失字段并清洗非法历史数据", () => {
  const result = normalizeUnicodeConverterToolPersistedState({
    inputText: 123,
    outputText: null,
    outputFormat: "invalid",
    history: [
      {
        id: "unicode-history-1",
        mode: "unicode-to-chinese",
        inputText: "\\u4F60\\u597D",
        outputText: "你好",
        createdAt: "2026-05-29T10:00:00.000Z",
        outputFormat: "js-unicode"
      },
      {
        id: "",
        mode: "invalid",
        inputText: "",
        outputText: "",
        createdAt: ""
      }
    ]
  });

  assert.deepEqual(result, {
    inputText: "",
    outputText: "",
    outputFormat: "js-unicode",
    history: [
      {
        id: "unicode-history-1",
        mode: "unicode-to-chinese",
        inputText: "\\u4F60\\u597D",
        outputText: "你好",
        createdAt: "2026-05-29T10:00:00.000Z",
        outputFormat: "js-unicode"
      }
    ]
  });
});

test("dedupeAndCapUnicodeConverterHistory: 同模式相同输入应上移到顶部并裁剪上限", () => {
  const history: UnicodeConverterHistoryEntry[] = [
    createUnicodeConverterHistoryEntry("1", "unicode-to-chinese", "\\u0041", "A", "2026-05-29T10:00:00.000Z", "js-unicode"),
    createUnicodeConverterHistoryEntry("2", "chinese-to-unicode", "你好", "\\u4F60\\u597D", "2026-05-29T10:01:00.000Z", "js-unicode"),
    createUnicodeConverterHistoryEntry("3", "ascii-to-unicode", "ABC", "\\u0041\\u0042\\u0043", "2026-05-29T10:02:00.000Z", "js-unicode")
  ];

  const result = dedupeAndCapUnicodeConverterHistory(
    history,
    createUnicodeConverterHistoryEntry("4", "chinese-to-unicode", "你好", "\\u4F60\\u597D", "2026-05-29T10:03:00.000Z", "js-unicode"),
    3
  );

  assert.equal(result.length, 3);
  assert.deepEqual(result.map((item) => item.id), ["4", "3", "1"]);
});

test("deleteUnicodeConverterHistoryEntry: 应支持单个删除和全部清空", () => {
  const history: UnicodeConverterHistoryEntry[] = [
    createUnicodeConverterHistoryEntry("1", "unicode-to-chinese", "\\u0041", "A", "2026-05-29T10:00:00.000Z", "js-unicode"),
    createUnicodeConverterHistoryEntry("2", "ascii-to-unicode", "ABC", "\\u0041\\u0042\\u0043", "2026-05-29T10:01:00.000Z", "js-unicode")
  ];

  assert.deepEqual(
    deleteUnicodeConverterHistoryEntry(history, "1").map((item) => item.id),
    ["2"]
  );
  assert.deepEqual(deleteUnicodeConverterHistoryEntry(history), []);
});
