import test from "node:test";
import assert from "node:assert/strict";
import {
  filterSmartInputSuggestions,
  resolveSmartInputHighlightSegments,
  resolveQueryBarSplitRatio,
  resolveSmartInputEnterAction,
  resolveSmartInputWidth,
  shouldOpenSmartInputSuggestions
} from "../../src/features/main/QueryPanel/logic/smartInput.ts";

test("filterSmartInputSuggestions: 应按前缀优先、包含次之，并忽略大小写去重", () => {
  const suggestions = filterSmartInputSuggestions({
    suggestions: ["Name", "NAME", "CreatedDate", "AccountName", "LastModifiedDate"],
    token: "na",
    limit: 12
  });

  assert.deepEqual(suggestions, ["Name", "AccountName"]);
});

test("shouldOpenSmartInputSuggestions: 空输入仅聚焦时不应打开，但应支持手动唤起", () => {
  assert.equal(
    shouldOpenSmartInputSuggestions({
      value: "",
      token: "",
      manualTrigger: false,
      suggestionCount: 3
    }),
    false
  );

  assert.equal(
    shouldOpenSmartInputSuggestions({
      value: "",
      token: "",
      manualTrigger: true,
      suggestionCount: 3
    }),
    true
  );
});

test("shouldOpenSmartInputSuggestions: 条件后刚输入空格且当前 token 为空时不应打开候选", () => {
  assert.equal(
    shouldOpenSmartInputSuggestions({
      value: "ORDER_ID = 'a18e1fc2-a1d3-4dc2-b75c-ddf439830d10' ",
      token: "",
      manualTrigger: false,
      suggestionCount: 8
    }),
    false
  );
});

test("shouldOpenSmartInputSuggestions: 空格后继续输入新 token 时应恢复候选", () => {
  assert.equal(
    shouldOpenSmartInputSuggestions({
      value: "ORDER_ID = 'a18e1fc2-a1d3-4dc2-b75c-ddf439830d10' A",
      token: "A",
      manualTrigger: false,
      suggestionCount: 8
    }),
    true
  );
});

test("resolveSmartInputEnterAction: 未显式选择候选时回车应执行查询", () => {
  assert.equal(
    resolveSmartInputEnterAction({
      open: true,
      suggestionCount: 2,
      hasExplicitSelection: false
    }),
    "submit"
  );
});

test("resolveSmartInputEnterAction: 显式选择候选后回车应确认补全", () => {
  assert.equal(
    resolveSmartInputEnterAction({
      open: true,
      suggestionCount: 2,
      hasExplicitSelection: true
    }),
    "apply-suggestion"
  );
});

test("resolveSmartInputWidth: 内容变短时也应收缩，但不小于默认宽度", () => {
  const width = resolveSmartInputWidth({
    value: "Id",
    placeholder: "例如：CreatedDate >= LAST_N_DAYS:7",
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 640,
    allowClear: true,
    measureText: (text) => text.length * 8
  });

  assert.equal(width, 280);
});

test("resolveSmartInputWidth: 长内容应扩张到最大宽度上限", () => {
  const width = resolveSmartInputWidth({
    value: "CreatedDate >= LAST_N_DAYS:365 AND Name LIKE 'Enterprise Account%'",
    placeholder: "例如：CreatedDate >= LAST_N_DAYS:7",
    defaultWidth: 280,
    minWidth: 220,
    maxWidth: 360,
    allowClear: true,
    measureText: (text) => text.length * 10
  });

  assert.equal(width, 360);
});

test("resolveQueryBarSplitRatio: WHERE 内容变长时应优先向左扩张，而不是退回默认 50%", () => {
  const ratio = resolveQueryBarSplitRatio({
    splitRatio: 0.5,
    contentWidth: 900,
    wherePreferredWidth: 630,
    sortPreferredWidth: 300,
    minRatio: 0.3,
    maxRatio: 0.7
  });

  assert.equal(ratio, 0.6774193548387096);
});

test("resolveQueryBarSplitRatio: 排序内容变长时应优先向右扩张，并保持左侧最小宽度", () => {
  const ratio = resolveQueryBarSplitRatio({
    splitRatio: 0.5,
    contentWidth: 900,
    wherePreferredWidth: 360,
    sortPreferredWidth: 630,
    minRatio: 0.3,
    maxRatio: 0.7
  });

  assert.equal(ratio, 0.36363636363636365);
});

test("resolveQueryBarSplitRatio: 输入框内容虽未超过半栏，但连同前缀与内边距后应继续扩张", () => {
  const ratio = resolveQueryBarSplitRatio({
    splitRatio: 0.5,
    contentWidth: 900,
    wherePreferredWidth: 560,
    sortPreferredWidth: 260,
    minRatio: 0.3,
    maxRatio: 0.7
  });

  assert.equal(ratio, 0.6222222222222222);
});

test("resolveSmartInputHighlightSegments: SQL 条件中的字段、关键字和值应分配到不同高亮类型", () => {
  const segments = resolveSmartInputHighlightSegments({
    value: "CAR_ID = '123' AND amount >= 20",
    keywords: ["AND", "OR", "ASC", "DESC"],
    valueLiterals: ["NULL", "TRUE", "FALSE"]
  });

  assert.deepEqual(
    segments.map((item) => ({ text: item.text, kind: item.kind })),
    [
      { text: "CAR_ID", kind: "field" },
      { text: " ", kind: "plain" },
      { text: "=", kind: "plain" },
      { text: " ", kind: "plain" },
      { text: "'123'", kind: "value" },
      { text: " ", kind: "plain" },
      { text: "AND", kind: "keyword" },
      { text: " ", kind: "plain" },
      { text: "amount", kind: "field" },
      { text: " ", kind: "plain" },
      { text: ">=", kind: "plain" },
      { text: " ", kind: "plain" },
      { text: "20", kind: "value" }
    ]
  );
});

test("resolveSmartInputHighlightSegments: SOQL 日期字面量与排序关键字应保留高亮语义", () => {
  const segments = resolveSmartInputHighlightSegments({
    value: "CreatedDate DESC, LastModifiedDate = LAST_N_DAYS:7",
    keywords: ["ASC", "DESC", "AND", "OR"],
    valueLiterals: ["TODAY", "YESTERDAY", "LAST_N_DAYS:7"]
  });

  assert.deepEqual(
    segments.map((item) => ({ text: item.text, kind: item.kind })),
    [
      { text: "CreatedDate", kind: "field" },
      { text: " ", kind: "plain" },
      { text: "DESC", kind: "keyword" },
      { text: ",", kind: "plain" },
      { text: " ", kind: "plain" },
      { text: "LastModifiedDate", kind: "field" },
      { text: " ", kind: "plain" },
      { text: "=", kind: "plain" },
      { text: " ", kind: "plain" },
      { text: "LAST_N_DAYS:7", kind: "value" }
    ]
  );
});
