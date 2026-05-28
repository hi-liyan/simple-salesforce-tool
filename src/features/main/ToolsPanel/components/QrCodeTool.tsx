import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ChevronLeft,
  Clipboard,
  Download,
  History,
  QrCode,
  RotateCcw,
  Sparkles,
  Trash2
} from "lucide-react";
import { NoticeAlert, type NoticeTone } from "../../../../components/NoticeAlert";
import {
  DEFAULT_QR_CODE_OPTIONS,
  type QrCodeErrorCorrectionLevel,
  type QrCodeHistoryEntry
} from "../logic/qrCode";
import { useQrCodeToolStore } from "../../../../store/useQrCodeToolStore";

type QrCodeToolProps = {
  // 返回工具入口页：用于离开二维码工具详情页。
  onBack: () => void;
};

// 默认示例文本：用于帮助用户快速验证二维码生成能力。
const DEFAULT_SAMPLE_TEXT = "https://example.com/simple-salesforce-tool";

// 纠错级别选项：用于渲染下拉框并解释容错强度。
const ERROR_CORRECTION_LEVEL_OPTIONS: Array<{ value: QrCodeErrorCorrectionLevel; label: string }> = [
  { value: "L", label: "L 7%" },
  { value: "M", label: "M 15%" },
  { value: "Q", label: "Q 25%" },
  { value: "H", label: "H 30%" }
];

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
    document.execCommand("copy"); // 兼容剪贴板权限受限场景。
    document.body.removeChild(textarea);
  }
}

// 复制图片到剪贴板：优先使用 ClipboardItem，失败时交由调用方提示。
async function copyImage(dataUrl: string): Promise<void> {
  const response = await fetch(dataUrl);
  const blob = await response.blob();
  await navigator.clipboard.write([
    new ClipboardItem({
      [blob.type]: blob
    })
  ]);
}

// 下载二维码图片：复用浏览器下载能力把 data URL 落到本地文件。
function downloadImage(dataUrl: string) {
  const anchor = document.createElement("a");
  anchor.href = dataUrl;
  anchor.download = `qr-code-${Date.now()}.png`;
  document.body.appendChild(anchor);
  anchor.click(); // 直接触发浏览器下载，不引入额外后端命令。
  document.body.removeChild(anchor);
}

