import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ChevronLeft,
  Copy,
  FolderDown,
  Image as ImageIcon,
  Minus,
  Plus,
  Search,
  Server,
  Smartphone,
  RotateCcw,
  Trash2,
  Wifi,
  FileText,
  HardDriveUpload
} from "lucide-react";
import { NoticeAlert, type NoticeTone } from "../../../../components/NoticeAlert";
import { api } from "../../../../api/index.ts";
import type {
  LanFileReceiverItem,
  LanFileReceiverPreviewPayload,
  LanFileReceiverStatus
} from "../../../../types/index.ts";
import {
  filterLanFileReceiverItems,
  formatLanFileSize,
  resolveLanFileReceiverQrUrl,
  shouldShowLanFileReceiverQrCard,
  type LanFileReceiverFilterKind
} from "../logic/lanFileReceiver.ts";

type LanFileReceiverToolProps = {
  // 返回工具入口页：用于离开局域网接收文件详情页。
  onBack: () => void;
};

type FilterTabDefinition = {
  // 筛选标识。
  id: LanFileReceiverFilterKind;
  // 显示名称。
  label: string;
};

// 筛选标签定义：用于在全部、图片和文本之间切换。
const FILTER_TABS: FilterTabDefinition[] = [
  { id: "all", label: "全部文件" },
  { id: "image", label: "仅图片" },
  { id: "text", label: "仅文本" }
];

// 图片默认缩放比例：首次预览和重置时统一回到 50%。
const DEFAULT_IMAGE_ZOOM = 0.5;

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
    document.execCommand("copy"); // 兼容剪贴板权限受限环境。
    document.body.removeChild(textarea);
  }
}

// 生成文件类型徽标文案：帮助用户快速判断可否直接预览。
function resolvePreviewKindLabel(previewKind: LanFileReceiverItem["previewKind"]): string {
  if (previewKind === "image") return "图片";
  if (previewKind === "text") return "文本";
  return "其他";
}

// 详情区图标：根据当前预览类型切换视觉提示。
function PreviewKindIcon({ previewKind }: { previewKind: LanFileReceiverItem["previewKind"] }) {
  if (previewKind === "image") {
    return <ImageIcon size={18} />;
  }
  if (previewKind === "text") {
    return <FileText size={18} />;
  }
  return <FolderDown size={18} />;
}

