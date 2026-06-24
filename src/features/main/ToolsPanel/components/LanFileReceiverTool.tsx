import { listen } from "@tauri-apps/api/event";
import { useEffect, useMemo, useRef, useState } from "react";
import QRCode from "qrcode";
import {
  ChevronLeft,
  Copy,
  FolderDown,
  Image as ImageIcon,
  RefreshCcw,
  Search,
  Server,
  Smartphone,
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

  // 当前筛选结果中的图片数量：用于顶部摘要。
  const imageCount = useMemo(() => files.filter((item) => item.previewKind === "image").length, [files]);
  // 当前筛选结果中的文本数量：用于顶部摘要。
  const textCount = useMemo(() => files.filter((item) => item.previewKind === "text").length, [files]);

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

  // 服务开关变化时更新轮询：开启后每 4 秒拉一次列表，停止后关闭轮询。
  useEffect(() => {
    stopPolling();
    if (!status?.enabled) return;
    pollingTimerRef.current = window.setInterval(() => {
      void refreshToolState(false);
    }, 4000);
    return () => {
      stopPolling();
    };
  }, [status?.enabled]);

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
    // 工具整体容器：顶部控制区 + 地址区 + 文件列表/预览双栏。
    <div className="flex h-full min-h-0 w-full flex-col overflow-hidden bg-base-200/45">
      {/* 顶部轻提示：反馈复制、删除和开关结果。 */}
      {notice ? (
        <NoticeAlert
          tone={notice.tone}
          message={notice.message}
          onClose={() => setNotice(null)}
          className="fixed right-4 top-4 z-[60] max-w-[380px] shadow-lg"
        />
      ) : null}
      {/* 顶部返回区：保留回到工具入口页的路径。 */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-base-300 bg-base-100 px-5 py-3">
        <button type="button" className="btn btn-ghost btn-sm h-8 min-h-8 gap-1 px-2 text-[12px]" onClick={onBack}>
          {/* 返回图标：与文字一起强化回退语义。 */}
          <ChevronLeft size={14} />
          返回工具面板
        </button>
        {/* 顶部摘要：强调服务开关、地址分发和文件管理是完整闭环。 */}
        <p className="text-[12px] text-neutral/60">支持开启局域网上传页、手机访问上传、多端自适应，以及桌面端预览与清理接收文件。</p>
      </div>
      {/* 主体工作区：顶部状态卡，下方左右双栏。 */}
      <div className="min-h-0 flex-1 overflow-auto p-4">
        <div className="flex min-h-full flex-col gap-4">
          {/* 状态卡：承载服务开关、总数和入口动作。 */}
          <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
            <div className="flex flex-col gap-5 xl:flex-row xl:items-start xl:justify-between">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-3">
                  {/* 标题图标：强化局域网接收语义。 */}
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Wifi size={20} />
                  </div>
                  <div className="min-w-0">
                    {/* 标题。 */}
                    <h2 className="text-[18px] font-semibold text-neutral">局域网接收文件</h2>
                    <p className="mt-1 text-[12px] text-neutral/60">开启后会随机监听一个可用端口，并提供局域网可访问的上传页面。</p>
                  </div>
                </div>
                <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
                  <div className="rounded-2xl border border-base-300 bg-base-200/45 px-4 py-3">
                    <p className="text-[12px] text-neutral/55">接收状态</p>
                    <p className={`mt-2 text-[15px] font-semibold ${status?.enabled ? "text-success" : "text-neutral"}`}>
                      {status?.enabled ? "已开启" : "未开启"}
                    </p>
                  </div>
                  <div className="rounded-2xl border border-base-300 bg-base-200/45 px-4 py-3">
                    <p className="text-[12px] text-neutral/55">监听端口</p>
                    <p className="mt-2 text-[15px] font-semibold text-neutral">{status?.port ?? "--"}</p>
                  </div>
                  <div className="rounded-2xl border border-base-300 bg-base-200/45 px-4 py-3">
                    <p className="text-[12px] text-neutral/55">已接收文件</p>
                    <p className="mt-2 text-[15px] font-semibold text-neutral">{files.length}</p>
                  </div>
                  <div className="rounded-2xl border border-base-300 bg-base-200/45 px-4 py-3">
                    <p className="text-[12px] text-neutral/55">可直接预览</p>
                    <p className="mt-2 text-[15px] font-semibold text-neutral">{imageCount + textCount}</p>
                  </div>
                </div>
              </div>
              {/* 开关和动作：满足进入页面即可开关接收服务的要求。 */}
              <div className="flex shrink-0 flex-col gap-3 rounded-2xl border border-base-300 bg-base-200/45 p-4 xl:min-w-[280px]">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    {/* 开关标题。 */}
                    <p className="text-[13px] font-medium text-neutral">接收开关</p>
                    <p className="mt-1 text-[12px] text-neutral/60">关闭后局域网上传页立即失效，但已接收文件仍保留。</p>
                  </div>
                  <input
                    // 开关控件：直接控制服务启停。
                    type="checkbox"
                    className="toggle toggle-primary toggle-lg"
                    checked={status?.enabled === true}
                    disabled={syncing}
                    onChange={(event) => {
                      void handleToggleReceiver(event.target.checked);
                    }}
                  />
                </div>
                <div className="flex flex-wrap gap-2">
                  <button type="button" className="btn btn-outline btn-sm h-9 min-h-9 gap-2 px-3 text-[12px]" disabled={syncing} onClick={() => void refreshToolState(true)}>
                    <RefreshCcw size={14} />
                    刷新状态
                  </button>
                  <button
                    type="button"
                    className="btn btn-primary btn-sm h-9 min-h-9 gap-2 px-3 text-[12px]"
                    disabled={!status?.enabled || !status.localBaseUrl}
                    onClick={() => void handleOpenUploadPage()}
                  >
                    <Smartphone size={14} />
                    本机打开上传页
                  </button>
                </div>
              </div>
            </div>
          </section>
          {/* 地址卡片区：展示局域网设备应该访问的地址。 */}
          <section className="rounded-3xl border border-base-300 bg-base-100 p-5 shadow-sm">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                {/* 地址区标题。 */}
                <h3 className="text-[15px] font-semibold text-neutral">局域网访问地址</h3>
                <p className="mt-1 text-[12px] text-neutral/60">其他设备只要和当前电脑处在同一局域网，访问下面任一地址即可打开上传页面。</p>
              </div>
              {status?.enabled && status.localBaseUrl ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                  onClick={() => void handleCopyAddress(status.localBaseUrl ?? "")}
                >
                  <Copy size={14} />
                  复制本机地址
                </button>
              ) : null}
            </div>
            {status?.enabled ? (
              status.accessUrls.length > 0 || status.localBaseUrl ? (
                <div className="mt-4 grid grid-cols-1 gap-4 2xl:grid-cols-[minmax(0,1.4fr)_320px]">
                  <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                    {status.accessUrls.map((address) => (
                      <div key={address.url} className={`rounded-2xl border px-4 py-4 ${address.isPreferred ? "border-primary/35 bg-primary/10" : "border-base-300 bg-base-200/40"}`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            {/* 网卡标签。 */}
                            <p className="truncate text-[13px] font-medium text-neutral">{address.label}</p>
                            <p className="mt-1 text-[11px] text-neutral/55">{address.isPreferred ? "推荐优先发送给移动设备" : "可选地址"}</p>
                          </div>
                          {address.isPreferred ? (
                            <span className="rounded-full bg-primary/15 px-2.5 py-1 text-[11px] font-medium text-primary">推荐</span>
                          ) : null}
                        </div>
                        <div className="mt-4 rounded-2xl border border-base-300 bg-base-100 px-3 py-3 font-mono text-[12px] text-neutral">
                          {address.url}
                        </div>
                        <div className="mt-3 flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                            onClick={() => void handleCopyAddress(address.url)}
                          >
                            <Copy size={14} />
                            复制地址
                          </button>
                        </div>
                      </div>
                    ))}
                    {status.accessUrls.length === 0 && status.localBaseUrl ? (
                      <div className="rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4 text-[13px] text-warning">
                        当前仅检测到本机地址，二维码会用于本机调试；若要让手机扫码直接打开，请先连接到可互通的局域网。
                      </div>
                    ) : null}
                  </div>
                  <div className="rounded-2xl border border-base-300 bg-base-200/40 p-4">
                    <div className="flex items-start justify-between gap-3">
                      <div>
                        {/* 二维码标题。 */}
                        <h4 className="text-[14px] font-semibold text-neutral">扫码打开上传页</h4>
                        <p className="mt-1 text-[12px] leading-6 text-neutral/60">手机对准二维码即可直接打开当前上传页面，不需要手动输入地址。</p>
                      </div>
                      <div className="rounded-full bg-primary/10 px-2.5 py-1 text-[11px] font-medium text-primary">扫码</div>
                    </div>
                    <div className="mt-4 flex justify-center rounded-3xl border border-base-300 bg-white p-4 shadow-sm">
                      {qrCodeDataUrl ? (
                        <img
                          // 地址二维码：供手机直接扫码打开上传页。
                          src={qrCodeDataUrl}
                          alt="局域网上传页二维码"
                          className="h-[220px] w-[220px] rounded-2xl object-contain"
                        />
                      ) : (
                        <div className="flex h-[220px] w-[220px] items-center justify-center rounded-2xl bg-base-200/45 text-center text-[12px] leading-6 text-neutral/55">
                          暂无可生成二维码的访问地址
                        </div>
                      )}
                    </div>
                    {qrCodeUrl ? (
                      <div className="mt-4 rounded-2xl border border-base-300 bg-base-100 px-3 py-3 font-mono text-[12px] text-neutral">
                        {qrCodeUrl}
                      </div>
                    ) : null}
                    <div className="mt-3 flex flex-wrap gap-2">
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                        disabled={!qrCodeUrl}
                        onClick={() => void handleCopyAddress(qrCodeUrl)}
                      >
                        <Copy size={14} />
                        复制二维码地址
                      </button>
                    </div>
                  </div>
                </div>
              ) : (
                <div className="mt-4 rounded-2xl border border-warning/30 bg-warning/10 px-4 py-4 text-[13px] text-warning">
                  当前未检测到可用的局域网 IPv4 地址。你仍可用本机地址自测上传页，也可以确认是否已连接到局域网或访客网络是否隔离。
                </div>
              )
            ) : (
              <div className="mt-4 rounded-2xl border border-dashed border-base-300 bg-base-200/30 px-4 py-5 text-[13px] text-neutral/60">
                打开上方接收开关后，这里会展示当前电脑可被手机、平板等设备访问的 `ip:port` 地址。
              </div>
            )}
          </section>
          {/* 下方双栏：左侧文件管理，右侧预览详情。 */}
          <div className="grid min-h-0 flex-1 grid-cols-1 gap-4 xl:grid-cols-[minmax(340px,0.9fr)_minmax(420px,1.1fr)]">
            {/* 左侧文件管理区：筛选、搜索和删除动作集中在这里。 */}
            <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-sm">
              <div className="border-b border-base-300 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    {/* 列表标题。 */}
                    <h3 className="text-[15px] font-semibold text-neutral">已接收文件</h3>
                    <p className="mt-1 text-[12px] text-neutral/60">上传成功后会实时出现在这里，支持按图片或文本快速聚焦。</p>
                  </div>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px] text-error"
                    disabled={files.length === 0}
                    onClick={() => void handleClearAllFiles()}
                  >
                    <Trash2 size={14} />
                    清空全部
                  </button>
                </div>
                <div className="mt-4 flex flex-wrap gap-2">
                  {FILTER_TABS.map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      // 筛选按钮：用于在全部、图片和文本之间切换。
                      className={`btn btn-sm h-8 min-h-8 rounded-full px-3 text-[12px] ${filterKind === tab.id ? "btn-primary" : "btn-ghost border border-base-300"}`}
                      onClick={() => {
                        setFilterKind(tab.id);
                      }}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>
                <label className="mt-4 flex items-center gap-2 rounded-2xl border border-base-300 bg-base-200/35 px-3 py-2">
                  {/* 搜索图标：强化输入区语义。 */}
                  <Search size={15} className="text-neutral/45" />
                  <input
                    // 搜索框：按文件名和 MIME 快速过滤。
                    value={keyword}
                    className="w-full bg-transparent text-[13px] outline-none placeholder:text-neutral/40"
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
                  <div className="space-y-3">
                    {filteredFiles.map((item) => {
                      const active = item.id === selectedFileId;
                      return (
                        <div
                          key={item.id}
                          className={`rounded-2xl border px-4 py-3 transition ${active ? "border-primary/35 bg-primary/10 shadow-sm" : "border-base-300 bg-base-100 hover:border-primary/25 hover:bg-base-200/35"}`}
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
                                <p className="truncate text-[13px] font-medium text-neutral">{item.originalName}</p>
                                <p className="mt-1 text-[11px] text-neutral/55">{new Date(item.receivedAt).toLocaleString("zh-CN", { hour12: false })}</p>
                              </div>
                              <span className="rounded-full bg-base-100 px-2.5 py-1 text-[11px] text-neutral/70">{resolvePreviewKindLabel(item.previewKind)}</span>
                            </div>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral/60">
                              <span className="rounded-xl bg-base-200/70 px-2 py-1">{formatLanFileSize(item.sizeBytes)}</span>
                              <span className="rounded-xl bg-base-200/70 px-2 py-1">{item.mimeType}</span>
                            </div>
                          </button>
                          <div className="mt-3 flex justify-end">
                            <button
                              type="button"
                              // 单条删除按钮：用于清理无用图片和临时文件。
                              className="btn btn-ghost btn-xs h-7 min-h-7 gap-1 px-2 text-[11px] text-error"
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
            <section className="flex min-h-[420px] min-w-0 flex-col overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-sm">
              <div className="border-b border-base-300 px-4 py-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                      <Server size={16} />
                    </div>
                    <div className="min-w-0">
                      {/* 预览标题。 */}
                      <h3 className="text-[15px] font-semibold text-neutral">文件预览</h3>
                      <p className="mt-1 text-[12px] text-neutral/60">文本和图片会直接在这里展示，其它类型保留文件信息方便继续管理。</p>
                    </div>
                  </div>
                  {status?.enabled && status.localBaseUrl && selectedFileId ? (
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm h-8 min-h-8 gap-2 px-3 text-[12px]"
                      onClick={() => void handleOpenUploadPage()}
                    >
                      <Smartphone size={14} />
                      打开上传页
                    </button>
                  ) : null}
                </div>
              </div>
              <div className="min-h-0 flex-1 overflow-auto bg-[linear-gradient(180deg,#fbfdff_0%,#f3f8ff_100%)] p-4">
                {selectedFileId ? (
                  previewLoading ? (
                    <div className="flex h-full min-h-[300px] items-center justify-center rounded-3xl border border-base-300 bg-base-100/80">
                      <div className="flex items-center gap-3 rounded-2xl border border-base-300 bg-base-100 px-5 py-4 shadow-sm">
                        <span className="loading loading-spinner text-primary" style={{ width: 20, height: 20 }} />
                        <div>
                          {/* 加载标题。 */}
                          <p className="text-[13px] font-medium text-neutral">正在加载文件预览</p>
                          <p className="mt-1 text-[12px] text-neutral/60">会根据文件类型自动选择文本或图片预览方式。</p>
                        </div>
                      </div>
                    </div>
                  ) : preview ? (
                    <div className="flex min-h-full flex-col gap-4">
                      <div className="rounded-3xl border border-base-300 bg-base-100/88 p-4 shadow-sm">
                        <div className="flex flex-wrap items-start justify-between gap-4">
                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2 text-primary">
                              {/* 类型图标：根据文件类型切换。 */}
                              <PreviewKindIcon previewKind={preview.previewKind} />
                              <span className="text-[12px] font-medium uppercase tracking-[0.16em]">{resolvePreviewKindLabel(preview.previewKind)}</span>
                            </div>
                            <h4 className="mt-3 break-all text-[16px] font-semibold text-neutral">{preview.originalName}</h4>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-neutral/60">
                              <span className="rounded-xl bg-base-200/70 px-2 py-1">{formatLanFileSize(preview.sizeBytes)}</span>
                              <span className="rounded-xl bg-base-200/70 px-2 py-1">{preview.mimeType}</span>
                              <span className="rounded-xl bg-base-200/70 px-2 py-1">{new Date(preview.receivedAt).toLocaleString("zh-CN", { hour12: false })}</span>
                            </div>
                          </div>
                          <button
                            type="button"
                            className="btn btn-outline btn-sm h-9 min-h-9 gap-2 px-3 text-[12px]"
                            onClick={() => void handleDeleteFile(preview.id)}
                          >
                            <Trash2 size={14} />
                            删除当前文件
                          </button>
                        </div>
                        {preview.previewMessage ? (
                          <div className="mt-4 rounded-2xl border border-base-300 bg-base-200/45 px-4 py-3 text-[12px] leading-6 text-neutral/65">
                            {preview.previewMessage}
                          </div>
                        ) : null}
                      </div>
                      {preview.previewKind === "image" && preview.dataUrl ? (
                        <div className="flex min-h-[320px] items-center justify-center rounded-3xl border border-base-300 bg-white/85 p-4 shadow-sm">
                          <img
                            // 图片预览：展示当前接收文件的图像内容。
                            src={preview.dataUrl}
                            alt={preview.originalName}
                            className="h-auto max-h-[520px] w-full rounded-2xl object-contain"
                          />
                        </div>
                      ) : preview.previewKind === "text" ? (
                        <div className="overflow-hidden rounded-3xl border border-base-300 bg-base-100 shadow-sm">
                          <div className="border-b border-base-300 px-4 py-3 text-[12px] text-neutral/60">
                            {preview.truncated ? "当前仅展示文件前 256 KB 文本内容。" : "当前文件文本内容如下。"}
                          </div>
                          <pre className="max-h-[520px] overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[12px] leading-6 text-neutral">
                            {preview.textContent || ""}
                          </pre>
                        </div>
                      ) : (
                        <div className="flex min-h-[280px] items-center justify-center rounded-3xl border border-dashed border-base-300 bg-base-100/75 px-6 text-center">
                          <div className="max-w-[280px]">
                            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                              <FolderDown size={20} />
                            </div>
                            <p className="mt-4 text-[14px] font-medium text-neutral">当前类型暂不支持直接预览</p>
                            <p className="mt-2 text-[12px] leading-6 text-neutral/60">文件已经安全保留在本地，后续仍可继续筛选、删除，或保留给外部工具处理。</p>
                          </div>
                        </div>
                      )}
                    </div>
                  ) : (
                    <div className="flex h-full min-h-[300px] items-center justify-center rounded-3xl border border-dashed border-base-300 bg-base-100/75 px-6 text-center">
                      <div className="max-w-[260px]">
                        <p className="text-[14px] font-medium text-neutral">预览加载失败</p>
                        <p className="mt-2 text-[12px] leading-6 text-neutral/60">可以重新点击左侧文件列表项再试一次，或刷新当前工具状态。</p>
                      </div>
                    </div>
                  )
                ) : (
                  <div className="flex h-full min-h-[300px] items-center justify-center rounded-3xl border border-dashed border-base-300 bg-base-100/75 px-6 text-center">
                    <div className="max-w-[260px]">
                      <p className="text-[14px] font-medium text-neutral">选择一个文件开始预览</p>
                      <p className="mt-2 text-[12px] leading-6 text-neutral/60">图片会显示大图，文本会直接展示内容，其它类型则展示元信息和管理操作。</p>
                    </div>
                  </div>
                )}
              </div>
            </section>
          </div>
        </div>
      </div>
    </div>
  );
}