// 二维码工具页：提供文本生成、预览和历史恢复能力。
export function QrCodeTool({ onBack }: QrCodeToolProps) {
  // Store 状态：维护当前输入、参数与历史记录。
  const inputText = useQrCodeToolStore((state) => state.inputText);
  const options = useQrCodeToolStore((state) => state.options);
  const history = useQrCodeToolStore((state) => state.history);
  const setInputText = useQrCodeToolStore((state) => state.setInputText);
  const patchOptions = useQrCodeToolStore((state) => state.patchOptions);
  const applyHistoryEntry = useQrCodeToolStore((state) => state.applyHistoryEntry);
  const pushHistoryEntry = useQrCodeToolStore((state) => state.pushHistoryEntry);
  const deleteHistoryEntry = useQrCodeToolStore((state) => state.deleteHistoryEntry);
  const clearHistory = useQrCodeToolStore((state) => state.clearHistory);
  const resetDraft = useQrCodeToolStore((state) => state.resetDraft);

  // 工具级提示：承载复制、生成失败等反馈。
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  // 懒恢复完成标记：进入工具页后才触发持久化恢复。
  const [hydrated, setHydrated] = useState(useQrCodeToolStore.persist.hasHydrated());
  // 当前二维码预览图：由最近一次成功生成的参数导出。
  const [previewDataUrl, setPreviewDataUrl] = useState("");
  // 最近一次成功生成的历史主键：用于在历史区高亮当前结果。
  const [activeHistoryId, setActiveHistoryId] = useState("");
  // 当前是否正在生成二维码：用于禁用按钮并反馈等待状态。
  const [generating, setGenerating] = useState(false);
  // 自动恢复只执行一次：避免 StrictMode 下重复触发恢复流程。
  const hydrationStartedRef = useRef(false);

  // 当前输入是否为空：统一驱动按钮禁用和空态文案。
  const emptyInput = useMemo(() => inputText.trim().length === 0, [inputText]);

  // 工具级通知自动关闭：保持与其它面板一致的轻提示体验。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null); // 定时关闭提示，避免长时间遮挡预览与历史列表。
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  // 进入工具页后手动恢复持久化状态；恢复完成后若已有输入则自动生成一次预览。
  useEffect(() => {
    if (hydrationStartedRef.current) return;
    hydrationStartedRef.current = true;

    void Promise.resolve(useQrCodeToolStore.persist.rehydrate()).then(async () => {
      setHydrated(true);
      const restoredState = useQrCodeToolStore.getState();
      if (!restoredState.inputText.trim()) return;
      await generateQrCode(restoredState.inputText, restoredState.options, false);
    });
  }, []);

  // 统一生成二维码：支持手动生成、历史恢复和启动后自动恢复三种入口。
  async function generateQrCode(nextInputText = inputText, nextOptions = options, persistHistory = true) {
    const trimmedInputText = nextInputText.trim();
    if (!trimmedInputText) {
      setNotice({
        tone: "warning",
        message: "请先输入 URL 或任意文本。"
      });
      setPreviewDataUrl("");
      return;
    }

    setGenerating(true);
    try {
      const dataUrl = await QRCode.toDataURL(trimmedInputText, {
        errorCorrectionLevel: nextOptions.errorCorrectionLevel,
        margin: nextOptions.margin,
        scale: nextOptions.scale,
        color: {
          dark: nextOptions.darkColor,
          light: nextOptions.lightColor
        }
      });

      setPreviewDataUrl(dataUrl);
      if (persistHistory) {
        const nextHistoryEntry = pushHistoryEntry(trimmedInputText);
        if (nextHistoryEntry) {
          setActiveHistoryId(nextHistoryEntry.id);
        }
      } else {
        const matchedHistory = history.find((item) => item.inputText === trimmedInputText);
        setActiveHistoryId(matchedHistory?.id || "");
      }
      setNotice({
        tone: "success",
        message: "二维码已生成。"
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: `生成失败：${error instanceof Error ? error.message : String(error)}`
      });
      setPreviewDataUrl("");
    } finally {
      setGenerating(false);
    }
  }

  // 应用示例：一键填充文本并恢复推荐参数。
  function applySample() {
    setInputText(DEFAULT_SAMPLE_TEXT);
    patchOptions(DEFAULT_QR_CODE_OPTIONS);
    setNotice(null);
  }

  // 清空当前输入与预览，不影响已保存历史。
  function clearDraftAndPreview() {
    resetDraft();
    setPreviewDataUrl("");
    setActiveHistoryId("");
    setNotice(null);
  }

  // 点击历史记录：恢复当时输入和配置并立刻重生成预览。
  async function handleApplyHistory(entry: QrCodeHistoryEntry) {
    applyHistoryEntry(entry.id);
    setActiveHistoryId(entry.id);
    setNotice(null);
    await generateQrCode(entry.inputText, entry.options, false);
  }

  // 删除单条历史：若删除的是当前高亮项，则同步清空高亮。
  function handleDeleteHistory(entryId: string) {
    deleteHistoryEntry(entryId);
    if (activeHistoryId === entryId) {
      setActiveHistoryId("");
    }
    setNotice(null);
  }

  // 清空全部历史：仅移除历史列表，不强制修改当前编辑区。
  function handleClearHistory() {
    clearHistory();
    setActiveHistoryId("");
    setNotice(null);
  }

  // 复制当前输入文本：便于把二维码原始内容带回其它工具或系统。
  async function handleCopyInput() {
    if (emptyInput) {
      setNotice({
        tone: "warning",
        message: "当前没有可复制的输入内容。"
      });
      return;
    }

    try {
      await copyText(inputText);
      setNotice({
        tone: "success",
        message: "输入内容已复制。"
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: `复制失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 复制二维码图片：要求当前环境支持 ClipboardItem。
  async function handleCopyImage() {
    if (!previewDataUrl) {
      setNotice({
        tone: "warning",
        message: "请先生成二维码，再复制图片。"
      });
      return;
    }

    try {
      await copyImage(previewDataUrl);
      setNotice({
        tone: "success",
        message: "二维码图片已复制。"
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: `复制图片失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 下载二维码图片：将当前预览导出为 PNG。
  function handleDownloadImage() {
    if (!previewDataUrl) {
      setNotice({
        tone: "warning",
        message: "请先生成二维码，再下载图片。"
      });
      return;
    }

    downloadImage(previewDataUrl);
    setNotice({
      tone: "success",
      message: "二维码图片已开始下载。"
    });
  }

  if (!hydrated) {
    return (
      // 懒恢复加载态：仅在进入二维码工具页后展示。
      <div className="flex h-full w-full items-center justify-center bg-base-200/40">
        <div className="rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
            <div>
              {/* 加载标题。 */}
              <p className="text-[13px] font-medium text-neutral">正在恢复二维码工具状态</p>
              <p className="mt-1 text-[12px] text-neutral/65">这里只会在进入二维码工具后按需恢复，不影响应用启动速度。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // 二维码工具页：顶部返回区 + 三栏工作台。
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
        {/* 工具说明：强调历史记录与下次进入后的恢复能力。 */}
        <p className="text-[12px] text-neutral/60">支持二维码生成、历史记录持久化与下次进入后的自动恢复。</p>
      </div>
      {/* 工作区主体：左侧输入，中间参数与预览，右侧历史记录。 */}
      <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 overflow-auto p-4 xl:grid-cols-[minmax(360px,1fr)_minmax(380px,0.9fr)_320px]">
        {/* 左侧输入卡片：承载原始文本编辑与快捷动作。 */}
        <section className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div>
              {/* 卡片标题。 */}
              <h3 className="text-[14px] font-semibold text-neutral">URL 或其他文本</h3>
              <p className="mt-1 text-[12px] text-neutral/60">支持粘贴链接、命令、凭据占位文本或任意短文，生成后会写入右侧历史记录。</p>
            </div>
            {/* 输入区快捷操作。 */}
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={applySample}>
                <Sparkles size={14} />
                示例
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={clearDraftAndPreview}>
                <RotateCcw size={14} />
                清空
              </button>
              <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={() => void handleCopyInput()}>
                <Clipboard size={14} />
                复制文本
              </button>
            </div>
          </div>
          {/* 输入文本区域：保留自由换行能力。 */}
          <div className="min-h-0 flex-1 p-4">
            <textarea
              // 文本域：承载用户原始输入。
              value={inputText}
              placeholder="请输入 URL 或其他文本，然后点击“生成二维码”。"
              className="textarea textarea-bordered h-full min-h-[280px] w-full resize-none rounded-2xl bg-base-100 text-[13px] leading-6"
              onChange={(event) => {
                setInputText(event.target.value); // 输入变更即时同步到持久化 store。
              }}
            />
          </div>
        </section>
        {/* 中间工作卡片：顶部参数配置，下方二维码预览。 */}
        <section className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="border-b border-base-300 px-4 py-3">
            <div className="flex items-start justify-between gap-3">
              <div>
                {/* 卡片标题。 */}
                <h3 className="text-[14px] font-semibold text-neutral">生成参数</h3>
                <p className="mt-1 text-[12px] text-neutral/60">参数会和历史记录一起保存，下次进入工具时沿用最近一次设置。</p>
              </div>
              {/* 主操作按钮：按当前输入和参数生成二维码。 */}
              <button
                type="button"
                className="btn btn-primary btn-sm h-9 min-h-9 gap-2 px-4 text-[12px]"
                onClick={() => void generateQrCode()}
                disabled={generating}
              >
                <QrCode size={14} />
                {generating ? "生成中..." : "生成二维码"}
              </button>
            </div>
            {/* 参数表单：延续现有工具面板的紧凑控件风格。 */}
            <div className="mt-4 grid grid-cols-2 gap-3">
              <label className="form-control">
                {/* 参数标题：说明纠错级别。 */}
                <span className="mb-1 text-[12px] text-neutral/60">纠错级别</span>
                <select
                  // 纠错级别选择框。
                  value={options.errorCorrectionLevel}
                  className="select select-bordered select-sm h-10 min-h-10 rounded-xl text-[12px]"
                  onChange={(event) => {
                    patchOptions({
                      errorCorrectionLevel: event.target.value as QrCodeErrorCorrectionLevel
                    }); // 切换容错级别后立即写回持久化状态。
                  }}
                >
                  {ERROR_CORRECTION_LEVEL_OPTIONS.map((item) => (
                    <option key={item.value} value={item.value}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="form-control">
                {/* 参数标题：说明边距。 */}
                <span className="mb-1 text-[12px] text-neutral/60">边缘留白</span>
                <input
                  // 边距输入框：限制 0 到 8。
                  type="number"
                  min={0}
                  max={8}
                  step={1}
                  value={options.margin}
                  className="input input-bordered input-sm h-10 rounded-xl text-[12px]"
                  onChange={(event) => {
                    patchOptions({
                      margin: Number(event.target.value)
                    }); // 输入框原始值由 store 内部统一裁剪范围。
                  }}
                />
              </label>
              <label className="form-control">
                {/* 参数标题：说明缩放倍率。 */}
                <span className="mb-1 text-[12px] text-neutral/60">原胞大小</span>
                <input
                  // 缩放输入框：控制最终像素清晰度。
                  type="number"
                  min={4}
                  max={12}
                  step={1}
                  value={options.scale}
                  className="input input-bordered input-sm h-10 rounded-xl text-[12px]"
                  onChange={(event) => {
                    patchOptions({
                      scale: Number(event.target.value)
                    }); // 缩放值持久化后，后续历史恢复会直接带回当前配置。
                  }}
                />
              </label>
              <div className="grid grid-cols-2 gap-3">
                <label className="form-control">
                  {/* 参数标题：说明深色模块颜色。 */}
                  <span className="mb-1 text-[12px] text-neutral/60">深色</span>
                  <input
                    // 深色取色器：控制二维码模块颜色。
                    type="color"
                    value={options.darkColor}
                    className="input input-bordered input-sm h-10 rounded-xl p-1"
                    onChange={(event) => {
                      patchOptions({
                        darkColor: event.target.value
                      }); // 颜色控件直接输出十六进制颜色值。
                    }}
                  />
                </label>
                <label className="form-control">
                  {/* 参数标题：说明浅色背景颜色。 */}
                  <span className="mb-1 text-[12px] text-neutral/60">浅色</span>
                  <input
                    // 浅色取色器：控制二维码背景颜色。
                    type="color"
                    value={options.lightColor}
                    className="input input-bordered input-sm h-10 rounded-xl p-1"
                    onChange={(event) => {
                      patchOptions({
                        lightColor: event.target.value
                      }); // 颜色变更即时进入持久化快照。
                    }}
                  />
                </label>
              </div>
            </div>
          </div>
          {/* 预览区：使用浅色渐变背景，保持与现有工具风格一致。 */}
          <div className="min-h-0 flex-1 bg-[linear-gradient(180deg,#fbfdff_0%,#f3f8ff_100%)] p-4">
            <div className="flex h-full min-h-[320px] flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100/80 shadow-inner">
              <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
                <div>
                  {/* 预览标题。 */}
                  <h3 className="text-[14px] font-semibold text-neutral">二维码预览</h3>
                  <p className="mt-1 text-[12px] text-neutral/60">生成后可直接复制图片或下载 PNG。</p>
                </div>
                {/* 预览区快捷操作。 */}
                <div className="flex flex-wrap items-center justify-end gap-2">
                  <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={() => void handleCopyImage()}>
                    <Clipboard size={14} />
                    复制图片
                  </button>
                  <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]" onClick={handleDownloadImage}>
                    <Download size={14} />
                    下载 PNG
                  </button>
                </div>
              </div>
              <div className="flex min-h-0 flex-1 items-center justify-center p-6">
                {previewDataUrl ? (
                  // 成功态：展示居中的二维码图片。
                  <div className="rounded-[28px] border border-base-300 bg-white p-5 shadow-sm">
                    <img
                      // 预览图：展示当前生成结果。
                      src={previewDataUrl}
                      alt="生成的二维码预览"
                      className="h-[240px] w-[240px] max-w-full object-contain"
                    />
                  </div>
                ) : (
                  // 空态：提示用户从左侧输入内容后生成二维码。
                  <div className="max-w-xs text-center">
                    <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <QrCode size={20} />
                    </div>
                    <p className="mt-4 text-[14px] font-medium text-neutral">等待生成二维码</p>
                    <p className="mt-2 text-[12px] leading-6 text-neutral/60">输入文本并点击“生成二维码”后，这里会展示可复制、可下载的预览图片。</p>
                  </div>
                )}
              </div>
            </div>
          </div>
        </section>
        {/* 右侧历史记录卡片：承载恢复、单条删除和全部清空。 */}
        <section className="flex min-h-[360px] min-w-0 flex-col overflow-hidden rounded-2xl border border-base-300 bg-base-100 shadow-sm">
          <div className="flex items-center justify-between gap-3 border-b border-base-300 px-4 py-3">
            <div className="flex items-center gap-2">
              {/* 历史图标：强化该区域语义。 */}
              <div className="flex h-9 w-9 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <History size={16} />
              </div>
              <div>
                {/* 历史标题。 */}
                <h3 className="text-[14px] font-semibold text-neutral">历史记录</h3>
                <p className="mt-1 text-[12px] text-neutral/60">最近生成的结果会固定保存在这里，下次进入工具仍可继续使用。</p>
              </div>
            </div>
            {/* 全部清空按钮：仅在存在历史时展示可用态。 */}
            <button
              type="button"
              className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px] text-error"
              onClick={handleClearHistory}
              disabled={history.length === 0}
            >
              <Trash2 size={14} />
              全部删除
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-auto p-3">
            {history.length === 0 ? (
              // 历史空态：提示用户首次生成后会在这里沉淀记录。
              <div className="flex h-full min-h-[240px] items-center justify-center px-4 text-center">
                <div className="max-w-[220px]">
                  <p className="text-[13px] font-medium text-neutral">还没有历史记录</p>
                  <p className="mt-2 text-[12px] leading-6 text-neutral/60">首次生成二维码后，这里会保存最近记录，并在下次进入工具时继续展示。</p>
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
                      className={`flex w-full flex-col rounded-2xl border px-4 py-3 text-left transition ${
                        active
                          ? "border-primary/40 bg-primary/10 shadow-sm"
                          : "border-base-300 bg-base-100 hover:border-primary/30 hover:bg-base-200/40"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          {/* 历史文本摘要。 */}
                          <p className="truncate text-[13px] font-medium text-neutral">{entry.inputText}</p>
                          <p className="mt-1 text-[11px] text-neutral/55">{new Date(entry.createdAt).toLocaleString("zh-CN", { hour12: false })}</p>
                        </div>
                        <div className="flex items-center gap-2">
                          <button
                            type="button"
                            // 应用按钮：恢复这条历史对应的输入和参数。
                            className="btn btn-ghost btn-xs h-7 min-h-7 px-2 text-[11px]"
                            onClick={() => void handleApplyHistory(entry)}
                          >
                            使用
                          </button>
                          <button
                            type="button"
                            // 单条删除按钮：仅移除目标记录，不影响其它历史项。
                            className="btn btn-ghost btn-xs h-7 min-h-7 px-2 text-error"
                            onClick={() => {
                              handleDeleteHistory(entry.id);
                            }}
                          >
                            删除
                          </button>
                        </div>
                      </div>
                      <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-neutral/60">
                        {/* 参数摘要：帮助用户快速识别这条历史的生成配置。 */}
                        <span className="rounded-xl bg-base-200/70 px-2 py-1">纠错 {entry.options.errorCorrectionLevel}</span>
                        <span className="rounded-xl bg-base-200/70 px-2 py-1">缩放 {entry.options.scale}</span>
                        <span className="rounded-xl bg-base-200/70 px-2 py-1">留白 {entry.options.margin}</span>
                        <span className="rounded-xl bg-base-200/70 px-2 py-1">颜色已保存</span>
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
