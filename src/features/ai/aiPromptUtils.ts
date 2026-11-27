import type { AiSkillAction } from "../../types/ai";

// 结构化 `@` 对象/表引用 Chip。
export type AiPromptMentionChip = {
  kind: "object";
  // 原始引用字符串（如 `@Account`）。
  raw: string;
  // 真实对象/表名（传给后端 `mentionedObjects`）。
  name: string;
};

// 编辑器选区上下文 Chip（从控制台“发送到 AI”挂载，不污染输入框正文）。
export type AiEditorSelectionChip = {
  id: string;
  label: string;
  sql: string;
  truncated: boolean;
};

// 输入区挂载的文本或图片附件。
export type AiPromptAttachment = {
  id: string;
  kind: "text" | "image";
  name: string;
  sizeBytes: number;
  // 文本附件解码内容。
  content?: string;
  // 图片附件 Data URL（用于预览展示）。
  dataUrl?: string;
  // 是否因超出单文件字符上限而被截断。
  truncated?: boolean;
};

// 排队等待发送的输入快照。
export type AiQueuedPrompt = {
  text: string;
  mentions: AiPromptMentionChip[];
  selections: AiEditorSelectionChip[];
  attachments: AiPromptAttachment[];
};

// 技能动作元信息配置。
export type AiSkillOptionMeta = {
  value: AiSkillAction;
  label: string;
  description: string;
};

// 全部内置技能动作定义（用于底部动作选择与 `/` 斜杠命令面板）。
export const AI_SKILL_OPTIONS: AiSkillOptionMeta[] = [
  { value: "general", label: "通用", description: "自由问答与综合辅助" },
  { value: "generate", label: "生成", description: "根据需求生成可执行语句" },
  { value: "explain", label: "解释", description: "逐段解释当前语句语义" },
  { value: "optimize", label: "优化", description: "分析瓶颈并给出优化建议" },
  { value: "fix", label: "修复", description: "定位报错原因并修复语句" },
  { value: "explore", label: "探索", description: "探索表结构与样本分布" }
];

// `/` 斜杠命令项定义。
export type AiSlashCommandItem =
  | { type: "action"; command: string; action: AiSkillAction; label: string; description: string }
  | { type: "template"; command: string; label: string; description: string };

// 键盘事件最小抽象接口（便于在 Node 环境直接进行单元测试）。
export type AiPromptKeydownLikeEvent = {
  key: string;
  shiftKey?: boolean;
  isComposing?: boolean;
  keyCode?: number;
};

// 发送可用性校验状态。
export type AiPromptSubmissionState = {
  prompt: string;
  contextItemCount: number;
  isAttachmentProcessing?: boolean;
  hasSource?: boolean;
};

// 单个文本附件最大保留字符数，避免塞爆上下文窗口。
export const MAX_TEXT_ATTACHMENT_CHARS = 24_000;
// 单个图片附件最大字节数（4 MB）。
export const MAX_IMAGE_ATTACHMENT_BYTES = 4 * 1024 * 1024;
// 支持的文本附件扩展名集合。
const TEXT_ATTACHMENT_EXT_RE = /\.(csv|tsv|txt|text|md|markdown|json|yaml|yml|xml|log|sql|soql)$/i;

