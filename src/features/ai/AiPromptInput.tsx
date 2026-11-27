import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  AiAssistantMode,
  AiConfigView,
  AiPromptTemplateRecord,
  AiSkillAction
} from "../../types/ai";
import type { SalesforceSource } from "../../types";
import { AiPromptBottomBar } from "./AiPromptBottomBar";
import { AiPromptChipsBar } from "./AiPromptChipsBar";
import { AiPromptContextBar } from "./AiPromptContextBar";
import { AiPromptPopovers } from "./AiPromptPopovers";
import {
  canSubmitAiPrompt,
  detectMentionAtCursor,
  detectSlashCommandAtCursor,
  filterSlashCommands,
  isAiPromptImeCompositionEvent,
  parseFilesToPromptAttachments,
  removeMentionTriggerText,
  shouldSubmitAiPromptOnKeydown,
  type AiEditorSelectionChip,
  type AiPromptAttachment,
  type AiPromptMentionChip,
  type AiQueuedPrompt,
  type AiSlashCommandItem
} from "./aiPromptUtils";

type AiPromptInputProps = {
  // 当前输入文本。
  value: string;
  onChange: (value: string) => void;
  // 全部可用数据源与当前 AI 会话数据源绑定状态。
  sources: SalesforceSource[];
  effectiveSourceId: string;
  sourceName: string;
  sourceType: string;
  queryLanguage: string;
  sourceFollowsWorkspace: boolean;
  workspaceSourceName: string;
  onSelectSourceId: (sourceId: string) => void;
  hasSource: boolean;
  // 当前模式与技能动作。
  mode: AiAssistantMode;
  onModeChange: (mode: AiAssistantMode) => void;
  action: AiSkillAction;
  onActionChange: (action: AiSkillAction) => void;
  // 模型配置列表与当前选中配置。
  configs: AiConfigView[];
  selectedConfigId: string;
  onSelectConfigId: (configId: string) => void;
  // 当前数据源可引用的表/对象名列表。
  availableObjects: string[];
  // 结构化 `@` 引用 Chips。
  selectedMentions: AiPromptMentionChip[];
  onChangeMentions: (next: AiPromptMentionChip[]) => void;
  // 编辑器选区 Chips。
  selectedSelections: AiEditorSelectionChip[];
  onChangeSelections: (next: AiEditorSelectionChip[]) => void;
  // 文本/图片附件。
  attachments: AiPromptAttachment[];
  onChangeAttachments: (next: AiPromptAttachment[]) => void;
  onPreviewImage: (attachment: AiPromptAttachment) => void;
  // 自定义提示词模板及已勾选模板 ID。
  promptTemplates: AiPromptTemplateRecord[];
  selectedTemplateIds: string[];
  onToggleTemplateId: (templateId: string) => void;
  onDeselectAllTemplates: () => void;
  // 历史提问列表（支持光标在首行首列时 `ArrowUp` 回溯）。
  promptHistory: string[];
  // 排队中的待发送请求。
  queuedPrompt: AiQueuedPrompt | null;
  onEditQueuedPrompt: () => void;
  onCancelQueuedPrompt: () => void;
  // 错误/提示回调（如不支持的附件类型）。
  onAttachmentWarning?: (message: string) => void;
  // 是否正在流式生成。
  streaming: boolean;
  // 发送、排队、停止回调。
  onSend: () => void;
  onQueueSend: () => void;
  onStop: () => void;
};

