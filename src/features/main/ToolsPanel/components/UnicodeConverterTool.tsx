import { useEffect, useMemo, useRef, useState } from "react";
import { ChevronLeft, Clipboard, Eraser, History, Languages, Trash2 } from "lucide-react";
import { NoticeAlert, type NoticeTone } from "../../../../components/NoticeAlert";
import {
  convertAsciiToUnicode,
  convertChineseToUnicode,
  convertUnicodeToAscii,
  convertUnicodeToChinese,
  type UnicodeConverterHistoryEntry,
  type UnicodeConverterMode,
  type UnicodeConverterOutputFormat
} from "../logic/unicodeConverter.ts";
import { useUnicodeConverterToolStore } from "../../../../store/useUnicodeConverterToolStore.ts";

type UnicodeConverterToolProps = {
  // 返回工具入口页：用于离开 Unicode 工具详情页。
  onBack: () => void;
};

// 输出格式选项：供“转 Unicode”场景切换目标编码表示。
const OUTPUT_FORMAT_OPTIONS: Array<{ value: UnicodeConverterOutputFormat; label: string; description: string }> = [
  {
    value: "js-unicode",
    label: "\\uXXXX",
    description: "适合 JS/JSON 字符串转义。"
  },
  {
    value: "html-entity",
    label: "&#DDDD;",
    description: "适合 HTML 实体场景。"
  }
];

// 转换按钮定义：统一描述按钮标题、模式和执行逻辑。
const ACTION_DEFINITIONS: Array<{
  mode: UnicodeConverterMode;
  label: string;
  run: (inputText: string, outputFormat: UnicodeConverterOutputFormat) => string;
}> = [
  {
    mode: "unicode-to-chinese",
    label: "UNICODE 转中文",
    run: (inputText) => convertUnicodeToChinese(inputText)
  },
  {
    mode: "chinese-to-unicode",
    label: "中文转 UNICODE",
    run: (inputText, outputFormat) => convertChineseToUnicode(inputText, outputFormat)
  },
  {
    mode: "ascii-to-unicode",
    label: "ASCII 转 UNICODE",
    run: (inputText, outputFormat) => convertAsciiToUnicode(inputText, outputFormat)
  },
  {
    mode: "unicode-to-ascii",
    label: "UNICODE 转 ASCII",
    run: (inputText) => convertUnicodeToAscii(inputText)
  }
];

// 模式标签：供历史记录和结果说明复用。
const MODE_LABEL_MAP: Record<UnicodeConverterMode, string> = {
  "unicode-to-chinese": "Unicode 转中文",
  "chinese-to-unicode": "中文转 Unicode",
  "ascii-to-unicode": "ASCII 转 Unicode",
  "unicode-to-ascii": "Unicode 转 ASCII"
};

// 复制文本到剪贴板：优先现代 API，失败时回退到隐藏 textarea。
async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text); // 优先使用现代剪贴板 API。
    return;
  } catch {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.style.position = "fixed";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.focus();
    textarea.select();
    document.execCommand("copy"); // 兼容旧环境或权限受限场景。
    document.body.removeChild(textarea);
  }
}