// 判断字符是否可作为 `@` 引用触发前的合法边界。
function isMentionBoundary(char: string | undefined): boolean {
  return !char || /\s|[([{,;:]/.test(char);
}

// 识别光标位置的 `@关键词` 引用上下文（参考 DBX `activeMentionAtCursor`）。
export function detectMentionAtCursor(
  text: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  // 从光标向左查找最近一个 `@` 符号。
  const atIndex = before.lastIndexOf("@");
  if (atIndex < 0) return null;
  if (!isMentionBoundary(before[atIndex - 1])) return null;

  const query = before.slice(atIndex + 1);
  // 若 `@` 与光标之间包含空白或换行，说明已结束该引用输入。
  if (/[\s\r\n]/.test(query)) return null;

  return {
    start: atIndex,
    end: safeCursor,
    query
  };
}

// 识别光标位置的 `/` 斜杠命令（仅在输入开头触发）。
export function detectSlashCommandAtCursor(
  text: string,
  cursor: number
): { start: number; end: number; query: string } | null {
  const safeCursor = Math.max(0, Math.min(cursor, text.length));
  const before = text.slice(0, safeCursor);
  const trimmedStart = before.trimStart();
  const match = /^\/([^\s]*)$/.exec(trimmedStart);
  if (!match) return null;

  return {
    start: before.length - trimmedStart.length,
    end: safeCursor,
    query: match[1].toLowerCase()
  };
}

// 构造并按关键词过滤 `/` 斜杠命令列表。
export function filterSlashCommands(
  query: string,
  hasTemplates: boolean
): AiSlashCommandItem[] {
  const normalized = query.trim().toLowerCase();
  const all: AiSlashCommandItem[] = AI_SKILL_OPTIONS.map((opt) => ({
    type: "action",
    command: `/${opt.value}`,
    action: opt.value,
    label: opt.label,
    description: opt.description
  }));
  if (hasTemplates) {
    all.push({
      type: "template",
      command: "/template",
      label: "模板",
      description: "打开提示词模板选择器"
    });
  }
  if (!normalized) return all;
  return all.filter(
    (item) =>
      item.command.toLowerCase().includes(normalized) ||
      item.label.toLowerCase().includes(normalized) ||
      item.description.toLowerCase().includes(normalized)
  );
}

// 判断当前键盘事件是否处于 IME 输入法组合选词阶段（防止中文 Enter 选词误发送）。
export function isAiPromptImeCompositionEvent(
  event: AiPromptKeydownLikeEvent,
  compositionActive = false
): boolean {
  return (
    compositionActive ||
    Boolean(event.isComposing) ||
    event.keyCode === 229 ||
    event.key === "Process"
  );
}

// 判断按下键盘时是否应直接提交发送消息。
export function shouldSubmitAiPromptOnKeydown(
  event: AiPromptKeydownLikeEvent,
  compositionActive = false
): boolean {
  if (event.key !== "Enter") return false;
  if (event.shiftKey) return false;
  if (isAiPromptImeCompositionEvent(event, compositionActive)) return false;
  return true;
}

// 判断当前输入区是否满足发送条件（正文非空或至少存在一个上下文 Chip/附件）。
export function canSubmitAiPrompt(state: AiPromptSubmissionState): boolean {
  if (state.isAttachmentProcessing) return false;
  if (state.hasSource === false) return false;
  return state.prompt.trim().length > 0 || state.contextItemCount > 0;
}

// 判断选中 `@` 后移除触发文本并整理光标。
export function removeMentionTriggerText(
  text: string,
  start: number,
  end: number
): { nextText: string; nextCursor: number } {
  const before = text.slice(0, start);
  const after = text.slice(end);
  const merged = `${before}${after}`.replace(/ {2,}/g, " ");
  const nextCursor = Math.min(before.length, merged.length);
  return { nextText: merged, nextCursor };
}

// 格式化文件字节大小，用于附件卡片展示。
export function formatAttachmentBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

// 将用户拖入或粘贴的 `File` 列表解析为结构化附件对象。
export async function parseFilesToPromptAttachments(
  files: File[]
): Promise<{ attachments: AiPromptAttachment[]; errors: string[] }> {
  const attachments: AiPromptAttachment[] = [];
  const errors: string[] = [];

  for (const file of files) {
    const isImage = file.type.startsWith("image/");
    if (isImage) {
      if (file.size > MAX_IMAGE_ATTACHMENT_BYTES) {
        errors.push(`图片 ${file.name} 超过 4MB 上限，已跳过。`);
        continue;
      }
      const dataUrl = await readFileAsDataUrl(file);
      attachments.push({
        id: `att-img-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        kind: "image",
        name: file.name || "pasted-image.png",
        sizeBytes: file.size,
        dataUrl
      });
      continue;
    }

    const isTextLike =
      file.type.startsWith("text/") ||
      file.type === "application/json" ||
      file.type === "application/xml" ||
      TEXT_ATTACHMENT_EXT_RE.test(file.name);
    if (!isTextLike) {
      errors.push(`暂不支持的附件类型：${file.name}`);
      continue;
    }

    const rawText = await file.text();
    const truncated = rawText.length > MAX_TEXT_ATTACHMENT_CHARS;
    attachments.push({
      id: `att-txt-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      kind: "text",
      name: file.name,
      sizeBytes: file.size,
      content: truncated ? rawText.slice(0, MAX_TEXT_ATTACHMENT_CHARS) : rawText,
      truncated
    });
  }

  return { attachments, errors };
}

// 读取图片文件为 Data URL 供预览卡片展示。
function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(typeof reader.result === "string" ? reader.result : "");
    reader.onerror = () => reject(new Error("读取图片失败"));
    reader.readAsDataURL(file);
  });
}