// AI 输入区（全面对齐 DBX 实现）：三段式复合 Composer 容器、结构化 Chips、`@`/`/` 键盘弹层、IME 防误触、拖拽调高与附件粘贴/拖放。
export function AiPromptInput({
  value,
  onChange,
  sources,
  effectiveSourceId,
  sourceName,
  sourceType,
  queryLanguage,
  sourceFollowsWorkspace,
  workspaceSourceName,
  onSelectSourceId,
  hasSource,
  mode,
  onModeChange,
  action,
  onActionChange,
  configs,
  selectedConfigId,
  onSelectConfigId,
  availableObjects,
  selectedMentions,
  onChangeMentions,
  selectedSelections,
  onChangeSelections,
  attachments,
  onChangeAttachments,
  onPreviewImage,
  promptTemplates,
  selectedTemplateIds,
  onToggleTemplateId,
  onDeselectAllTemplates,
  promptHistory,
  queuedPrompt,
  onEditQueuedPrompt,
  onCancelQueuedPrompt,
  onAttachmentWarning,
  streaming,
  onSend,
  onQueueSend,
  onStop
}: AiPromptInputProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // 输入框高度状态（通过顶部 `.resize-handle` 拖拽调整）。
  const [textareaHeight, setTextareaHeight] = useState(88);
  // IME 输入法组合态标记，防止中文选词 Enter 误发送。
  const [compositionActive, setCompositionActive] = useState(false);
  // 拖拽文件覆盖层与处理状态。
  const [isDraggingFiles, setIsDraggingFiles] = useState(false);
  const [isProcessingFiles, setIsProcessingFiles] = useState(false);
  // 模板选择器受控开关（支持 `/template` 命令呼出）。
  const [templatePopoverOpen, setTemplatePopoverOpen] = useState(false);

  // `@` 引用弹层状态。
  const [mentionRange, setMentionRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [mentionSelectedIndex, setMentionSelectedIndex] = useState(0);
  // `/` 斜杠命令弹层状态。
  const [slashRange, setSlashRange] = useState<{ start: number; end: number; query: string } | null>(null);
  const [commandSelectedIndex, setCommandSelectedIndex] = useState(0);
  // 历史记录回溯索引与临时草稿缓存。
  const [historyIndex, setHistoryIndex] = useState(-1);
  const draftBeforeHistoryRef = useRef("");

  // 计算当前匹配的 `@` 候选对象列表。
  const mentionCandidates = useMemo(() => {
    if (!mentionRange) return [];
    const q = mentionRange.query.toLowerCase();
    return availableObjects
      .filter((name) => !q || name.toLowerCase().includes(q))
      .slice(0, 20);
  }, [availableObjects, mentionRange]);

  // 计算当前匹配的 `/` 斜杠命令列表。
  const commandItems = useMemo(() => {
    if (!slashRange) return [];
    return filterSlashCommands(slashRange.query, promptTemplates.length > 0);
  }, [promptTemplates.length, slashRange]);

  const mentionOpen = mentionRange !== null;
  const commandOpen = slashRange !== null && commandItems.length > 0;
  const contextItemCount =
    selectedMentions.length + selectedSelections.length + attachments.length;

  const canSubmit = canSubmitAiPrompt({
    prompt: value,
    contextItemCount,
    isAttachmentProcessing: isProcessingFiles,
    hasSource
  });

  // 刷新光标位置的 `/` 与 `@` 弹层状态。
  const refreshTriggerState = useCallback(
    (nextText?: string, nextCursor?: number) => {
      const text = nextText ?? value;
      const cursor = nextCursor ?? textareaRef.current?.selectionStart ?? text.length;

      const slash = detectSlashCommandAtCursor(text, cursor);
      if (slash) {
        setSlashRange(slash);
        setCommandSelectedIndex(0);
        setMentionRange(null);
        return;
      }
      setSlashRange(null);

      const mention = detectMentionAtCursor(text, cursor);
      if (mention) {
        setMentionRange(mention);
        setMentionSelectedIndex(0);
      } else {
        setMentionRange(null);
      }
    },
    [value]
  );

  // 选中 `@` 候选对象：移除输入框中的 `@关键词` 文本并加入结构化 Chip。
  function handleSelectMention(objectName: string) {
    if (!mentionRange) return;
    if (!selectedMentions.some((m) => m.name.toLowerCase() === objectName.toLowerCase())) {
      onChangeMentions([
        ...selectedMentions,
        { kind: "object", raw: `@${objectName}`, name: objectName }
      ]);
    }
    const { nextText, nextCursor } = removeMentionTriggerText(
      value,
      mentionRange.start,
      mentionRange.end
    );
    onChange(nextText);
    setMentionRange(null);
    window.requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
    });
  }

  // 选中 `/` 斜杠命令：移除 `/命令` 文本并执行对应模式/模板开关。
  function handleSelectCommand(item: AiSlashCommandItem) {
    if (slashRange) {
      const { nextText, nextCursor } = removeMentionTriggerText(
        value,
        slashRange.start,
        slashRange.end
      );
      onChange(nextText);
      window.requestAnimationFrame(() => {
        if (item.type !== "template") {
          textareaRef.current?.focus();
          textareaRef.current?.setSelectionRange(nextCursor, nextCursor);
        }
      });
    }
    setSlashRange(null);
    if (item.type === "template") {
      setTemplatePopoverOpen(true);
      return;
    }
    onActionChange(item.action);
  }

  // 解析并追加拖拽/粘贴/选择的附件文件。
  async function handleIncomingFiles(files: File[]) {
    if (files.length === 0) return;
    setIsProcessingFiles(true);
    try {
      const result = await parseFilesToPromptAttachments(files);
      if (result.attachments.length > 0) {
        onChangeAttachments([...attachments, ...result.attachments]);
      }
      if (result.errors.length > 0) {
        onAttachmentWarning?.(result.errors.join(" "));
      }
    } finally {
      setIsProcessingFiles(false);
    }
  }

  // 顶部拖拽调高逻辑（参考 DBX `.resize-handle`）。
  function handleStartResize(event: React.MouseEvent<HTMLDivElement>) {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = textareaHeight;

    function onMouseMove(moveEvent: MouseEvent) {
      const delta = startY - moveEvent.clientY;
      setTextareaHeight(Math.max(72, Math.min(260, startHeight + delta)));
    }

    function onMouseUp() {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
  }

  // 输入框清空时重置历史回溯索引。
  useEffect(() => {
    if (!value) {
      setHistoryIndex(-1);
    }
  }, [value]);

  // 统一处理键盘交互：IME 保护、`/` 与 `@` 弹层导航、历史提问回溯、Enter 发送。
  function handleKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (isAiPromptImeCompositionEvent(event.nativeEvent, compositionActive)) {
      return;
    }

    // 1. `/` 斜杠命令键盘导航。
    if (commandOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setCommandSelectedIndex((i) => Math.min(i + 1, commandItems.length - 1));
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setCommandSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if ((event.key === "Enter" || event.key === "Tab") && commandItems[commandSelectedIndex]) {
        event.preventDefault();
        handleSelectCommand(commandItems[commandSelectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setSlashRange(null);
        return;
      }
    }

    // 2. `@` 对象引用补全键盘导航。
    if (mentionOpen) {
      if (event.key === "ArrowDown") {
        event.preventDefault();
        setMentionSelectedIndex((i) =>
          Math.min(i + 1, Math.max(mentionCandidates.length - 1, 0))
        );
        return;
      }
      if (event.key === "ArrowUp") {
        event.preventDefault();
        setMentionSelectedIndex((i) => Math.max(i - 1, 0));
        return;
      }
      if (
        (event.key === "Enter" || event.key === "Tab") &&
        mentionCandidates[mentionSelectedIndex]
      ) {
        event.preventDefault();
        handleSelectMention(mentionCandidates[mentionSelectedIndex]);
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        setMentionRange(null);
        return;
      }
    }

    // 3. 历史提问回溯（光标位于首行首列时 `ArrowUp` 回溯，`ArrowDown` 前进）。
    const textarea = textareaRef.current;
    if (
      event.key === "ArrowUp" &&
      promptHistory.length > 0 &&
      textarea &&
      textarea.selectionStart === 0 &&
      textarea.selectionEnd === 0
    ) {
      event.preventDefault();
      const nextIdx = Math.min(historyIndex + 1, promptHistory.length - 1);
      if (historyIndex === -1) {
        draftBeforeHistoryRef.current = value;
      }
      setHistoryIndex(nextIdx);
      onChange(promptHistory[promptHistory.length - 1 - nextIdx]);
      return;
    }

    if (
      event.key === "ArrowDown" &&
      historyIndex >= 0 &&
      textarea &&
      textarea.selectionStart === value.length &&
      textarea.selectionEnd === value.length
    ) {
      event.preventDefault();
      const nextIdx = historyIndex - 1;
      setHistoryIndex(nextIdx);
      onChange(
        nextIdx < 0
          ? draftBeforeHistoryRef.current
          : promptHistory[promptHistory.length - 1 - nextIdx]
      );
      return;
    }

    // 4. Enter 发送（生成中自动进入排队发送）。
    if (shouldSubmitAiPromptOnKeydown(event.nativeEvent, compositionActive)) {
      event.preventDefault();
      if (!canSubmit) return;
      if (streaming) {
        onQueueSend();
      } else {
        onSend();
      }
    }
  }

  return (
    <div className="border-t border-base-300/80 bg-base-100 p-2.5">
      <div
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault();
            setIsDraggingFiles(true);
          }
        }}
        onDragLeave={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget as Node)) {
            setIsDraggingFiles(false);
          }
        }}
        onDrop={(e) => {
          e.preventDefault();
          setIsDraggingFiles(false);
          const files = Array.from(e.dataTransfer.files || []);
          void handleIncomingFiles(files);
        }}
        className="relative rounded-xl border border-base-300 bg-base-200/20 px-2.5 pb-2 pt-1.5 focus-within:border-primary/60"
      >
        {/* 顶部拖拽高度手柄（参考 DBX `.resize-handle`）。 */}
        <div
          title="上下拖拽调整输入框高度"
          onMouseDown={handleStartResize}
          className="absolute -top-1 left-2 right-2 z-10 h-2 cursor-ns-resize"
        />

        {/* 拖入文件高亮覆盖层。 */}
        {isDraggingFiles && (
          <div className="pointer-events-none absolute inset-0 z-40 flex items-center justify-center rounded-xl border-2 border-dashed border-primary bg-base-100/90 text-[12px] font-medium text-primary">
            松开以附加文件或图片
          </div>
        )}

        {/* 1. 顶部上下文栏（独立数据源切换、上下文计数、模板多选）。 */}
        <AiPromptContextBar
          sources={sources}
          effectiveSourceId={effectiveSourceId}
          sourceName={sourceName}
          sourceType={sourceType}
          queryLanguage={queryLanguage}
          sourceFollowsWorkspace={sourceFollowsWorkspace}
          workspaceSourceName={workspaceSourceName}
          streaming={streaming}
          onSelectSourceId={onSelectSourceId}
          promptTemplates={promptTemplates}
          selectedTemplateIds={selectedTemplateIds}
          onToggleTemplateId={onToggleTemplateId}
          onDeselectAllTemplates={onDeselectAllTemplates}
          templatePopoverOpen={templatePopoverOpen}
          onTemplatePopoverOpenChange={setTemplatePopoverOpen}
          contextItemCount={contextItemCount}
        />

        {/* 2. `@` 与 `/` 浮动自动补全弹层。 */}
        <AiPromptPopovers
          mentionOpen={mentionOpen}
          mentionCandidates={mentionCandidates}
          mentionSelectedIndex={mentionSelectedIndex}
          onMentionHover={setMentionSelectedIndex}
          onSelectMention={handleSelectMention}
          commandOpen={commandOpen}
          commandItems={commandItems}
          commandSelectedIndex={commandSelectedIndex}
          onCommandHover={setCommandSelectedIndex}
          onSelectCommand={handleSelectCommand}
        />

        {/* 3. 结构化 Chips 与附件卡片展示区。 */}
        <AiPromptChipsBar
          selectedSelections={selectedSelections}
          onRemoveSelection={(id) =>
            onChangeSelections(selectedSelections.filter((item) => item.id !== id))
          }
          selectedMentions={selectedMentions}
          onRemoveMention={(raw) =>
            onChangeMentions(selectedMentions.filter((item) => item.raw !== raw))
          }
          attachments={attachments}
          onRemoveAttachment={(id) =>
            onChangeAttachments(attachments.filter((item) => item.id !== id))
          }
          onPreviewImage={onPreviewImage}
          queuedPrompt={queuedPrompt}
          onEditQueuedPrompt={onEditQueuedPrompt}
          onCancelQueuedPrompt={onCancelQueuedPrompt}
        />

        {/* 4. 主文本域（保留纯粹输入职责，支持 IME 保护与文件粘贴）。 */}
        <textarea
          ref={textareaRef}
          value={value}
          style={{ height: `${textareaHeight}px` }}
          onChange={(e) => {
            const nextVal = e.target.value;
            onChange(nextVal);
            refreshTriggerState(nextVal, e.target.selectionStart ?? nextVal.length);
          }}
          onClick={(e) => {
            refreshTriggerState(value, e.currentTarget.selectionStart ?? value.length);
          }}
          onKeyUp={(e) => {
            if (["ArrowDown", "ArrowUp", "Enter", "Tab", "Escape"].includes(e.key)) return;
            refreshTriggerState(value, e.currentTarget.selectionStart ?? value.length);
          }}
          onCompositionStart={() => setCompositionActive(true)}
          onCompositionEnd={(e) => {
            setCompositionActive(false);
            refreshTriggerState(
              e.currentTarget.value,
              e.currentTarget.selectionStart ?? e.currentTarget.value.length
            );
          }}
          onKeyDown={handleKeyDown}
          onPaste={(e) => {
            const files = Array.from(e.clipboardData?.files || []);
            if (files.length > 0) {
              e.preventDefault();
              void handleIncomingFiles(files);
            }
          }}
          placeholder="输入需求（Enter 发送，Shift+Enter 换行，@ 引用表/对象，/ 快捷命令）..."
          className="w-full resize-none bg-transparent text-[12px] leading-relaxed outline-none placeholder:text-neutral/45"
        />

        {/* 隐藏文件选择框（供底部 `+` 按钮触发）。 */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept="image/png,image/jpeg,image/gif,image/webp,.csv,.tsv,.txt,.text,.md,.markdown,.json,.yaml,.yml,.xml,.log,.sql,.soql"
          className="hidden"
          onChange={(e) => {
            const files = Array.from(e.target.files || []);
            e.target.value = "";
            void handleIncomingFiles(files);
          }}
        />

        {/* 5. 底部动作栏（附件、模式/技能合并选择器、模型选择器、发送/排队/停止）。 */}
        <AiPromptBottomBar
          mode={mode}
          onModeChange={onModeChange}
          action={action}
          onActionChange={onActionChange}
          configs={configs}
          selectedConfigId={selectedConfigId}
          onSelectConfigId={onSelectConfigId}
          onClickAttach={() => fileInputRef.current?.click()}
          streaming={streaming}
          canSubmit={canSubmit}
          onSend={onSend}
          onQueueSend={onQueueSend}
          onStop={onStop}
        />
      </div>
    </div>
  );
}
