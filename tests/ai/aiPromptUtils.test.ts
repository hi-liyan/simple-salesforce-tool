import assert from "node:assert/strict";
import test from "node:test";
import {
  canSubmitAiPrompt,
  detectMentionAtCursor,
  detectSlashCommandAtCursor,
  filterSlashCommands,
  formatAttachmentBytes,
  isAiPromptImeCompositionEvent,
  removeMentionTriggerText,
  shouldSubmitAiPromptOnKeydown
} from "../../src/features/ai/aiPromptUtils.ts";

test("detectMentionAtCursor 正确识别光标处 @ 引用边界与关键词", () => {
  assert.deepEqual(detectMentionAtCursor("查询 @Acc", 7), {
    start: 3,
    end: 7,
    query: "Acc"
  });
  assert.deepEqual(detectMentionAtCursor("@", 1), {
    start: 0,
    end: 1,
    query: ""
  });
  // 非边界字符（如邮箱）不触发 `@` 引用。
  assert.equal(detectMentionAtCursor("foo@bar", 7), null);
  // `@` 后出现空格说明引用已结束。
  assert.equal(detectMentionAtCursor("@Account 字段", 11), null);
});

test("detectSlashCommandAtCursor 与 filterSlashCommands 正确识别并过滤斜杠命令", () => {
  assert.deepEqual(detectSlashCommandAtCursor("/opt", 4), {
    start: 0,
    end: 4,
    query: "opt"
  });
  assert.equal(detectSlashCommandAtCursor("hello /opt", 10), null);

  const filtered = filterSlashCommands("opt", true);
  assert.equal(filtered.length, 1);
  assert.equal(filtered[0].command, "/optimize");

  const withTpl = filterSlashCommands("tem", true);
  assert.equal(withTpl.some((item) => item.type === "template"), true);
});

test("IME 组合态防护阻止中文选词 Enter 误发送", () => {
  assert.equal(isAiPromptImeCompositionEvent({ key: "Enter", isComposing: true }), true);
  assert.equal(isAiPromptImeCompositionEvent({ key: "Enter", keyCode: 229 }), true);
  assert.equal(isAiPromptImeCompositionEvent({ key: "Process" }), true);
  assert.equal(isAiPromptImeCompositionEvent({ key: "Enter" }, true), true);

  assert.equal(shouldSubmitAiPromptOnKeydown({ key: "Enter", isComposing: true }), false);
  assert.equal(shouldSubmitAiPromptOnKeydown({ key: "Enter", shiftKey: true }), false);
  assert.equal(shouldSubmitAiPromptOnKeydown({ key: "Enter" }, false), true);
});

test("canSubmitAiPrompt 支持纯上下文 Chip 发送", () => {
  assert.equal(
    canSubmitAiPrompt({ prompt: "   ", contextItemCount: 0, hasSource: true }),
    false
  );
  assert.equal(
    canSubmitAiPrompt({ prompt: "   ", contextItemCount: 1, hasSource: true }),
    true
  );
  assert.equal(
    canSubmitAiPrompt({ prompt: "查询", contextItemCount: 0, isAttachmentProcessing: true }),
    false
  );
});

test("removeMentionTriggerText 清除 @关键词 并保持光标位置", () => {
  const res = removeMentionTriggerText("帮我查 @Acc 的记录", 4, 8);
  assert.equal(res.nextText, "帮我查 的记录");
  assert.equal(res.nextCursor, 4);
});

test("formatAttachmentBytes 正确格式化文件大小", () => {
  assert.equal(formatAttachmentBytes(512), "512 B");
  assert.equal(formatAttachmentBytes(2048), "2.0 KB");
  assert.equal(formatAttachmentBytes(2 * 1024 * 1024), "2.00 MB");
});
