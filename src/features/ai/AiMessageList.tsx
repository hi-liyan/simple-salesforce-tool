import { useState } from "react";
import { AlertTriangle, Check, ChevronDown, ChevronRight, Copy, Play, PlusSquare, Replace, ShieldAlert, Wrench } from "lucide-react";
import type { AiChatMessage, AiMessageImage } from "../../types/ai";
import { AiMarkdownContent } from "./AiMarkdownContent";

type AiMessageListProps = {
  // 对话消息列表。
  messages: AiChatMessage[];
  // 当前流式状态提示文案。
  statusText: string;
  // 是否正在生成。
  streaming: boolean;
  // 点击对话中的图片缩略图进行大图预览。
  onPreviewImage?: (image: AiMessageImage) => void;
  // 替换当前控制台 SQL。
  onReplaceSql: (sql: string) => void;
  // 新建控制台并填入 SQL。
  onOpenNewConsole: (sql: string) => void;
  // 直接在控制台执行 SQL（受 SqlGuard 保护）。
  onExecuteSql: (sql: string) => void;
  // 确认执行 Agent 挂起的写操作 SQL。
  onConfirmWriteSql: (messageId: string, sql: string, sourceId: string) => void;
  // 取消 Agent 挂起的写操作 SQL。
  onCancelWriteSql: (messageId: string) => void;
};

type ContentSegment =
  | { kind: "text"; content: string }
  | { kind: "code"; lang: string; content: string };

// 将回复正文拆分为普通文本与代码块，便于为 SQL/SOQL 代码块提供一键替换/执行按钮。
function splitMarkdownSegments(raw: string): ContentSegment[] {
  const segments: ContentSegment[] = [];
  const regex = /```([a-zA-Z0-9_-]*)\n([\s\S]*?)```/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null = null;

  while ((match = regex.exec(raw)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", content: raw.slice(lastIndex, match.index) });
    }
    segments.push({
      kind: "code",
      lang: (match[1] || "sql").toLowerCase(),
      content: match[2].trimEnd()
    });
    lastIndex = match.index + match[0].length;
  }

  if (lastIndex < raw.length) {
    segments.push({ kind: "text", content: raw.slice(lastIndex) });
  }
  return segments;
}