// Unicode 编码转换工具页：提供双栏转换、格式切换和持久化历史能力。
export function UnicodeConverterTool({ onBack }: UnicodeConverterToolProps) {
  // Store 状态：维护当前输入输出、输出格式与历史记录。
  const inputText = useUnicodeConverterToolStore((state) => state.inputText);
  const outputText = useUnicodeConverterToolStore((state) => state.outputText);
  const outputFormat = useUnicodeConverterToolStore((state) => state.outputFormat);
  const history = useUnicodeConverterToolStore((state) => state.history);
  const setInputText = useUnicodeConverterToolStore((state) => state.setInputText);
  const setOutputText = useUnicodeConverterToolStore((state) => state.setOutputText);
  const setOutputFormat = useUnicodeConverterToolStore((state) => state.setOutputFormat);
  const applyHistoryEntry = useUnicodeConverterToolStore((state) => state.applyHistoryEntry);
  const pushHistoryEntry = useUnicodeConverterToolStore((state) => state.pushHistoryEntry);
  const deleteHistoryEntry = useUnicodeConverterToolStore((state) => state.deleteHistoryEntry);
  const clearHistory = useUnicodeConverterToolStore((state) => state.clearHistory);
  const resetDraft = useUnicodeConverterToolStore((state) => state.resetDraft);
  const clearOutput = useUnicodeConverterToolStore((state) => state.clearOutput);

  // 工具级提示：承载转换成功、失败和复制反馈。
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  // 懒恢复完成标记：进入工具页后才触发持久化恢复。
  const [hydrated, setHydrated] = useState(useUnicodeConverterToolStore.persist.hasHydrated());
  // 最近一次执行的模式：用于结果区说明和历史高亮。
  const [lastMode, setLastMode] = useState<UnicodeConverterMode>("unicode-to-chinese");
  // 当前高亮历史主键：便于用户识别当前回放项。
  const [activeHistoryId, setActiveHistoryId] = useState("");
  // 自动恢复只执行一次：避免 StrictMode 下重复触发。
  const hydrationStartedRef = useRef(false);

  // 当前输入是否为空：统一驱动按钮禁用和空态文案。
  const emptyInput = useMemo(() => inputText.trim().length === 0, [inputText]);

  // 工具级通知自动关闭：避免长时间遮挡文本区域。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null); // 定时关闭提示，保持轻量反馈体验。
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  // 进入工具页后按需恢复持久化状态。
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    void Promise.resolve(useUnicodeConverterToolStore.persist.rehydrate()).then(() => {
      setHydrated(true);
    });
  }, []);

  // 执行一次转换：成功时写回输出并沉淀历史，失败时给出明确提示。
  function runConversion(mode: UnicodeConverterMode) {
    const trimmedInputText = inputText.trim();
    if (!trimmedInputText) {
      setNotice({
        tone: "warning",
        message: "请先输入待转换内容。"
      });
      return;
    }

    const action = ACTION_DEFINITIONS.find((item) => item.mode === mode);
    if (!action) return;

    try {
      const nextOutputText = action.run(trimmedInputText, outputFormat);
      setOutputText(nextOutputText);
      setLastMode(mode);
      const nextHistoryEntry = pushHistoryEntry(mode, trimmedInputText, nextOutputText);
      if (nextHistoryEntry) {
        setActiveHistoryId(nextHistoryEntry.id);
      }
      setNotice({
        tone: "success",
        message: `${MODE_LABEL_MAP[mode]}已完成。`
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: error instanceof Error ? error.message : String(error)
      });
    }
  }

  // 恢复一条历史记录：仅回填当时输入输出与格式，不自动重新执行。
  function handleApplyHistory(entry: UnicodeConverterHistoryEntry) {
    applyHistoryEntry(entry.id);
    setLastMode(entry.mode);
    setActiveHistoryId(entry.id);
    setNotice(null);
  }

  // 删除单条历史：若删除的是当前高亮项，则同步清空高亮。
  function handleDeleteHistory(entryId: string) {
    deleteHistoryEntry(entryId);
    if (activeHistoryId === entryId) {
      setActiveHistoryId("");
    }
    setNotice(null);
  }

  // 清空全部历史：不修改当前编辑区，避免误伤正在查看的结果。
  function handleClearHistory() {
    clearHistory();
    setActiveHistoryId("");
    setNotice(null);
  }

  // 清空当前草稿：同时清空输入、输出和格式选择回到默认值。
  function handleResetDraft() {
    resetDraft();
    setLastMode("unicode-to-chinese");
    setActiveHistoryId("");
    setNotice(null);
  }

  // 清空当前结果：保留输入，方便用户继续切换不同转换方式试验。
  function handleClearOutput() {
    clearOutput();
    setNotice(null);
  }

  // 复制当前结果：便于带去其他系统或开发工具继续使用。
  async function handleCopyOutput() {
    if (!outputText) {
      setNotice({
        tone: "warning",
        message: "当前没有可复制的结果内容。"
      });
      return;
    }

    try {
      await copyText(outputText);
      setNotice({
        tone: "success",
        message: "转换结果已复制。"
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: `复制失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  if (!hydrated) {
    return (
      // 懒恢复加载态：仅在进入 Unicode 工具页后展示。
      <div className="flex h-full w-full items-center justify-center bg-base-200/40">
        <div className="rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
            <div>
              {/* 加载标题。 */}
              <p className="text-[13px] font-medium text-neutral">正在恢复 Unicode 工具状态</p>
              <p className="mt-1 text-[12px] text-neutral/65">这里只会在进入工具后按需恢复，不影响应用启动速度。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // Unicode 工具页：顶部返回区 + 中部转换工作台 + 右侧历史记录。
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-base-200/45">
      {/* 工具级全局提示：固定在右上角，展示轻量反馈。 */}
      {notice ? (
        <NoticeAlert
          tone={notice.tone}
          message={notice.message}
          onClose={() => setNotice(null)}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      ) : null}
      {/* 顶部返回区：保留回到工具入口页的路径。 */}
      <div className="flex items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-5 py-3">
        <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2 text-[12px]" onClick={onBack}>
          {/* 返回图标：与文字一起强化回退语义。 */}
          <ChevronLeft size={14} />
          返回工具面板
        </button>
        {/* 工具说明：强调双格式兼容与历史持久化能力。 */}
        <p className="text-[12px] text-neutral/60">支持 `\uXXXX` 与 HTML 实体双格式解析、历史记录持久化，以及单条/全部删除。</p>
      </div>
      {/* 工具操作条：集中放置四种转换按钮和清空结果动作。 */}
      <div className="border-b border-base-300 bg-base-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          {ACTION_DEFINITIONS.map((action) => (
            <button
              key={action.mode}
              // 转换按钮：点击后执行对应模式的转换逻辑。
              type="button"
              className="btn btn-outline btn-sm h-9 min-h-9 rounded-xl px-3 text-[12px]"
              onClick={() => {
                runConversion(action.mode); // 行内注释：根据按钮绑定的模式执行对应转换并沉淀历史。
              }}
              disabled={emptyInput}
            >
              {action.label}
            </button>
          ))}
          <button
            type="button"
            // 清空结果按钮：只清掉右侧结果，不动输入内容。
            className="btn btn-outline btn-sm h-9 min-h-9 rounded-xl border-error/40 px-3 text-[12px] text-error"
            onClick={handleClearOutput}
            disabled={!outputText}
          >
            清空结果
          </button>
        </div>
      </div>
      {/* 工作区主体：左中为输入输出与格式配置，右侧为历史记录。 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        {/* 主工作台：顶部格式区，下方左右双栏文本编辑区。 */}
        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="border-b border-base-300 px-4 py-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {/* 卡片标题。 */}
                <h3 className="text-[14px] font-semibold text-neutral">在线 Unicode 编码转换</h3>
                <p className="mt-1 text-[12px] text-neutral/60">“转 Unicode”支持输出为 `\uXXXX` 或 `&#DDDD;`，而“转中文/转 ASCII”会自动识别两种输入格式。</p>
              </div>
              {/* 草稿操作：清空全部与复制结果。 */}
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={handleResetDraft}>
                  <Eraser size={14} />
                  清空全部
                </button>
                <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={() => void handleCopyOutput()}>
                  <Clipboard size={14} />
                  复制结果
                </button>
              </div>
            </div>
            {/* 输出格式配置：仅影响“中文转 Unicode / ASCII 转 Unicode”两类动作。 */}
            <div className="mt-4 flex flex-wrap items-center gap-3">
              {OUTPUT_FORMAT_OPTIONS.map((item) => {
                const active = outputFormat === item.value;
                return (
                  <button
                    key={item.value}
                    // 输出格式切换按钮：切换后直接写回持久化状态。
                    type="button"
                    className={`flex min-w-[180px] flex-col items-start rounded-2xl border px-3 py-2 text-left transition ${
                      active
                        ? "border-primary/40 bg-primary/10 text-primary"
                        : "border-base-300 bg-base-100 text-neutral hover:border-primary/30 hover:bg-base-200/40"
                    }`}
                    onClick={() => {
                      setOutputFormat(item.value); // 行内注释：切换输出格式后，后续转 Unicode 操作直接按当前格式编码。
                    }}
                  >
                    {/* 格式标题。 */}
                    <span className="text-[12px] font-medium">{item.label}</span>
                    <span className="mt-1 text-[11px] text-neutral/60">{item.description}</span>
                  </button>
                );
              })}
            </div>
          </div>
          {/* 左右双栏编辑区：左侧输入，右侧输出。 */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 p-4 xl:grid-cols-2">
            <section className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100">
              <div className="border-b border-base-300 px-4 py-3">
                {/* 输入标题。 */}
                <h4 className="text-[13px] font-semibold text-neutral">输入内容</h4>
                <p className="mt-1 text-[12px] text-neutral/60">可输入中文、ASCII、`\uXXXX`、`&#DDDD;` 或两种混合文本。</p>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <textarea
                  // 输入文本域：承载用户待转换的原始内容。
                  value={inputText}
                  placeholder="请输入待转换内容。"
                  className="textarea textarea-bordered h-full min-h-[280px] w-full resize-none rounded-2xl bg-base-100 font-mono text-[13px] leading-6"
                  onChange={(event) => {
                    setInputText(event.target.value); // 行内注释：输入变更即时同步到持久化 store，保证切出工具页后仍可恢复。
                  }}
                />
              </div>
            </section>
            <section className="flex min-h-[260px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100">
              <div className="border-b border-base-300 px-4 py-3">
                {/* 输出标题。 */}
                <h4 className="text-[13px] font-semibold text-neutral">转换结果</h4>
                <p className="mt-1 text-[12px] text-neutral/60">
                  {outputText ? `最近一次操作：${MODE_LABEL_MAP[lastMode]}` : "执行任意转换后，这里会展示对应结果。"}
                </p>
              </div>
              <div className="min-h-0 flex-1 p-4">
                <textarea
                  // 输出文本域：允许复制与手动微调，因此保留可编辑状态。
                  value={outputText}
                  placeholder="转换结果会显示在这里。"
                  className="textarea textarea-bordered h-full min-h-[280px] w-full resize-none rounded-2xl bg-base-100 font-mono text-[13px] leading-6"
                  onChange={(event) => {
                    setOutputText(event.target.value); // 行内注释：允许用户在结果区手动微调，并把当前内容继续持久化保存。
                  }}
                />
              </div>
            </section>
          </div>
        </section>
        {/* 历史记录卡片：承载回放、单条删除和全部清空。 */}
        <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div className="flex min-w-0 flex-1 items-center gap-2">
              {/* 历史图标：强化该区域语义。 */}
              <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <History size={16} />
              </div>
              <div className="min-w-0">
                {/* 历史标题。 */}
                <h3 className="text-[14px] font-semibold text-neutral">历史记录</h3>
                <p className="mt-1 text-[12px] text-neutral/60">最近转换结果会固定保存在这里，下次进入工具仍可继续使用。</p>
              </div>
            </div>
            <button
              type="button"
              // 清空全部按钮：仅在存在历史时可用。
              className="btn btn-ghost btn-sm h-8 min-h-8 shrink-0 gap-2 px-2.5 text-[12px] text-error"
              onClick={handleClearHistory}
              disabled={history.length === 0}
            >
              <Trash2 size={14} />
              全部删除
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {history.length === 0 ? (
              // 历史空态：提示用户首次转换后会在这里沉淀记录。
              <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-center">
                <div className="max-w-[220px]">
                  <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Languages size={20} />
                  </div>
                  <p className="mt-4 text-[13px] font-medium text-neutral">还没有历史记录</p>
                  <p className="mt-2 text-[12px] leading-6 text-neutral/60">执行任意一次转换后，这里会保存最近记录，并在下次进入工具时继续展示。</p>
                </div>
              </div>
            ) : (
              // 历史列表：按时间倒序展示，支持点击恢复与单条删除。
              <div className="space-y-3">
                {history.map((entry) => {
                  const active = entry.id === activeHistoryId;
                  return (
                    <div
                      key={entry.id}
                      className={`flex flex-col rounded-2xl border px-4 py-3 transition ${
                        active
                          ? "border-primary/40 bg-primary/10 shadow-sm"
                          : "border-base-300 bg-base-100 hover:border-primary/30 hover:bg-base-200/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0 flex-1">
                          {/* 模式标题。 */}
                          <p className="text-[13px] font-medium text-neutral">{MODE_LABEL_MAP[entry.mode]}</p>
                          <p className="mt-1 text-[11px] text-neutral/55">{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            // 应用按钮：恢复这条历史对应的输入、输出和格式。
                            className="btn btn-ghost btn-xs h-7 min-h-7 whitespace-nowrap px-2 text-[11px]"
                            onClick={() => {
                              handleApplyHistory(entry); // 行内注释：点击历史项后直接回填当时快照，方便继续改写或复制。
                            }}
                          >
                            使用
                          </button>
                          <button
                            type="button"
                            // 单条删除按钮：仅移除目标记录，不影响其他历史项。
                            className="btn btn-ghost btn-xs h-7 min-h-7 whitespace-nowrap px-2 text-error"
                            onClick={() => {
                              handleDeleteHistory(entry.id);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 space-y-2 text-[11px] text-neutral/65">
                        {/* 输入摘要。 */}
                        <div className="rounded-xl bg-base-200/70 px-2 py-2">
                          <p className="mb-1 text-[11px] font-medium text-neutral/75">输入</p>
                          <p className="line-clamp-2 break-all">{entry.inputText}</p>
                        </div>
                        {/* 输出摘要。 */}
                        <div className="rounded-xl bg-base-200/70 px-2 py-2">
                          <p className="mb-1 text-[11px] font-medium text-neutral/75">输出</p>
                          <p className="line-clamp-2 break-all">{entry.outputText}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          {/* 输出格式标签：帮助快速识别这条历史的编码样式。 */}
                          <span className="rounded-xl bg-base-200/70 px-2 py-1">
                            格式 {entry.outputFormat === "html-entity" ? "HTML 实体" : "\\uXXXX"}
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