// 局域网接收文件工具页：负责启动接收服务、展示访问地址和管理已接收文件。
export function LanFileReceiverTool({ onBack }: LanFileReceiverToolProps) {
  // 接收服务状态：包含开关、访问地址和文件数量。
  const [status, setStatus] = useState<LanFileReceiverStatus | null>(null);
  // 已接收文件列表：按时间倒序展示。
  const [files, setFiles] = useState<LanFileReceiverItem[]>([]);
  // 当前选中文件 ID：驱动右侧预览详情。
  const [selectedFileId, setSelectedFileId] = useState("");
  // 当前文件预览载荷：仅在选中可预览文件时加载。
  const [preview, setPreview] = useState<LanFileReceiverPreviewPayload | null>(null);
  // 顶部通知：反馈复制、删除和开关结果。
  const [notice, setNotice] = useState<{ tone: NoticeTone; message: string } | null>(null);
  // 页面初始化加载态：进入工具页时先恢复服务状态和文件列表。
  const [initializing, setInitializing] = useState(true);
  // 统一刷新态：用于顶部刷新按钮和开关动作禁用。
  const [syncing, setSyncing] = useState(false);
  // 预览加载态：切换文件时展示右侧占位。
  const [previewLoading, setPreviewLoading] = useState(false);
  // 当前筛选标签：用于列表和统计聚焦。
  const [filterKind, setFilterKind] = useState<LanFileReceiverFilterKind>("all");
  // 搜索关键字：按文件名和 MIME 模糊筛选。
  const [keyword, setKeyword] = useState("");
  // 图片预览缩放比例：仅作用于右侧图片预览区域。
  const [imageZoom, setImageZoom] = useState(DEFAULT_IMAGE_ZOOM);
  // 定时轮询句柄：服务开启时定期刷新接收结果。
  const pollingTimerRef = useRef<number | null>(null);

  // 当前二维码图片：用于手机直接扫码打开上传页。
  const [qrCodeDataUrl, setQrCodeDataUrl] = useState("");

  // 自动关闭轻提示：保持与现有工具页一致。
  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => {
      setNotice(null); // 定时关闭提示，避免长时间遮挡操作区。
    }, 2600);
    return () => {
      window.clearTimeout(timer);
    };
  }, [notice]);

  // 当前筛选后的文件列表：统一驱动左侧列表和空态。
  const filteredFiles = useMemo(() => {
    return filterLanFileReceiverItems(files, filterKind, keyword);
  }, [files, filterKind, keyword]);

  // 二维码目标地址：优先推荐局域网地址，缺失时回退本机地址。
  const qrCodeUrl = useMemo(() => resolveLanFileReceiverQrUrl(status), [status]);
  // 二维码卡片是否可见：只在接收服务开启且存在可扫码地址时显示。
  const showQrCodeCard = useMemo(() => shouldShowLanFileReceiverQrCard(status), [status]);
  // 当前主访问地址：优先展示推荐局域网地址，缺失时回退本机地址。
  const currentAccessUrl = useMemo(() => qrCodeUrl || status?.localBaseUrl || "", [qrCodeUrl, status]);

  // 当前筛选结果中的图片数量：用于顶部摘要。
  const imageCount = useMemo(() => files.filter((item) => item.previewKind === "image").length, [files]);
  // 当前筛选结果中的文本数量：用于顶部摘要。
  const textCount = useMemo(() => files.filter((item) => item.previewKind === "text").length, [files]);

  // 当前选中的文件实体：用于左侧列表高亮与右侧标题同步。
  const selectedFile = useMemo(() => files.find((item) => item.id === selectedFileId) ?? null, [files, selectedFileId]);

  // 首次进入工具页时恢复状态，并监听上传成功事件做实时刷新。
  useEffect(() => {
    let active = true;
    let eventUnlisten: (() => void) | undefined;

    void (async () => {
      await refreshToolState(false);
      if (!active) return;
      setInitializing(false);
    })();

    void listen("sf:lan-file-receiver-files-updated", () => {
      if (!active) return;
      void refreshToolState(false);
    }).then((unlisten) => {
      eventUnlisten = unlisten;
    });

    return () => {
      active = false;
      eventUnlisten?.();
      stopPolling();
    };
  }, []);

  // 统一状态轮询：无论当前是否开启服务，都定期同步状态与文件列表。
  useEffect(() => {
    stopPolling();
    pollingTimerRef.current = window.setInterval(() => {
      void refreshToolState(false);
    }, 4000);
    return () => {
      stopPolling();
    };
  }, []);

  // 当筛选结果变化时，保持选中项有效并自动加载预览。
  useEffect(() => {
    if (filteredFiles.length === 0) {
      setSelectedFileId("");
      setPreview(null);
      return;
    }

    const selectedExists = filteredFiles.some((item) => item.id === selectedFileId);
    const nextSelectedFileId = selectedExists ? selectedFileId : filteredFiles[0].id;
    if (nextSelectedFileId !== selectedFileId) {
      setSelectedFileId(nextSelectedFileId);
      return;
    }

    if (!preview || preview.id !== nextSelectedFileId) {
      void loadPreview(nextSelectedFileId);
    }
  }, [filteredFiles, preview, selectedFileId]);

  // 服务地址变化时重建二维码：确保手机扫码总是命中当前最新地址。
  useEffect(() => {
    if (!qrCodeUrl) {
      setQrCodeDataUrl("");
      return;
    }

    let active = true;
    void QRCode.toDataURL(qrCodeUrl, {
      errorCorrectionLevel: "M",
      margin: 1,
      scale: 6,
      color: {
        dark: "#0F172A",
        light: "#FFFFFF"
      }
    }).then((dataUrl) => {
      if (!active) return;
      setQrCodeDataUrl(dataUrl);
    }).catch(() => {
      if (!active) return;
      setQrCodeDataUrl("");
    });

    return () => {
      active = false;
    };
  }, [qrCodeUrl]);

  // 切换预览文件或预览类型时重置图片缩放，避免上一张图的比例串到下一张。
  useEffect(() => {
    if (preview?.previewKind === "image") {
      setImageZoom(DEFAULT_IMAGE_ZOOM);
      return;
    }
    setImageZoom(DEFAULT_IMAGE_ZOOM);
  }, [preview?.id, preview?.previewKind]);

  // 停止轮询：切换视图或工具卸载时统一清理定时器。
  function stopPolling() {
    if (pollingTimerRef.current === null) return;
    window.clearInterval(pollingTimerRef.current);
    pollingTimerRef.current = null;
  }

  // 同步服务状态与文件列表：供初始化、轮询和按钮刷新复用。
  async function refreshToolState(showSyncing = true) {
    if (showSyncing) {
      setSyncing(true);
    }
    try {
      const [nextStatus, nextFiles] = await Promise.all([
        api.getLanFileReceiverStatus(),
        api.listLanFileReceiverFiles()
      ]);
      setStatus(nextStatus);
      setFiles(nextFiles);
      if (nextFiles.length === 0) {
        setPreview(null);
      }
    } catch (error) {
      setNotice({
        tone: "error",
        message: `刷新接收状态失败：${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      if (showSyncing) {
        setSyncing(false);
      }
    }
  }

  // 加载指定文件的预览内容：文本直接读内容，图片读取 data URL。
  async function loadPreview(fileId: string) {
    setPreviewLoading(true);
    try {
      const nextPreview = await api.readLanFileReceiverPreview(fileId);
      setPreview(nextPreview);
    } catch (error) {
      setPreview(null);
      setNotice({
        tone: "error",
        message: `读取文件预览失败：${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setPreviewLoading(false);
    }
  }

  // 开关局域网接收服务：满足“进入页面后显示接收开关”的需求。
  async function handleToggleReceiver(enabled: boolean) {
    setSyncing(true);
    try {
      if (enabled) {
        const nextStatus = await api.startLanFileReceiver();
        setStatus(nextStatus);
        setNotice({
          tone: "success",
          message: `接收服务已开启，当前监听端口 ${nextStatus.port ?? "-" }。`
        });
      } else {
        await api.stopLanFileReceiver();
        setStatus((current) =>
          current
            ? {
                ...current,
                enabled: false,
                port: null,
                localBaseUrl: null,
                accessUrls: []
              }
            : {
                enabled: false,
                port: null,
                localBaseUrl: null,
                accessUrls: [],
                fileCount: files.length
              }
        );
        setNotice({
          tone: "success",
          message: "接收服务已关闭。"
        });
      }
      await refreshToolState(false);
    } catch (error) {
      setNotice({
        tone: "error",
        message: `切换接收服务失败：${error instanceof Error ? error.message : String(error)}`
      });
    } finally {
      setSyncing(false);
    }
  }

  // 复制局域网访问地址：便于快速发给手机或平板。
  async function handleCopyAddress(url: string) {
    try {
      await copyText(url);
      setNotice({
        tone: "success",
        message: "访问地址已复制。"
      });
    } catch (error) {
      setNotice({
        tone: "error",
        message: `复制地址失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 在本机默认浏览器中打开上传页：便于桌面端自测上传流程。
  async function handleOpenUploadPage() {
    if (!status?.localBaseUrl) return;
    try {
      await api.openExternalUrl(status.localBaseUrl);
    } catch (error) {
      setNotice({
        tone: "error",
        message: `打开上传页失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 删除单个已接收文件，并在必要时切换选中项。
  async function handleDeleteFile(fileId: string) {
    try {
      await api.deleteLanFileReceiverFile(fileId);
      if (selectedFileId === fileId) {
        setSelectedFileId("");
        setPreview(null);
      }
      setNotice({
        tone: "success",
        message: "文件已删除。"
      });
      await refreshToolState(false);
    } catch (error) {
      setNotice({
        tone: "error",
        message: `删除文件失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  // 调整图片缩放比例：限制在合理范围内，保证桌面端预览稳定。
  function handleChangeImageZoom(nextZoom: number) {
    setImageZoom(Math.max(0.25, Math.min(3, Number(nextZoom.toFixed(2)))));
  }

  // 清空全部接收记录：用于批量清理旧图片和临时文件。
  async function handleClearAllFiles() {
    if (files.length === 0) return;
    if (!window.confirm("确认清空全部已接收文件吗？此操作不可撤销。")) {
      return;
    }
    try {
      await api.clearLanFileReceiverFiles();
      setSelectedFileId("");
      setPreview(null);
      setNotice({
        tone: "success",
        message: "已清空全部接收文件。"
      });
      await refreshToolState(false);
    } catch (error) {
      setNotice({
        tone: "error",
        message: `清空文件失败：${error instanceof Error ? error.message : String(error)}`
      });
    }
  }

  if (initializing) {
    return (
      // 工具加载态：仅在进入工具页后展示。
      <div className="flex h-full w-full items-center justify-center bg-base-200/40">
        <div className="rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
          <div className="flex items-center gap-3">
            <span className="loading loading-spinner text-primary" style={{ width: 22, height: 22 }} />
            <div>
              {/* 加载标题。 */}
              <p className="text-[13px] font-medium text-neutral">正在恢复局域网接收工具</p>
              <p className="mt-1 text-[12px] text-neutral/65">会同步当前接收服务状态和已保存文件列表。</p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    // 工具整体容器：顶部紧凑工具栏 + 下方桌面程序式双栏工作区。
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-[#eef3f8]">
      {/* 顶部轻提示：反馈复制、删除和开关结果。 */}
      {notice ? (
        <NoticeAlert
          tone={notice.tone}
          message={notice.message}
          onClose={() => setNotice(null)}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      ) : null}
      {/* 顶部桌面工具栏：在同一行集中返回、开关、状态和快捷动作。 */}
      <div className="border-b border-slate-300 bg-[#f8fafc] px-4 py-3">
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            className="btn btn-ghost btn-sm h-8 min-h-8 gap-1 rounded-lg px-2 text-[12px] text-slate-700"
            onClick={onBack}
          >
            {/* 返回图标：与文字一起强化回退语义。 */}
            <ChevronLeft size={14} />
            返回工具面板
          </button>
          <div className="h-5 w-px bg-slate-300" />
          <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2.5 py-1.5">
            <span className="text-[12px] font-medium text-slate-700">接收开关</span>
            <input
              // 开关控件：直接控制服务启停。
              type="checkbox"
              className="toggle toggle-primary toggle-sm"
              checked={status?.enabled === true}
              disabled={syncing}
              onChange={(event) => {
                void handleToggleReceiver(event.target.checked);
              }}
            />
          </div>
          <span className={`rounded-md border px-2 py-1 text-[12px] font-medium ${status?.enabled ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>
            {status?.enabled ? "服务已开启" : "服务未开启"}
          </span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600">端口 {status?.port ?? "--"}</span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600">文件 {files.length}</span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600">图片 {imageCount}</span>
          <span className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[12px] text-slate-600">文本 {textCount}</span>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            <button
              type="button"
              className="btn btn-sm h-8 min-h-8 gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-normal text-slate-700 hover:bg-slate-50"
              disabled={!currentAccessUrl}
              onClick={() => void handleCopyAddress(currentAccessUrl)}
            >
              <Copy size={13} />
              复制地址
            </button>
            <button
              type="button"
              className="btn btn-sm h-8 min-h-8 gap-2 rounded-lg border border-slate-300 bg-white px-3 text-[12px] font-normal text-slate-700 hover:bg-slate-50"
              disabled={!status?.enabled || !status.localBaseUrl || syncing}
              onClick={() => void handleOpenUploadPage()}
            >
              <Smartphone size={13} />
              打开上传页
            </button>
          </div>
        </div>
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-2">
            <Wifi size={14} className="shrink-0 text-primary" />
            <span className="shrink-0 text-[12px] text-slate-500">访问地址</span>
            <code className="truncate text-[12px] text-slate-700">{currentAccessUrl || "服务开启后会在这里显示可访问地址"}</code>
          </div>
          {showQrCodeCard ? (
            <div className="flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-2 py-1.5">
              {qrCodeDataUrl ? (
                <img
                  // 紧凑二维码：保留扫码能力，但不再占据主内容区域。
                  src={qrCodeDataUrl}
                  alt="局域网上传页二维码"
                  className="h-12 w-12 rounded-md border border-slate-200 object-contain"
                />
              ) : null}
              <div className="text-[11px] leading-5 text-slate-500">
                <p>手机扫码上传</p>
                <p>局域网内可直接访问</p>
              </div>
            </div>
          ) : null}
        </div>
      </div>
      {/* 主体工作区：采用桌面程序常见的 sidebar + main 双栏布局。 */}
      <div className="min-h-0 flex-1 overflow-hidden p-3">
        <div className="grid h-full min-h-0 grid-cols-1 gap-3 xl:grid-cols-[320px_minmax(0,1fr)]">
            {/* 左侧文件管理区：筛选、搜索和删除动作集中在这里。 */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-3 py-3">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    {/* 列表标题。 */}
                    <h3 className="text-[14px] font-semibold text-slate-800">已接收文件</h3>
                    <p className="mt-1 text-[11px] text-slate-500">紧凑列表模式，支持筛选、搜索和批量清理。</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm h-7 min-h-7 gap-1 rounded-lg px-2 text-[11px] text-error"
                    disabled={files.length === 0}
                    onClick={() => void handleClearAllFiles()}
                  >
                    <Trash2 size={14} />
                    清空全部
                  </button>
                </div>
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {FILTER_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      // 筛选按钮：用于在全部、图片和文本之间切换。
                      className={`btn btn-sm h-7 min-h-7 rounded-md px-2.5 text-[11px] ${filterKind === tab.id ? "btn-primary" : "btn-ghost border border-slate-300 bg-white text-slate-600"}`}
                      onClick={() => {
                        setFilterKind(tab.id);
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <label className="mt-3 flex items-center gap-2 rounded-lg border border-slate-300 bg-slate-50 px-2.5 py-2">
                  {/* 搜索图标：强化输入区语义。 */}
                  <Search size={14} className="text-slate-400" />
                  <input
                    // 搜索框：按文件名和 MIME 快速过滤。
                    value={keyword}
                    className="w-full bg-transparent text-[12px] text-slate-700 outline-none placeholder:text-slate-400"
                    placeholder="搜索文件名或 MIME 类型"
                    onChange={(event) => {
                      setKeyword(event.target.value);
                    }}
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-3">
                {filteredFiles.length === 0 ? (
                  <div className="flex h-full min-h-[260px] items-center justify-center px-6 text-center">
                    <div className="max-w-[240px]">
                      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                        <HardDriveUpload size={20} />
                      </div>
                      <p className="mt-4 text-[14px] font-medium text-neutral">{files.length === 0 ? "还没有接收文件" : "当前筛选下没有匹配结果"}</p>
                      <p className="mt-2 text-[12px] leading-6 text-neutral/60">
                        {files.length === 0
                          ? "开启接收服务后，用手机或平板访问上方地址上传文件，这里会自动刷新。"
                          : "可以尝试切换筛选标签，或清空搜索关键字查看其它文件。"}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div className="space-y-2">
                    {filteredFiles.map((item) => {
                      const active = item.id === selectedFileId;
                      return (
                        <div
                          key={item.id}
                          className={`rounded-lg border px-3 py-2.5 transition ${active ? "border-primary/35 bg-primary/10 shadow-sm" : "border-slate-200 bg-white hover:border-primary/25 hover:bg-slate-50"}`}
                        >
                          <button
                            type="button"
                            // 文件主区域：点击后切换右侧预览。
                            className="w-full text-left"
                            onClick={() => {
                              setSelectedFileId(item.id);
                              void loadPreview(item.id);
                            }}
                          >
                            <div className="flex items-start justify-between gap-3">
                              <div className="min-w-0">
                                {/* 文件名。 */}
                                <p className="truncate text-[12px] font-medium text-slate-800">{item.originalName}</p>
                                <p className="mt-1 text-[10px] text-slate-500">{new Date(item.receivedAt).toLocaleString("zh-CN", { hour12: false })}</p>
                              </div>
                              <span className="rounded-md border border-slate-200 bg-slate-50 px-2 py-0.5 text-[10px] text-slate-600">{resolvePreviewKindLabel(item.previewKind)}</span>
                            </div>
                            <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] text-slate-500">
                              <span className="rounded-md bg-slate-100 px-2 py-0.5">{formatLanFileSize(item.sizeBytes)}</span>
                              <span className="rounded-md bg-slate-100 px-2 py-0.5">{item.mimeType}</span>
                            </div>
                          </button>
                          <div className="mt-2 flex justify-end">
                            <button
                              type="button"
                              // 单条删除按钮：用于清理无用图片和临时文件。
                              className="btn btn-ghost btn-xs h-6 min-h-6 gap-1 rounded-md px-2 text-[10px] text-error"
                              onClick={() => void handleDeleteFile(item.id)}
                            >
                              <Trash2 size={12} />
                              删除
                            </button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </section>
            {/* 右侧预览区：支持文本和图片直接预览，其它文件展示说明。 */}
            <section className="flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
              <div className="border-b border-slate-200 px-4 py-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Server size={16} />
                    </div>
                    <div className="min-w-0">
                      {/* 预览标题。 */}
                      <h3 className="text-[14px] font-semibold text-slate-800">文件预览</h3>
                      <p className="mt-1 text-[11px] text-slate-500">{selectedFile ? selectedFile.originalName : "选择左侧文件后在这里查看详情和预览"}</p>
                    </div>
                  </div>
                  {preview?.previewKind === "image" ? (
                    <div className="flex items-center gap-1 rounded-lg border border-slate-300 bg-slate-50 p-1">
                      <button
                        type="button"
                        // 缩小按钮：按固定步进降低图片缩放比例。
                        className="btn btn-ghost btn-xs h-7 min-h-7 w-7 rounded-md px-0 text-slate-700"
                        onClick={() => handleChangeImageZoom(imageZoom - 0.25)}
                      >
                        <Minus size={12} />
                      </button>
                      <button
                        type="button"
                        // 重置按钮：一键恢复到默认 50% 预览比例。
                        className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 rounded-md px-2 text-[11px] text-slate-700"
                        onClick={() => handleChangeImageZoom(DEFAULT_IMAGE_ZOOM)}
                      >
                        <RotateCcw size={11} />
                        {Math.round(imageZoom * 100)}%
                      </button>
                      <button
                        type="button"
                        // 放大按钮：按固定步进提升图片缩放比例。
                        className="btn btn-ghost btn-xs h-7 min-h-7 w-7 rounded-md px-0 text-slate-700"
                        onClick={() => handleChangeImageZoom(imageZoom + 0.25)}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#f8fbff_0%,#edf3f9_100%)] p-3">
                {selectedFileId ? (
                  previewLoading ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-slate-300 bg-white/80">
                      <div className="flex items-center gap-3 rounded-lg border border-slate-300 bg-white px-5 py-4 shadow-sm">
                        <span className="loading loading-spinner text-primary" style={{ width: 20, height: 20 }} />
                        <div>
                          {/* 加载标题。 */}
                          <p className="text-[13px] font-medium text-slate-800">正在加载文件预览</p>
                          <p className="mt-1 text-[12px] text-slate-500">会根据文件类型自动选择文本或图片预览方式。</p>
                        </div>
                      </div>
                    </div>
                  ) : preview ? (
                    <div className="flex min-h-full flex-col gap-3">
                      {preview.previewKind === "image" && preview.dataUrl ? (
                        <div className="min-h-[320px] overflow-auto p-1">
                          <div className="flex min-h-[420px] items-center justify-center">
                            <img
                              // 图片预览：展示当前接收文件的图像内容，并支持按钮缩放。
                              src={preview.dataUrl}
                              alt={preview.originalName}
                              className="max-w-none rounded-lg object-contain shadow-sm transition-transform"
                              style={{
                                maxHeight: "none",
                                width: "auto",
                                height: "auto",
                                transform: `scale(${imageZoom})`,
                                transformOrigin: "center center"
                              }}
                            />
                          </div>
                        </div>
                      ) : (
                        <div className="rounded-xl border border-slate-300 bg-white/90 p-4 shadow-sm">
                          <div className="flex flex-wrap items-start justify-between gap-4">
                            <div className="min-w-0 flex-1">
                              <div className="flex items-center gap-2 text-primary">
                                {/* 类型图标：根据文件类型切换。 */}
                                <PreviewKindIcon previewKind={preview.previewKind} />
                                <span className="text-[12px] font-medium uppercase tracking-[0.16em]">{resolvePreviewKindLabel(preview.previewKind)}</span>
                              </div>
                              <h4 className="mt-3 break-all text-[15px] font-semibold text-slate-800">{preview.originalName}</h4>
                              <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-slate-500">
                                <span className="rounded-md bg-slate-100 px-2 py-1">{formatLanFileSize(preview.sizeBytes)}</span>
                                <span className="rounded-md bg-slate-100 px-2 py-1">{preview.mimeType}</span>
                                <span className="rounded-md bg-slate-100 px-2 py-1">{new Date(preview.receivedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                              </div>
                            </div>
                            <button
                              type="button"
                              className="btn btn-outline btn-sm h-8 min-h-8 gap-2 rounded-lg px-3 text-[12px]"
                              onClick={() => void handleDeleteFile(preview.id)}
                            >
                              <Trash2 size={14} />
                              删除当前文件
                            </button>
                          </div>
                          {preview.previewMessage ? (
                            <div className="mt-4 rounded-lg border border-slate-300 bg-slate-50 px-4 py-3 text-[12px] leading-6 text-slate-600">
                              {preview.previewMessage}
                            </div>
                          ) : null}
                        </div>
                      )}
                      {preview.previewKind === "text" ? (
                        <div className="overflow-hidden rounded-xl border border-slate-300 bg-white shadow-sm">
                          <div className="border-b border-slate-300 px-4 py-3 text-[12px] text-slate-500">
                            {preview.truncated ? "当前仅展示文件前 256 KB 文本内容。" : "当前文件文本内容如下。"}
                          </div>
                          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words bg-slate-50 p-4 font-mono text-[12px] leading-6 text-slate-800">
                            {preview.textContent || ""}
                          </pre>
                        </div>
                      ) : preview.previewKind === "unsupported" ? (
                        <div className="flex min-h-[280px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 px-6 text-center">
                          <div className="max-w-[280px]">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-lg bg-primary/10 text-primary">
                              <FolderDown size={20} />
                            </div>
                            <p className="mt-4 text-[14px] font-medium text-slate-800">当前类型暂不支持直接预览</p>
                            <p className="mt-2 text-[12px] leading-6 text-slate-500">文件已经安全保留在本地，后续仍可继续筛选、删除，或保留给外部工具处理。</p>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 px-6 text-center">
                      <div className="max-w-[260px]">
                        <p className="text-[14px] font-medium text-slate-800">预览加载失败</p>
                        <p className="mt-2 text-[12px] leading-6 text-slate-500">可以重新点击左侧文件列表项再试一次，或刷新当前工具状态。</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex h-full min-h-[300px] items-center justify-center rounded-xl border border-dashed border-slate-300 bg-white/75 px-6 text-center">
                    <div className="max-w-[260px]">
                      <p className="text-[14px] font-medium text-slate-800">选择一个文件开始预览</p>
                      <p className="mt-2 text-[12px] leading-6 text-slate-500">图片支持按钮缩放，文本会直接展示内容，其它类型则展示元信息和管理操作。</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
        </div>
      </div>
    </div>
  );
}