// 渲染 AI 对话消息列表、工具调用步骤、代码块操作条与写操作安全确认卡片。
export function AiMessageList({
  messages,
  statusText,
  streaming,
  onPreviewImage,
  onReplaceSql,
  onOpenNewConsole,
  onExecuteSql,
  onConfirmWriteSql,
  onCancelWriteSql
}: AiMessageListProps) {
  const [expandedToolIds, setExpandedToolIds] = useState<Record<string, boolean>>({});
  const [expandedReasoningIds, setExpandedReasoningIds] = useState<Record<string, boolean>>({});
  const [copiedCodeKey, setCopiedCodeKey] = useState("");

  function handleCopyCode(key: string, text: string) {
    void navigator.clipboard.writeText(text).then(() => {
      setCopiedCodeKey(key);
      window.setTimeout(() => setCopiedCodeKey(""), 1600);
    });
  }

  if (messages.length === 0) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center text-[12px] text-neutral/60">
        <p className="font-medium text-neutral/80">DataStudio AI 助手已就绪</p>
        <p className="mt-1.5 leading-relaxed">
          支持 Ask（只读问答）与 Agent（自主检索 Schema / 执行查询 / EXPLAIN 分析）双模式。
          在下方输入问题，或使用 <code className="rounded bg-base-200 px-1">@</code> 引用表与对象。
        </p>
      </div>
    );
  }

  return (
    <div className="flex-1 space-y-3 overflow-y-auto px-3 py-3 text-[12px]">
      {messages.map((msg) => {
        const isUser = msg.role === "user";
        const segments = splitMarkdownSegments(msg.content);
        const isReasoningExpanded = Boolean(expandedReasoningIds[msg.id]);

        return (
          <div key={msg.id} className={`flex flex-col ${isUser ? "items-end" : "items-start"}`}>
            <div
              className={`max-w-[94%] rounded-xl px-3 py-2 ${
                isUser
                  ? "bg-primary text-primary-content"
                  : "w-full border border-base-300/80 bg-base-200/35 text-base-content"
              }`}
            >
              {/* 用户消息携带的图片缩略图列表（点击可放大预览）。 */}
              {isUser && msg.images && msg.images.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1.5">
                  {msg.images.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      title={`点击预览 ${img.name}`}
                      onClick={() => onPreviewImage?.(img)}
                      className="group relative overflow-hidden rounded-lg border border-primary-content/25 bg-primary-content/10 transition-opacity hover:opacity-90"
                    >
                      <img
                        src={img.dataUrl}
                        alt={img.name}
                        className="h-16 w-16 object-cover"
                      />
                      <span className="absolute inset-x-0 bottom-0 truncate bg-black/55 px-1 py-0.5 text-[9px] text-white">
                        {img.name}
                      </span>
                    </button>
                  ))}
                </div>
              )}

              {/* 用户消息关联的结构化引用标签（@对象 / 选区 / 文本附件）。 */}
              {isUser && msg.mentions && msg.mentions.length > 0 && (
                <div className="mb-1.5 flex flex-wrap gap-1">
                  {msg.mentions.map((badge, badgeIdx) => (
                    <span
                      key={`${badge.kind}-${badge.label}-${badgeIdx}`}
                      className="inline-flex max-w-full items-center truncate rounded bg-primary-content/20 px-1.5 py-0.5 font-mono text-[10px] text-primary-content"
                    >
                      {badge.label}
                    </span>
                  ))}
                </div>
              )}

              {/* 思考过程折叠区（仅深度思考模型返回 reasoning 时显示）。 */}
              {!isUser && msg.reasoning && (
                <div className="mb-2 rounded-lg border border-base-300/70 bg-base-100/70 px-2.5 py-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-1 text-left text-[11px] font-medium text-neutral/70"
                    onClick={() =>
                      setExpandedReasoningIds((prev) => ({ ...prev, [msg.id]: !prev[msg.id] }))
                    }
                  >
                    {isReasoningExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span>思考过程</span>
                  </button>
                  {isReasoningExpanded && (
                    <pre className="mt-1.5 whitespace-pre-wrap break-words font-sans text-[11px] leading-relaxed text-neutral/70">
                      {msg.reasoning}
                    </pre>
                  )}
                </div>
              )}

              {/* Agent 工具调用步骤折叠卡片。 */}
              {!isUser && msg.toolSteps && msg.toolSteps.length > 0 && (
                <div className="mb-2 space-y-1">
                  {msg.toolSteps.map((step) => {
                    const isOpen = Boolean(expandedToolIds[step.id]);
                    return (
                      <div
                        key={step.id}
                        className="rounded-lg border border-base-300/80 bg-base-100/90 px-2.5 py-1.5 text-[11px]"
                      >
                        <button
                          type="button"
                          className="flex w-full items-center justify-between gap-2 text-left"
                          onClick={() =>
                            setExpandedToolIds((prev) => ({ ...prev, [step.id]: !prev[step.id] }))
                          }
                        >
                          <span className="flex min-w-0 items-center gap-1.5 font-medium text-neutral/85">
                            {isOpen ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                            <Wrench size={11} className="shrink-0 text-primary" />
                            <span className="truncate font-mono">{step.name}</span>
                          </span>
                          <span
                            className={`shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                              step.status === "running"
                                ? "bg-warning/15 text-warning-content"
                                : step.status === "error"
                                  ? "bg-error/15 text-error"
                                  : "bg-success/15 text-success"
                            }`}
                          >
                            {step.status === "running" ? "执行中" : step.status === "error" ? "失败" : "完成"}
                          </span>
                        </button>
                        {isOpen && (
                          <div className="mt-1.5 space-y-1 border-t border-base-300/60 pt-1.5 font-mono text-[10px] text-neutral/75">
                            {step.argsText && (
                              <div className="break-all">
                                <span className="font-semibold">参数：</span>
                                {step.argsText}
                              </div>
                            )}
                            {step.resultText && (
                              <pre className="max-h-36 overflow-auto whitespace-pre-wrap break-words rounded bg-base-200/60 p-1.5">
                                {step.resultText}
                              </pre>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}

              {/* 消息正文与 SQL/SOQL 代码块。 */}
              <div className="space-y-2 leading-relaxed">
                {segments.map((seg, index) => {
                  if (seg.kind === "text") {
                    if (isUser) {
                      return (
                        <div key={index} className="whitespace-pre-wrap break-words">
                          {seg.content}
                        </div>
                      );
                    }
                    return <AiMarkdownContent key={index} content={seg.content} />;
                  }
                  const codeKey = `${msg.id}-code-${index}`;
                  const isQueryCode = ["sql", "mysql", "soql", ""].includes(seg.lang);
                  return (
                    <div key={index} className="overflow-hidden rounded-lg border border-base-300 bg-base-100">
                      <div className="flex items-center justify-between border-b border-base-300/70 bg-base-200/55 px-2.5 py-1 text-[10px] text-neutral/70">
                        <span className="font-mono uppercase">{seg.lang || "sql"}</span>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            title="复制代码"
                            onClick={() => handleCopyCode(codeKey, seg.content)}
                            className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-base-300/70"
                          >
                            {copiedCodeKey === codeKey ? <Check size={11} className="text-success" /> : <Copy size={11} />}
                            <span>{copiedCodeKey === codeKey ? "已复制" : "复制"}</span>
                          </button>
                          {isQueryCode && (
                            <>
                              <button
                                type="button"
                                title="替换当前控制台内容"
                                onClick={() => onReplaceSql(seg.content)}
                                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-base-300/70"
                              >
                                <Replace size={11} />
                                <span>替换</span>
                              </button>
                              <button
                                type="button"
                                title="新建控制台打开"
                                onClick={() => onOpenNewConsole(seg.content)}
                                className="inline-flex items-center gap-0.5 rounded px-1.5 py-0.5 hover:bg-base-300/70"
                              >
                                <PlusSquare size={11} />
                                <span>新Tab</span>
                              </button>
                              <button
                                type="button"
                                title="在工作区直接执行（受 SqlGuard 保护）"
                                onClick={() => onExecuteSql(seg.content)}
                                className="inline-flex items-center gap-0.5 rounded bg-primary/10 px-1.5 py-0.5 font-medium text-primary hover:bg-primary/20"
                              >
                                <Play size={11} />
                                <span>执行</span>
                              </button>
                            </>
                          )}
                        </div>
                      </div>
                      <pre className="max-h-60 overflow-auto p-2.5 font-mono text-[11px] leading-relaxed text-base-content">
                        {seg.content}
                      </pre>
                    </div>
                  );
                })}
              </div>

              {/* 写操作二次确认卡片（由后端 SqlGuard 拦截后触发）。 */}
              {!isUser && msg.writeConfirmation && (
                <div className="mt-2.5 rounded-lg border border-warning/50 bg-warning/10 p-2.5 text-[11px]">
                  <div className="flex items-center gap-1.5 font-semibold text-warning-content">
                    <AlertTriangle size={13} className="text-warning" />
                    <span>写操作 / 高危 SQL 安全确认</span>
                  </div>
                  <p className="mt-1 text-neutral/80">{msg.writeConfirmation.reason}</p>
                  <pre className="mt-1.5 max-h-28 overflow-auto rounded bg-base-100 p-2 font-mono text-[10px]">
                    {msg.writeConfirmation.sql}
                  </pre>
                  {msg.writeConfirmation.status === "pending" ? (
                    <div className="mt-2 flex justify-end gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-xs"
                        onClick={() => onCancelWriteSql(msg.id)}
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        className="btn btn-warning btn-xs"
                        onClick={() =>
                          onConfirmWriteSql(
                            msg.id,
                            msg.writeConfirmation!.sql,
                            msg.writeConfirmation!.sourceId
                          )
                        }
                      >
                        确认执行
                      </button>
                    </div>
                  ) : (
                    <p className="mt-1.5 text-[10px] font-medium text-neutral/70">
                      {msg.writeConfirmation.status === "confirmed" ? "已确认执行" : "已取消"}
                    </p>
                  )}
                </div>
              )}

              {/* 生产/只读硬拦截卡片。 */}
              {!isUser && msg.blockedNotice && (
                <div className="mt-2.5 rounded-lg border border-error/50 bg-error/10 p-2.5 text-[11px] text-error">
                  <div className="flex items-center gap-1.5 font-semibold">
                    <ShieldAlert size={13} />
                    <span>安全策略拦截</span>
                  </div>
                  <p className="mt-1">{msg.blockedNotice.reason}</p>
                </div>
              )}
            </div>
          </div>
        );
      })}

      {streaming && statusText && (
        <div className="flex items-center gap-2 px-1 text-[11px] text-primary">
          <span className="loading loading-dots loading-xs" />
          <span>{statusText}</span>
        </div>
      )}
    </div>
  );
}
